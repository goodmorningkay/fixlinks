import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function verifyReleaseArtifacts(directory, version, tag) {
  assert.equal(tag, `v${version}`, 'The release tag must match package.json.');
  assert.match(
    version,
    /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/,
    'Unsupported release version.'
  );
  // Match electron-winstaller's NuGet version conversion for prereleases.
  const [base, ...suffix] = version.split('-');
  const packageVersion = suffix.length
    ? `${base}-${suffix.join('-').replaceAll('.', '')}`
    : base;
  const packageName = `fixlinks-${packageVersion}-full.nupkg`;
  const expectedFiles = ['FixLinksSetup.exe', 'RELEASES', packageName];
  assert.deepEqual(
    readdirSync(directory).sort(),
    expectedFiles.sort(),
    'Unexpected or missing release files.'
  );
  for (const name of expectedFiles) {
    const file = statSync(join(directory, name));
    assert.ok(
      file.isFile() && file.size > 0,
      `${name} must be a nonempty file.`
    );
  }

  const manifest = readFileSync(join(directory, 'RELEASES'), 'utf8').trim();
  const entries = manifest.split(/\r?\n/);
  assert.equal(entries.length, 1, 'Publish one full package per release.');
  const entry = /^([\da-f]{40})\s+(\S+)\s+(\d+)$/i.exec(entries[0]);
  assert.ok(entry, 'Invalid Squirrel RELEASES manifest.');
  const [, hash, name, size] = entry;
  assert.equal(
    name,
    packageName,
    'RELEASES must reference the current full package.'
  );
  const packageBytes = readFileSync(join(directory, packageName));
  assert.equal(
    Number(size),
    packageBytes.length,
    'Package size does not match RELEASES.'
  );
  assert.equal(
    hash.toLowerCase(),
    createHash('sha1').update(packageBytes).digest('hex'),
    'Package hash does not match RELEASES.'
  );
  return expectedFiles;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const { version } = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8')
  );
  verifyReleaseArtifacts(
    resolve(
      process.argv[2] ?? join(projectRoot, 'out/make/squirrel.windows/x64')
    ),
    version,
    process.env.GITHUB_REF_NAME
  );
  console.log(`Verified Squirrel release v${version}.`);
}
