import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Resolve the build tools from the Forge maker that owns them.
const require = createRequire(import.meta.url);
const makerRequire = createRequire(
  require.resolve('@electron-forge/maker-squirrel')
);
const { createWindowsInstaller } = makerRequire('electron-winstaller');
const { createPackage, extractAll } = makerRequire('@electron/asar');
const project = dirname(dirname(fileURLToPath(import.meta.url)));
assert.equal(process.platform, 'win32', 'This test needs Windows.');
const id = `fixlinks-update-test-${Date.now()}`;
const root = join(project, 'out', id);
const install = join(root, 'installed', id);
const profile = join(root, 'profile');
const report = {
  id,
  root,
  versions: ['1.3.1', '1.3.2'],
  checks: [],
  requests: [],
  result: 'running'
};
await mkdir(root, { recursive: true });
const controlProbe = createServer();
await new Promise((resolve) => controlProbe.listen(0, '127.0.0.1', resolve));
const controlPort = controlProbe.address().port;
await new Promise((resolve) => controlProbe.close(resolve));
const token = randomUUID();
let latest = '1.3.1';
let mode = 'normal';
let interrupted = 0;
const artifacts = new Map();
const feedServer = createServer(async (req, res) => {
  report.requests.push({ time: new Date().toISOString(), url: req.url, mode });
  try {
    if (mode === 'offline') {
      res.writeHead(503).end('Test connection failure');
      return;
    }
    if (req.url.includes('/RELEASES')) {
      const manifest = await readFile(
        join(artifacts.get(latest), 'RELEASES'),
        'utf8'
      );
      const packageName = manifest.trim().split(/\s+/)[1];
      res.end(
        manifest.replace(
          packageName,
          `http://127.0.0.1:${feedServer.address().port}/packages/${latest}/${packageName}`
        )
      );
      return;
    }
    const match = /^\/packages\/(1\.3\.[12])\/([^/?]+\.nupkg)/.exec(req.url);
    if (!match || match[2] !== `${id}-${match[1]}-full.nupkg`) {
      res.writeHead(404).end();
      return;
    }
    const file = join(artifacts.get(match[1]), match[2]);
    const stream = createReadStream(file, { highWaterMark: 256 * 1024 });
    res.on('close', () => stream.destroy());
    stream.on('error', (error) => res.destroy(error));
    if (mode === 'interrupt') {
      interrupted++;
      stream.once('data', (chunk) => {
        res.write(chunk);
        res.destroy();
        stream.destroy();
      });
      return;
    }
    stream.on('data', (chunk) => {
      stream.pause();
      res.write(chunk);
      setTimeout(() => stream.resume(), 3);
    });
    stream.on('end', () => res.end());
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => feedServer.listen(0, '127.0.0.1', resolve));
const feed = `http://127.0.0.1:${feedServer.address().port}`;
const config = {
  feed,
  controlPort,
  token,
  profile,
  log: join(root, 'events.jsonl')
};

function run(executable, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, cwd: root });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out: ${executable}\n${output}`));
    }, timeout);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${executable} exited ${code}\n${output}`));
      }
    });
  });
}
async function request(path = '/status', input) {
  const response = await fetch(`http://127.0.0.1:${controlPort}${path}`, {
    method: input ? 'POST' : 'GET',
    headers: { 'x-test-token': token },
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(3000)
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
async function until(label, predicate, timeout = 60_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await request();
      if (await predicate(last)) {
        return last;
      }
    } catch {
      /* Restart can close the connection. */
    }
    await delay(250);
  }
  throw new Error(`Timed out: ${label}. Last state: ${JSON.stringify(last)}`);
}
async function click(label) {
  return request('/click', { label });
}
function passed(check, detail) {
  console.log(`PASS: ${check}`);
  report.checks.push({ check, detail, time: new Date().toISOString() });
}
const has = (state, label) =>
  state.menu?.some((item) => item.label === label && item.enabled);
async function build(version) {
  console.log(`Build isolated release ${version}`);
  const appDirectory = join(root, `build-${version}`);
  await cp(join(project, 'out', 'FixLinks-win32-x64'), appDirectory, {
    recursive: true
  });
  const appSource = join(root, `source-${version}`);
  extractAll(join(appDirectory, 'resources', 'app.asar'), appSource);
  const metadata = JSON.parse(
    await readFile(join(appSource, 'package.json'), 'utf8')
  );
  Object.assign(metadata, {
    name: id,
    productName: `FixLinks Update Test ${id}`,
    version,
    main: 'installed-app.cjs'
  });
  await writeFile(join(appSource, 'package.json'), JSON.stringify(metadata));
  await cp(
    join(project, 'test', 'fixtures', 'installed-app.cjs'),
    join(appSource, 'installed-app.cjs')
  );
  await writeFile(
    join(appSource, 'installed-test.json'),
    JSON.stringify(config)
  );
  await createPackage(appSource, join(appDirectory, 'resources', 'app.asar'));
  await rename(
    join(appDirectory, 'FixLinks.exe'),
    join(appDirectory, 'FixLinksUpdateTest.exe')
  );
  await run(makerRequire.resolve('electron-winstaller/vendor/rcedit.exe'), [
    join(appDirectory, 'FixLinksUpdateTest.exe'),
    '--set-version-string',
    'ProductName',
    `FixLinks Update Test ${id}`,
    '--set-version-string',
    'CompanyName',
    id,
    '--set-file-version',
    version,
    '--set-product-version',
    version
  ]);
  const outputDirectory = join(root, `release-${version}`);
  await createWindowsInstaller({
    appDirectory,
    outputDirectory,
    name: id,
    exe: 'FixLinksUpdateTest.exe',
    version,
    setupExe: 'FixLinksUpdateTestSetup.exe',
    noMsi: true,
    noDelta: true,
    skipUpdateIcon: true
  });
  artifacts.set(version, outputDirectory);
}

try {
  const publicFeed = await fetch(
    'https://update.electronjs.org/goodmorningkay/fixlinks/win32-x64/1.3.0/RELEASES',
    { signal: AbortSignal.timeout(20_000) }
  );
  assert.ok(publicFeed.ok);
  const publicManifest = await publicFeed.text();
  assert.match(
    publicManifest,
    /https:\/\/github\.com\/goodmorningkay\/fixlinks\/releases\/download\/v[\d.]+\/fixlinks-[\d.]+-full\.nupkg/
  );
  passed('The public GitHub feed returns a usable Squirrel package URL');
  for (const version of report.versions) {
    await build(version);
  }
  await mkdir(profile, { recursive: true });
  const saved = {
    automaticUpdates: false,
    runAtLogin: false,
    removeMetadata: true,
    instagram: true,
    twitter: false,
    tiktok: true,
    targetHosts: {
      instagram: 'test.example.com',
      twitter: 'x.example.com',
      tiktok: 'tiktok.example.com'
    }
  };
  await writeFile(join(profile, 'config.json'), JSON.stringify(saved));
  // Squirrel derives its install parent from Update.exe. Keep it outside the target it creates.
  const installer = join(root, 'installed', 'SquirrelTemp', 'Update.exe');
  await mkdir(dirname(installer), { recursive: true });
  await cp(
    makerRequire.resolve('electron-winstaller/vendor/Squirrel.exe'),
    installer
  );
  assert.ok(
    resolve(install).startsWith(`${resolve(root)}\\`),
    'Install must stay within this test run.'
  );
  console.log(`Install release 1.3.1 into ${install}`);
  await run(installer, [`--install=${artifacts.get('1.3.1')}`, '--silent']);
  await run(join(install, 'Update.exe'), [
    '--processStart=FixLinksUpdateTest.exe'
  ]);
  let state = await until('installed older app', (state) =>
    has(state, 'Check for update')
  );
  assert.equal(state.version, '1.3.1');
  assert.ok(state.isPackaged && state.execPath.startsWith(install));
  passed('The older release runs from a real Squirrel installation', {
    version: state.version,
    execPath: state.execPath
  });
  await click('Check for update');
  state = await until('no update result', (state) =>
    state.messages.some(
      (message) => message.message === 'FixLinks is up to date.'
    )
  );
  passed('Manual check works with automatic updates disabled');
  await click('Run at login');
  saved.runAtLogin = true;
  assert.equal((await request()).login.openAtLogin, true);
  passed('Run at login uses the stable installed executable');
  const messages = state.messages.length;
  mode = 'offline';
  await click('Check for update');
  await until(
    'connection failure',
    (state) => state.messages.length > messages
  );
  await request('/clipboard', {
    text: 'https://www.instagram.com/p/TEST?remove=1'
  });
  await until(
    'clipboard monitor after network failure',
    (state) => state.clipboardText === 'https://test.example.com/p/TEST'
  );
  passed('Failed update checks preserve clipboard processing');
  mode = 'interrupt';
  latest = '1.3.2';
  const errorCount = (await request()).messages.length;
  await click('Check for update');
  await until(
    'interrupted download failure',
    (state) => state.messages.length > errorCount,
    120_000
  );
  assert.ok(interrupted > 0);
  passed('An interrupted native download fails and permits retry');
  mode = 'normal';
  await click('Check for update');
  await assert.rejects(() => click('Check for update'), /unavailable/);
  await until(
    'native download completes',
    (state) => has(state, 'Restart to update'),
    120_000
  );
  state = await request();
  assert.ok(
    state.history.some((items) =>
      items.some(
        (item) => item.label === 'Downloading update…' && !item.enabled
      )
    )
  );
  passed('The real updater downloads and stages the newer full package');
  await click('Fix services...');
  await until('settings window', (state) => state.windows.length === 1);
  await request('/dialog', { response: 0 });
  await click('Restart to update');
  await until('return to settings', (state) =>
    state.messages.some(
      (message) => message.buttons?.[0] === 'Return to settings'
    )
  );
  assert.equal((await request()).windows.length, 1);
  passed('Restart returns to open settings when requested');
  saved.targetHosts.instagram = 'saved.example.com';
  await request('/save-settings', { hosts: saved.targetHosts });
  assert.deepEqual(
    JSON.parse(await readFile(join(profile, 'config.json'), 'utf8')),
    saved
  );
  passed('Settings can be saved before restarting');
  await click('Fix services...');
  await until('settings reopened', (state) => state.windows.length === 1);
  await request('/dialog', { response: 1 });
  await click('Restart to update');
  state = await until(
    'restarted newer release',
    (state) => state.version === '1.3.2' && has(state, 'Check for update'),
    120_000
  );
  assert.match(state.execPath, /app-1\.3\.2/);
  assert.deepEqual(
    JSON.parse(await readFile(join(profile, 'config.json'), 'utf8')),
    saved
  );
  assert.equal(state.login.openAtLogin, true);
  await request('/clipboard', {
    text: 'https://www.instagram.com/p/AFTER?remove=1'
  });
  await until(
    'clipboard after update',
    (state) => state.clipboardText === 'https://saved.example.com/p/AFTER'
  );
  passed(
    'Restart starts the newer installed version and preserves settings and clipboard processing',
    { version: state.version, execPath: state.execPath }
  );
  const pid = state.pid;
  await run(join(install, 'app-1.3.2', 'FixLinksUpdateTest.exe'), []);
  assert.equal((await request()).pid, pid);
  passed('The single-instance lock survives the update');
  await click('Automatic updates');
  const requestCount = report.requests.length;
  await until(
    'automatic startup check',
    (state) =>
      report.requests.length > requestCount && has(state, 'Check for update'),
    45_000
  );
  assert.equal((await request()).messages.length, 0);
  passed('Automatic checks run after 30 seconds and stay quiet when current');
  await click('Automatic updates');
  await click('Run at login');
  try {
    await click('Exit');
  } catch {
    /* The app can exit before replying. */
  }
  await delay(1000);
  await run(join(install, 'Update.exe'), ['--uninstall', '--silent']);
  console.log(
    'Repeat installation to test a background download and normal exit'
  );
  await run(installer, [`--install=${artifacts.get('1.3.1')}`, '--silent']);
  await run(join(install, 'Update.exe'), [
    '--processStart=FixLinksUpdateTest.exe'
  ]);
  await until(
    'older app reinstalled',
    (state) => state.version === '1.3.1' && has(state, 'Check for update')
  );
  await click('Automatic updates');
  await until(
    'background update ready',
    (state) => has(state, 'Restart to update'),
    120_000
  );
  passed('An automatic check downloads and stages the newer release');
  try {
    await click('Exit');
  } catch {
    /* Normal exit can close the response. */
  }
  await delay(1000);
  await run(join(install, 'Update.exe'), [
    '--processStart=FixLinksUpdateTest.exe'
  ]);
  state = await until(
    'normal launch uses the staged update',
    (state) => state.version === '1.3.2' && has(state, 'Check for update')
  );
  assert.equal(state.login.openAtLogin, false);
  assert.deepEqual(
    JSON.parse(await readFile(join(profile, 'config.json'), 'utf8')),
    { ...saved, automaticUpdates: true, runAtLogin: false }
  );
  passed('Normal exit and launch start the staged version and retain settings');
  report.result = 'passed';
} catch (error) {
  report.result = 'failed';
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    const state = await request();
    if (
      state.menu?.some((item) => item.label === 'Run at login' && item.checked)
    ) {
      await click('Run at login');
    }
    await click('Exit');
  } catch {
    /* App shutdown can close the response. */
  }
  await delay(1000);
  try {
    assert.ok(resolve(install).startsWith(`${resolve(root)}\\`));
    await run(join(install, 'Update.exe'), ['--uninstall', '--silent']);
    report.cleanup = 'uninstalled';
  } catch (error) {
    report.cleanup = String(error);
  }
  feedServer.closeAllConnections();
  await new Promise((resolve) => feedServer.close(resolve));
  await writeFile(
    join(root, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    `Installed update test: ${report.result}. Report: ${join(root, 'report.json')}`
  );
}
