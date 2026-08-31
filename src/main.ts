import path from 'node:path';
import { existsSync } from 'node:fs';
import squirrelStartup from 'electron-squirrel-startup';
import Store from 'electron-store';
import { app, clipboard, Menu, Tray } from 'electron';
import {
  processClipboardOnce,
  type ClipboardTextPort
} from './clipboard-monitor.js';

const POLL_INTERVAL_MS = 500;
const LOGIN_ITEM_ARGS = ['--started-at-login'];

type LoginSettings = {
  runAtLogin: boolean;
};

const clipboardPort: ClipboardTextPort = {
  async readText(): Promise<string> {
    return clipboard.readText();
  },
  async writeText(text: string): Promise<void> {
    await clipboard.writeText(text);
  }
};

let tray: Tray | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let previousClipboardText: string | undefined;
let enabled = true;
let runAtLogin = true;
let loginItemPath = process.execPath;
let settings: Store<LoginSettings> | undefined;
let isQuitting = false;

function getStableLoginItemPath(): string {
  const stablePath = path.resolve(
    path.dirname(process.execPath),
    '..',
    path.basename(process.execPath)
  );
  return existsSync(stablePath) ? stablePath : process.execPath;
}

function getLoginItemOptions(): { path: string; args: string[] } {
  return {
    path: loginItemPath,
    args: [...LOGIN_ITEM_ARGS]
  };
}

function applyLoginItemSetting(openAtLogin: boolean): boolean | undefined {
  try {
    const options = getLoginItemOptions();
    app.setLoginItemSettings({
      ...options,
      openAtLogin
    });
    return app.getLoginItemSettings(options).openAtLogin;
  } catch {
    return undefined;
  }
}

function refreshTray(): void {
  if (tray === undefined) {
    return;
  }

  tray.setToolTip(`FixLinks — ${enabled ? 'active' : 'paused'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Enabled',
        type: 'checkbox',
        checked: enabled,
        click: () => {
          const wasEnabled = enabled;
          enabled = !wasEnabled;
          if (!wasEnabled && enabled) {
            previousClipboardText = undefined;
          }
          refreshTray();
        }
      },
      {
        label: 'Run at login',
        type: 'checkbox',
        checked: runAtLogin,
        enabled: app.isPackaged,
        click: () => {
          if (!app.isPackaged || settings === undefined) {
            return;
          }
          const actualValue = applyLoginItemSetting(!runAtLogin);
          if (actualValue === undefined) {
            return;
          }
          runAtLogin = actualValue;
          settings.set('runAtLogin', actualValue);
          refreshTray();
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          app.quit();
        }
      }
    ])
  );
}

function stopClipboardPolling(): void {
  if (pollTimer !== undefined) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }
}

async function pollClipboard(): Promise<void> {
  if (isQuitting) {
    return;
  }

  previousClipboardText = await processClipboardOnce(
    clipboardPort,
    previousClipboardText,
    enabled
  );

  if (!isQuitting) {
    pollTimer = setTimeout(() => {
      void pollClipboard();
    }, POLL_INTERVAL_MS);
  }
}

async function startApplication(): Promise<void> {
  settings = new Store<LoginSettings>({
    schema: {
      runAtLogin: {
        type: 'boolean',
        default: true
      }
    },
    defaults: {
      runAtLogin: true
    }
  });

  loginItemPath = app.isPackaged ? getStableLoginItemPath() : process.execPath;
  runAtLogin = settings.get('runAtLogin');
  if (app.isPackaged) {
    const actualValue = applyLoginItemSetting(runAtLogin);
    if (actualValue !== undefined) {
      runAtLogin = actualValue;
      settings.set('runAtLogin', actualValue);
    }
  }

  try {
    previousClipboardText = await clipboard.readText();
  } catch {
    previousClipboardText = undefined;
  }

  tray = new Tray(path.join(app.getAppPath(), 'assets', 'fixlinks.ico'));
  refreshTray();
  void pollClipboard();
}

app.on('before-quit', () => {
  isQuitting = true;
  stopClipboardPolling();
  tray?.destroy();
  tray = undefined;
});

if (squirrelStartup) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(startApplication).catch(() => {
    app.quit();
  });
}
