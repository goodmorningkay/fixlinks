import type { AutoUpdater } from 'electron';

export const STARTUP_CHECK_DELAY_MS = 30_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const FIRST_RUN_DELAY_MS = 10_000;

export type UpdateState =
  | 'unavailable'
  | 'waiting'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';
export type UpdateNotice = 'current' | 'ready' | 'error';
export type UpdaterPort = Pick<
  AutoUpdater,
  'setFeedURL' | 'checkForUpdates' | 'quitAndInstall'
> & {
  on(
    event:
      | 'error'
      | 'update-available'
      | 'update-not-available'
      | 'update-downloaded',
    listener: () => void
  ): void;
};

export interface UpdateEnvironment {
  isPackaged: boolean;
  platform: string;
  arch: string;
  hasSquirrel: boolean;
  version: string;
}

export function getUpdateFeedURL(
  environment: UpdateEnvironment
): string | undefined {
  if (
    !environment.isPackaged ||
    environment.platform !== 'win32' ||
    environment.arch !== 'x64' ||
    !environment.hasSquirrel
  ) {
    return undefined;
  }
  return `https://update.electronjs.org/goodmorningkay/fixlinks/win32-x64/${encodeURIComponent(environment.version)}`;
}

export function getUpdateMenu(state: UpdateState): {
  label: string;
  enabled: boolean;
} {
  switch (state) {
    case 'unavailable':
      return { label: 'Updates require the Windows installer', enabled: false };
    case 'waiting':
      return { label: 'Updates start shortly…', enabled: false };
    case 'checking':
      return { label: 'Checking for update…', enabled: false };
    case 'downloading':
      return { label: 'Downloading update…', enabled: false };
    case 'ready':
      return { label: 'Restart to update', enabled: true };
    case 'installing':
      return { label: 'Restarting…', enabled: false };
    default:
      return { label: 'Check for update', enabled: true };
  }
}

interface UpdateManagerOptions {
  updater: UpdaterPort;
  environment: UpdateEnvironment;
  automaticUpdates: boolean;
  firstRun: boolean;
  onStateChange: () => void;
  onNotice: (notice: UpdateNotice) => void;
}

/** Owns the native updater for the lifetime of the main process. */
export class UpdateManager {
  private currentState: UpdateState = 'unavailable';
  private automatic: boolean;
  private readonly options: UpdateManagerOptions;
  private started = false;
  private stopped = false;
  private configured = false;
  private manualCheck = false;
  private firstRunTimer: NodeJS.Timeout | undefined;
  private checkTimer: NodeJS.Timeout | undefined;

  constructor(options: UpdateManagerOptions) {
    this.options = options;
    this.automatic = options.automaticUpdates;
  }

  get state(): UpdateState {
    return this.currentState;
  }

  get automaticUpdates(): boolean {
    return this.automatic;
  }

  start(): void {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    const feedURL = getUpdateFeedURL(this.options.environment);
    if (feedURL === undefined) {
      return;
    }

    const updater = this.options.updater;
    // Keep the error listener until process exit: native work can finish after stop().
    updater.on('error', () => this.fail());
    updater.on('update-available', () => {
      if (this.state === 'checking' && !this.stopped) {
        this.setState('downloading');
      }
    });
    updater.on('update-not-available', () => {
      if (this.state !== 'checking' || this.stopped) {
        return;
      }
      const manual = this.manualCheck;
      this.manualCheck = false;
      this.setState('idle');
      this.scheduleCheck(UPDATE_CHECK_INTERVAL_MS);
      if (manual) {
        this.options.onNotice('current');
      }
    });
    updater.on('update-downloaded', () => {
      if (this.state !== 'downloading' || this.stopped) {
        return;
      }
      this.manualCheck = false;
      this.clearCheckTimer();
      this.setState('ready');
      this.options.onNotice('ready');
    });

    if (this.options.firstRun) {
      this.setState('waiting');
      this.firstRunTimer = setTimeout(() => {
        this.firstRunTimer = undefined;
        this.setState('idle');
      }, FIRST_RUN_DELAY_MS);
    } else {
      this.setState('idle');
    }
    this.scheduleCheck(STARTUP_CHECK_DELAY_MS);
  }

  setAutomaticUpdates(enabled: boolean): void {
    this.automatic = enabled;
    this.clearCheckTimer();
    if (enabled) {
      this.scheduleCheck(STARTUP_CHECK_DELAY_MS);
    }
    // An update already in progress cannot be cancelled by Electron's API.
  }

  check(manual = true): boolean {
    if (this.stopped || !['idle', 'error'].includes(this.state)) {
      return false;
    }
    this.clearCheckTimer();
    this.manualCheck = manual;
    this.setState('checking');
    try {
      if (!this.configured) {
        const url = getUpdateFeedURL(this.options.environment);
        if (url === undefined) {
          return false;
        }
        this.options.updater.setFeedURL({ url });
        this.configured = true;
      }
      // Electron's Windows implementation can return a Promise despite its void type.
      void Promise.resolve(this.options.updater.checkForUpdates()).catch(() =>
        this.fail()
      );
    } catch {
      this.fail();
    }
    return true;
  }

  restart(): boolean {
    if (this.state !== 'ready' || this.stopped) {
      return false;
    }
    this.setState('installing');
    try {
      this.options.updater.quitAndInstall();
      return this.currentState === 'installing';
    } catch {
      this.fail();
      return false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearCheckTimer();
    clearTimeout(this.firstRunTimer);
    this.firstRunTimer = undefined;
  }

  private setState(state: UpdateState): void {
    this.currentState = state;
    this.options.onStateChange();
  }

  private fail(): void {
    if (this.stopped) {
      return;
    }
    if (this.state === 'installing') {
      this.setState('ready');
      this.options.onNotice('error');
      return;
    }
    if (this.state !== 'checking' && this.state !== 'downloading') {
      return;
    }
    const manual = this.manualCheck;
    this.manualCheck = false;
    this.setState('error');
    this.scheduleCheck(UPDATE_CHECK_INTERVAL_MS);
    if (manual) {
      this.options.onNotice('error');
    }
  }

  private scheduleCheck(delay: number): void {
    this.clearCheckTimer();
    if (
      this.stopped ||
      !this.automaticUpdates ||
      [
        'unavailable',
        'checking',
        'downloading',
        'ready',
        'installing'
      ].includes(this.state)
    ) {
      return;
    }
    this.checkTimer = setTimeout(() => {
      this.checkTimer = undefined;
      this.check(false);
    }, delay);
  }

  private clearCheckTimer(): void {
    clearTimeout(this.checkTimer);
    this.checkTimer = undefined;
  }
}
