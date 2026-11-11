export type AppUpdateMode = 'flexible' | 'immediate';
export type AppUpdateStartResult = 'accepted' | 'cancelled' | 'unavailable';
export type AppUpdateAvailability = 'unknown' | 'not-available' | 'available' | 'in-progress';
export type AppUpdateInstallStatus =
  | 'unknown' | 'pending' | 'downloading' | 'downloaded'
  | 'installing' | 'installed' | 'failed' | 'cancelled';

/** Store observations only. They never grant permission to interrupt wallet work. */
export type AppUpdateState = Readonly<{
  supported: boolean;
  storeAvailable: boolean;
  storeErrorCode: number | null;
  availability: AppUpdateAvailability;
  installedVersionCode: number | null;
  availableVersionCode: number | null;
  priority: number | null;
  stalenessDays: number | null;
  installStatus: AppUpdateInstallStatus;
  bytesDownloaded: number;
  totalBytesToDownload: number;
  flexibleAllowed: boolean;
  immediateAllowed: boolean;
}>;

export const unavailableAppUpdateState: AppUpdateState = Object.freeze({
  supported: false,
  storeAvailable: false,
  storeErrorCode: null,
  availability: 'unknown',
  installedVersionCode: null,
  availableVersionCode: null,
  priority: null,
  stalenessDays: null,
  installStatus: 'unknown',
  bytesDownloaded: 0,
  totalBytesToDownload: 0,
  flexibleAllowed: false,
  immediateAllowed: false,
});

export type AppUpdateNativePort = {
  check(): Promise<AppUpdateState>;
  prepareUpdate(): string;
  cancelPendingUpdate(token: string): boolean;
  start(token: string, mode: AppUpdateMode): Promise<AppUpdateStartResult>;
  complete(token: string): Promise<void>;
  addListener(event: 'onUpdateState', listener: (state: AppUpdateState) => void): { remove(): void };
};

/** Kept independent of React Native so unsupported hosts and action dispatch are testable. */
export function createAppUpdateAdapter(native: () => AppUpdateNativePort | null) {
  const cancelled = () => Object.assign(new Error('APP_UPDATE_CANCELLED'), { name: 'AbortError' });
  async function mutate<T>(port: AppUpdateNativePort, signal: AbortSignal | undefined, action: (token: string) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw cancelled();
    const token = port.prepareUpdate();
    const abort = () => { port.cancelPendingUpdate(token); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) {
        abort();
        throw cancelled();
      }
      return await action(token);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'APP_UPDATE_CANCELLED') {
        throw cancelled();
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      port.cancelPendingUpdate(token);
    }
  }
  return {
    async checkAppUpdate(): Promise<AppUpdateState> {
      return native()?.check() ?? unavailableAppUpdateState;
    },
    async startAppUpdate(mode: AppUpdateMode = 'flexible', signal?: AbortSignal): Promise<AppUpdateStartResult> {
      if (mode !== 'flexible' && mode !== 'immediate') throw new Error('APP_UPDATE_INVALID_MODE');
      const port = native();
      return port ? mutate(port, signal, (token) => port.start(token, mode)) : 'unavailable';
    },
    async completeAppUpdate(signal?: AbortSignal): Promise<void> {
      const port = native();
      if (!port) throw new Error('APP_UPDATE_UNAVAILABLE');
      await mutate(port, signal, (token) => port.complete(token));
    },
    subscribeAppUpdates(listener: (state: AppUpdateState) => void): () => void {
      const subscription = native()?.addListener('onUpdateState', listener);
      return () => subscription?.remove();
    },
  };
}
