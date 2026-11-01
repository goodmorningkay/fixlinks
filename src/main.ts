import path from 'node:path';
import { existsSync } from 'node:fs';
import squirrelStartup from 'electron-squirrel-startup';
import Store from 'electron-store';
import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
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
import {
  getUpdateMenu,
  UpdateManager,
  type UpdateNotice
} from './update-manager.js';

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
  automaticUpdates: boolean;
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
let updateManager: UpdateManager | undefined;
let restartPromptOpen = false;

function showUpdateNotice(notice: UpdateNotice): void {
  if (notice === 'error' && isQuitting && updateManager?.state === 'ready') {
    isQuitting = false;
    void pollClipboard();
  }
  if (isQuitting) {
    return;
  }
  if (notice === 'ready') {
    tray?.displayBalloon({
      title: 'FixLinks update ready',
      content:
        'Select Restart to update from the tray menu, or restart FixLinks later.'
    });
    return;
  }
  void dialog
    .showMessageBox({
      type: notice === 'error' ? 'warning' : 'info',
      title: 'FixLinks updates',
      message:
        notice === 'current'
          ? 'FixLinks is up to date.'
          : 'Could not complete the update. Try again later.',
      detail: `Installed version: ${app.getVersion()}`
    })
    .catch(() => {});
}

async function restartForUpdate(): Promise<void> {
  if (restartPromptOpen || updateManager?.state !== 'ready' || isQuitting) {
    return;
  }
  restartPromptOpen = true;
  try {
    if (settingsWindow !== undefined) {
      settingsWindow.show();
      settingsWindow.focus();
      const { response } = await dialog.showMessageBox(settingsWindow, {
        type: 'question',
        title: 'Restart to update',
        message: 'The settings window is open.',
        detail:
          'Return to settings to save your changes, or discard changes and restart.',
        buttons: ['Return to settings', 'Discard changes and restart'],
        defaultId: 0,
        cancelId: 0
      });
      if (response !== 1 || isQuitting) {
        return;
      }
    }
    // Finish a clipboard write before asking Squirrel to restart this process.
    isQuitting = true;
    stopClipboardPolling();
    await clipboardPass;
    stopClipboardPolling();
    if (!updateManager.restart() && isQuitting) {
      isQuitting = false;
      void pollClipboard();
      showUpdateNotice('error');
    }
  } catch {
    isQuitting = false;
    if (pollTimer === undefined && clipboardPass === undefined) {
      void pollClipboard();
    }
    showUpdateNotice('error');
  } finally {
    restartPromptOpen = false;
  }
}

function toggleAutomaticUpdates(): void {
  if (settings === undefined || updateManager === undefined) {
    return;
  }
  const nextValue = !updateManager.automaticUpdates;
  try {
    settings.set('automaticUpdates', nextValue);
    updateManager.setAutomaticUpdates(nextValue);
    refreshTray();
  } catch {
    showUpdateNotice('error');
  }
}

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
      { label: `FixLinks ${app.getVersion()}`, enabled: false },
      {
        label: 'Automatic updates',
        type: 'checkbox',
        checked: updateManager?.automaticUpdates ?? true,
        enabled:
          updateManager !== undefined && updateManager.state !== 'unavailable',
        click: toggleAutomaticUpdates
      },
      {
        ...getUpdateMenu(updateManager?.state ?? 'unavailable'),
        click: () => {
          if (updateManager?.state === 'ready') {
            void restartForUpdate();
          } else {
            updateManager?.check();
          }
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
            errors[service] = 'Use a full hostname such as example.com.';
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
      automaticUpdates: {
        type: 'boolean',
        default: true
      },
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
      automaticUpdates: true,
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
  updateManager = new UpdateManager({
    updater: autoUpdater,
    environment: {
      isPackaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      hasSquirrel: existsSync(
        path.resolve(path.dirname(process.execPath), '..', 'Update.exe')
      ),
      version: app.getVersion()
    },
    automaticUpdates: settings.get('automaticUpdates'),
    firstRun: process.argv.includes('--squirrel-firstrun'),
    onStateChange: refreshTray,
    onNotice: showUpdateNotice
  });
  updateManager.start();
  refreshTray();
  if (loadedTargetHosts.invalid) {
    openSettingsWindow();
  }
  void pollClipboard();
}

app.on('before-quit', () => {
  isQuitting = true;
  updateManager?.stop();
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
  void app
    .whenReady()
    .then(startApplication)
    .catch(() => {
      app.quit();
    });
}
