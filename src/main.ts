import path from 'node:path';
import { existsSync } from 'node:fs';
import squirrelStartup from 'electron-squirrel-startup';
import Store from 'electron-store';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  Tray
} from 'electron';
import {
  processClipboardOnce,
  type ClipboardTextPort
} from './clipboard-monitor.js';
import {
  DEFAULT_LINK_REWRITE_OPTIONS,
  DEFAULT_TARGET_HOSTS,
  LINK_SERVICES,
  loadTargetHosts,
  validateTargetHostname,
  validateTargetHosts,
  type LinkRewriteOptions,
  type LinkService
} from './link-transformer.js';

const POLL_INTERVAL_MS = 500;
const LOGIN_ITEM_ARGS = ['--started-at-login'];
const clipboardPort: ClipboardTextPort = {
  async readText(): Promise<string> {
    return clipboard.readText();
  },
  async writeText(text: string): Promise<void> {
    await clipboard.writeText(text);
  }
};

type AppSettings = {
  runAtLogin: boolean;
  removeMetadata: boolean;
  instagram: boolean;
  twitter: boolean;
  tiktok: boolean;
  targetHosts: unknown;
};

let tray: Tray | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let clipboardPass: Promise<string | undefined> | undefined;
let previousClipboardText: string | undefined;
let enabled = true;
let runAtLogin = true;
let rewriteOptions: LinkRewriteOptions = DEFAULT_LINK_REWRITE_OPTIONS;
let loginItemPath = process.execPath;
let settings: Store<AppSettings> | undefined;
let isQuitting = false;
let settingsWindow: BrowserWindow | undefined;


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

function toggleMetadataRemoval(): void {
  if (settings === undefined) {
    return;
  }

  const nextValue = !rewriteOptions.removeMetadata;
  rewriteOptions = {
    ...rewriteOptions,
    removeMetadata: nextValue
  };
  settings.set('removeMetadata', nextValue);
  previousClipboardText = undefined;
  refreshTray();
}

function toggleService(service: LinkService): void {
  if (settings === undefined) {
    return;
  }

  const nextValue = !rewriteOptions.services[service];
  rewriteOptions = {
    ...rewriteOptions,
    services: {
      ...rewriteOptions.services,
      [service]: nextValue
    }
  };
  settings.set(service, nextValue);
  previousClipboardText = undefined;
  refreshTray();
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
        label: 'Remove metadata',
        type: 'checkbox',
        checked: rewriteOptions.removeMetadata,
        click: () => toggleMetadataRemoval()
      },
      {
        label: 'Services',
        submenu: [
          {
            label: 'Instagram',
            type: 'checkbox',
            checked: rewriteOptions.services.instagram,
            click: () => toggleService('instagram')
          },
          {
            label: 'X/Twitter',
            type: 'checkbox',
            checked: rewriteOptions.services.twitter,
            click: () => toggleService('twitter')
          },
          {
            label: 'TikTok',
            type: 'checkbox',
            checked: rewriteOptions.services.tiktok,
            click: () => toggleService('tiktok')
          }
        ]
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
      {
        label: 'Fix services...',
        click: () => {
          openSettingsWindow();
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

  clipboardPass = processClipboardOnce(
    clipboardPort,
    previousClipboardText,
    enabled,
    rewriteOptions
  );
  previousClipboardText = await clipboardPass;
  clipboardPass = undefined;

  if (!isQuitting) {
    pollTimer = setTimeout(() => {
      void pollClipboard();
    }, POLL_INTERVAL_MS);
  }
}

function openSettingsWindow(): void {
  if (settingsWindow !== undefined) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const rendererViewPath = path.join(app.getAppPath(), 'dist', 'renderer');
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 440,
    height: 600,
    resizable: false,
    autoHideMenuBar: true,
    title: 'Fix services',
    webPreferences: {
      preload: path.join(rendererViewPath, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
  settingsWindow = new BrowserWindow(windowOptions);
  settingsWindow.setMenu(null);
  settingsWindow.on('closed', () => {
    settingsWindow = undefined;
  });
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  void settingsWindow.loadFile(path.join(rendererViewPath, 'settings.html'));
}

function getSavedTargetWarning(): string | null {
  if (settings === undefined) {
    return null;
  }
  const loaded = loadTargetHosts(settings.get('targetHosts'));
  if (!loaded.invalid) {
    return null;
  }
  return (
    'Some saved destination values are invalid. FixLinks is using their ' +
    'defaults. The saved values will not change until you save.'
  );
}

function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (event) => {
    if (
      event.sender !== settingsWindow?.webContents ||
      event.senderFrame !== settingsWindow?.webContents.mainFrame
    ) {
      throw new Error('Rejected settings read from an unknown sender.');
    }
    return {
      hosts: rewriteOptions.targetHosts,
      defaults: DEFAULT_TARGET_HOSTS,
      warning: getSavedTargetWarning()
    };
  });

  ipcMain.handle('settings:save', async (event, input: unknown) => {
    if (
      event.sender !== settingsWindow?.webContents ||
      event.senderFrame !== settingsWindow?.webContents.mainFrame
    ) {
      throw new Error('Rejected settings save from an unknown sender.');
    }
    if (settings === undefined) {
      return { ok: false, errors: { general: 'Settings are not ready yet.' } };
    }

    const targets = validateTargetHosts(input);
    if (targets === null) {
      const errors: Record<string, string> = {};
      if (
        typeof input === 'object' &&
        input !== null &&
        !Array.isArray(input)
      ) {
        const record = input as Record<string, unknown>;
        for (const service of LINK_SERVICES) {
          if (validateTargetHostname(record[service]) === null) {
            errors[service] =
              'Use a full hostname such as example.com.';
          }
        }
      }
      if (Object.keys(errors).length === 0) {
        errors.general =
          'The request did not contain the three platform hostnames.';
      }
      return { ok: false, errors };
    }

    // Finish the current poll before changing its options and cached text.
    await clipboardPass;

    try {
      settings.set('targetHosts', targets);
    } catch {
      return { ok: false, errors: { general: 'Saving failed. Try again.' } };
    }

    rewriteOptions = {
      ...rewriteOptions,
      targetHosts: targets
    };
    previousClipboardText = undefined;
    refreshTray();
    return { ok: true };
  });
}

async function startApplication(): Promise<void> {
  settings = new Store<AppSettings>({
    schema: {
      runAtLogin: {
        type: 'boolean',
        default: true
      },
      removeMetadata: {
        type: 'boolean',
        default: false
      },
      instagram: {
        type: 'boolean',
        default: true
      },
      twitter: {
        type: 'boolean',
        default: true
      },
      tiktok: {
        type: 'boolean',
        default: true
      },
      // Validate saved destinations separately so invalid data cannot stop startup.
      targetHosts: {}
    },
    defaults: {
      runAtLogin: true,
      removeMetadata: false,
      instagram: true,
      twitter: true,
      tiktok: true,
      targetHosts: DEFAULT_LINK_REWRITE_OPTIONS.targetHosts
    }
  });

  loginItemPath = app.isPackaged ? getStableLoginItemPath() : process.execPath;
  runAtLogin = settings.get('runAtLogin');
  const loadedTargetHosts = loadTargetHosts(settings.get('targetHosts'));
  rewriteOptions = {
    removeMetadata: settings.get('removeMetadata'),
    services: {
      instagram: settings.get('instagram'),
      twitter: settings.get('twitter'),
      tiktok: settings.get('tiktok')
    },
    targetHosts: loadedTargetHosts.hosts
  };
  registerSettingsIpc();
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
  if (loadedTargetHosts.invalid) {
    openSettingsWindow();
  }
  void pollClipboard();
}

app.on('before-quit', () => {
  isQuitting = true;
  stopClipboardPolling();
  settingsWindow?.close();
  settingsWindow = undefined;
  tray?.destroy();
  tray = undefined;
});

app.on('window-all-closed', () => {
  // The app keeps running from the tray after the settings window closes.
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
