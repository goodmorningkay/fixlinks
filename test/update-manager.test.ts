import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { type TestContext } from 'node:test';
import {
  FIRST_RUN_DELAY_MS,
  STARTUP_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  getUpdateFeedURL,
  getUpdateMenu,
  UpdateManager,
  type UpdateEnvironment,
  type UpdateNotice,
  type UpdateState
} from '../src/update-manager.js';

const environment: UpdateEnvironment = {
  isPackaged: true,
  platform: 'win32',
  arch: 'x64',
  hasSquirrel: true,
  version: '1.4.0'
};

class FakeUpdater extends EventEmitter {
  feeds: string[] = [];
  checks = 0;
  installs = 0;
  feedError = false;
  checkError: 'throw' | 'reject' | undefined;
  installError: 'throw' | 'emit' | undefined;

  setFeedURL({ url }: { url: string }): void {
    if (this.feedError) {
      throw new Error('Invalid feed');
    }
    this.feeds.push(url);
  }

  checkForUpdates(): void | Promise<void> {
    this.checks++;
    if (this.checkError === 'throw') {
      throw new Error('Offline');
    }
    if (this.checkError === 'reject') {
      return Promise.reject(new Error('Offline'));
    }
  }

  quitAndInstall(): void {
    this.installs++;
    if (this.installError === 'throw') {
      throw new Error('Install failed');
    }
    if (this.installError === 'emit') {
      this.emit('error', new Error('Install failed'));
    }
  }
}

function setup(
  t: TestContext,
  options: {
    automaticUpdates?: boolean;
    firstRun?: boolean;
    environment?: Partial<UpdateEnvironment>;
  } = {}
) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updater = new FakeUpdater();
  const notices: UpdateNotice[] = [];
  const states: UpdateState[] = [];
  const manager = new UpdateManager({
    updater,
    environment: { ...environment, ...options.environment },
    automaticUpdates: options.automaticUpdates ?? true,
    firstRun: options.firstRun ?? false,
    onNotice: (notice) => notices.push(notice),
    onStateChange: () => states.push(manager.state)
  });
  t.after(() => manager.stop());
  manager.start();
  return { manager, updater, notices, states };
}

test('uses the fixed GitHub release feed and installed version', () => {
  assert.equal(
    getUpdateFeedURL(environment),
    'https://update.electronjs.org/goodmorningkay/fixlinks/win32-x64/1.4.0'
  );
});

for (const unsupported of [
  { isPackaged: false },
  { platform: 'linux' },
  { platform: 'darwin' },
  { arch: 'arm64' },
  { arch: 'ia32' },
  { hasSquirrel: false }
]) {
  test(`disables updates for ${JSON.stringify(unsupported)}`, (t) => {
    const { manager, updater } = setup(t, { environment: unsupported });
    assert.equal(manager.state, 'unavailable');
    assert.equal(manager.check(), false);
    manager.setAutomaticUpdates(true);
    t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS);
    assert.equal(updater.checks, 0);
    assert.deepEqual(updater.feeds, []);
  });
}

test('checks after startup, then six hours after completion', (t) => {
  const { manager, updater, notices } = setup(t);
  t.mock.timers.tick(STARTUP_CHECK_DELAY_MS - 1);
  assert.equal(updater.checks, 0);
  t.mock.timers.tick(1);
  assert.equal(updater.checks, 1);
  assert.equal(manager.state, 'checking');
  updater.emit('update-not-available');
  assert.deepEqual(notices, []);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS - 1);
  assert.equal(updater.checks, 1);
  t.mock.timers.tick(1);
  assert.equal(updater.checks, 2);
  assert.equal(updater.feeds.length, 1);
});

test('manual checks work with automatic updates disabled and show the result', (t) => {
  const { manager, updater, notices } = setup(t, { automaticUpdates: false });
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS);
  assert.equal(updater.checks, 0);
  assert.equal(manager.check(), true);
  updater.emit('update-not-available');
  assert.equal(manager.state, 'idle');
  assert.deepEqual(notices, ['current']);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS);
  assert.equal(updater.checks, 1);
});

test('blocks duplicate checks throughout the check and download', (t) => {
  const { manager, updater } = setup(t);
  manager.start();
  assert.equal(manager.check(), true);
  assert.equal(manager.check(), false);
  updater.emit('update-available');
  assert.equal(manager.state, 'downloading');
  assert.equal(manager.check(), false);
  manager.setAutomaticUpdates(true);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS * 2);
  assert.equal(updater.checks, 1);
});

test('blocks manual checks during the Squirrel first-run lock', (t) => {
  const { manager, updater } = setup(t, { firstRun: true });
  assert.equal(manager.state, 'waiting');
  assert.equal(manager.check(), false);
  t.mock.timers.tick(FIRST_RUN_DELAY_MS - 1);
  assert.equal(manager.check(), false);
  t.mock.timers.tick(1);
  assert.equal(manager.check(), true);
  assert.equal(updater.checks, 1);
});

test('first-run lock expires even when automatic checks are disabled', (t) => {
  const { manager, updater } = setup(t, {
    firstRun: true,
    automaticUpdates: false
  });
  t.mock.timers.tick(FIRST_RUN_DELAY_MS);
  assert.equal(manager.state, 'idle');
  assert.equal(updater.checks, 0);
  assert.equal(manager.check(), true);
});

test('disabling automatic updates clears the scheduled check', (t) => {
  const { manager, updater } = setup(t);
  manager.setAutomaticUpdates(false);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS * 2);
  assert.equal(updater.checks, 0);
  manager.setAutomaticUpdates(true);
  t.mock.timers.tick(STARTUP_CHECK_DELAY_MS);
  assert.equal(updater.checks, 1);
});

test('disabling automatic updates preserves an active download', (t) => {
  const { manager, updater, notices } = setup(t);
  manager.check();
  updater.emit('update-available');
  manager.setAutomaticUpdates(false);
  updater.emit('update-downloaded');
  assert.equal(manager.state, 'ready');
  assert.deepEqual(notices, ['ready']);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS);
  assert.equal(updater.checks, 1);
});

test('a completed background download waits for a restart', (t) => {
  const { manager, updater, notices } = setup(t);
  assert.equal(manager.restart(), false);
  t.mock.timers.tick(STARTUP_CHECK_DELAY_MS);
  updater.emit('update-available');
  updater.emit('update-downloaded');
  updater.emit('update-downloaded');
  manager.setAutomaticUpdates(true);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS);
  assert.deepEqual(notices, ['ready']);
  assert.equal(updater.installs, 0);
  assert.equal(manager.check(), false);
  assert.equal(manager.restart(), true);
  assert.equal(manager.restart(), false);
  assert.equal(updater.installs, 1);
});

test('manual failures allow a retry without restarting the app', (t) => {
  const { manager, updater, notices } = setup(t);
  manager.check();
  updater.emit('error', new Error('Offline'));
  assert.equal(manager.state, 'error');
  assert.deepEqual(notices, ['error']);
  manager.check();
  updater.emit('update-not-available');
  assert.equal(updater.checks, 2);
  assert.deepEqual(notices, ['error', 'current']);
});

test('background failures are quiet and retry after six hours', (t) => {
  const { updater, notices } = setup(t);
  t.mock.timers.tick(STARTUP_CHECK_DELAY_MS);
  updater.emit('error', new Error('Offline'));
  assert.deepEqual(notices, []);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS);
  assert.equal(updater.checks, 2);
});

test('interrupted downloads report failure and can be checked again', (t) => {
  const { manager, updater, notices } = setup(t);
  manager.check();
  updater.emit('update-available');
  updater.emit('error', new Error('Connection lost'));
  assert.equal(manager.state, 'error');
  assert.deepEqual(notices, ['error']);
  assert.equal(manager.restart(), false);
  assert.equal(manager.check(), true);
});

for (const mode of ['throw', 'reject'] as const) {
  test(`handles a check that fails with ${mode}`, async (t) => {
    const { manager, updater, notices } = setup(t);
    updater.checkError = mode;
    manager.check();
    await Promise.resolve();
    assert.equal(manager.state, 'error');
    assert.deepEqual(notices, ['error']);
  });
}

test('retries feed setup after a failure', (t) => {
  const { manager, updater, notices } = setup(t);
  updater.feedError = true;
  manager.check();
  assert.equal(manager.state, 'error');
  assert.deepEqual(notices, ['error']);
  assert.equal(updater.checks, 0);
  updater.feedError = false;
  manager.check();
  assert.equal(updater.feeds.length, 1);
  assert.equal(updater.checks, 1);
});

for (const mode of ['throw', 'emit'] as const) {
  test(`keeps the restart option after an install failure (${mode})`, (t) => {
    const { manager, updater, notices } = setup(t);
    manager.check();
    updater.emit('update-available');
    updater.emit('update-downloaded');
    updater.installError = mode;
    assert.equal(manager.restart(), false);
    assert.equal(manager.state, 'ready');
    assert.deepEqual(notices, ['ready', 'error']);
  });
}

test('reports a delayed installation error and permits another restart', (t) => {
  const { manager, updater, notices } = setup(t);
  manager.check();
  updater.emit('update-available');
  updater.emit('update-downloaded');
  assert.equal(manager.restart(), true);
  updater.emit('error', new Error('Delayed install failure'));
  assert.equal(manager.state, 'ready');
  assert.deepEqual(notices, ['ready', 'error']);
  assert.equal(manager.restart(), true);
});

test('stop clears timers and ignores late native events', (t) => {
  const { manager, updater, notices, states } = setup(t, { firstRun: true });
  manager.stop();
  const count = states.length;
  manager.setAutomaticUpdates(true);
  manager.start();
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL_MS);
  updater.emit('error', new Error('Late error'));
  updater.emit('update-available');
  updater.emit('update-downloaded');
  updater.emit('update-not-available');
  assert.equal(states.length, count);
  assert.equal(updater.checks, 0);
  assert.deepEqual(notices, []);
  assert.equal(manager.check(), false);
  assert.equal(manager.restart(), false);
});

test('stop during a download prevents notices and restart', (t) => {
  const { manager, updater, notices } = setup(t);
  manager.check();
  updater.emit('update-available');
  manager.stop();
  updater.emit('update-downloaded');
  assert.deepEqual(notices, []);
  assert.equal(manager.restart(), false);
});

test('tray labels and actions follow the update state', () => {
  const expected: Array<[UpdateState, string, boolean]> = [
    ['unavailable', 'Updates require the Windows installer', false],
    ['waiting', 'Updates start shortly…', false],
    ['idle', 'Check for update', true],
    ['checking', 'Checking for update…', false],
    ['downloading', 'Downloading update…', false],
    ['ready', 'Restart to update', true],
    ['installing', 'Restarting…', false],
    ['error', 'Check for update', true]
  ];
  for (const [state, label, enabled] of expected) {
    assert.deepEqual(getUpdateMenu(state), { label, enabled });
  }
});
