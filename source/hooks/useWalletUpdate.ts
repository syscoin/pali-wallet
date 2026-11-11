import { useEffect, useSyncExternalStore } from 'react';

import packageJson from '../../package.json';
import {
  isWalletReleaseIdentity,
  readWalletReleaseFeed,
  type WalletReleaseFeed,
} from '../shared/walletRelease';
import {
  WalletReleaseMonitor,
  WALLET_RELEASE_AUTOMATIC_INTERVAL_MS,
  WALLET_RELEASE_MANUAL_INTERVAL_MS,
  type WalletReleaseSnapshot,
} from '../shared/walletReleaseMonitor';
import { PALI_STORES } from '../shared/walletStores';

export const CHROME_WALLET_STORE_URL = PALI_STORES.chrome;

type ChromeUpdateRuntime = Pick<
  typeof chrome.runtime,
  'getManifest' | 'requestUpdateCheck' | 'onUpdateAvailable' | 'lastError'
>;
type BrowserUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'no-update'
  | 'throttled'
  | 'unavailable';
export type WalletUpdateSnapshot = WalletReleaseSnapshot & {
  browserStatus: BrowserUpdateStatus;
  installedVersion: string;
  pendingVersion: string | null;
};
const browserVisibility = {
  isVisible: () =>
    typeof document === 'undefined' || document.visibilityState !== 'hidden',
  subscribe(listener: () => void) {
    if (typeof document === 'undefined') return () => undefined;
    document.addEventListener('visibilitychange', listener);
    window.addEventListener('focus', listener);
    return () => {
      document.removeEventListener('visibilitychange', listener);
      window.removeEventListener('focus', listener);
    };
  },
};

async function fetchReleaseFeed(signal: AbortSignal) {
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 15_000);
  try {
    return await readWalletReleaseFeed(
      (url, init) => fetch(url, init),
      request.signal
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Public release metadata and browser update status; never reloads the wallet. */
export function createWalletUpdateStore({
  runtime,
  fetchFeed = fetchReleaseFeed,
  now = Date.now,
  visibility = browserVisibility,
}: {
  fetchFeed?: (signal: AbortSignal) => Promise<WalletReleaseFeed | null>;
  now?: () => number;
  runtime?: ChromeUpdateRuntime;
  visibility?: typeof browserVisibility;
}) {
  let installedVersion = packageJson.version;
  try {
    const version = runtime?.getManifest()?.version;
    if (isWalletReleaseIdentity({ platform: 'chrome', version }))
      installedVersion = version!;
  } catch {
    // The packaged version still identifies this build outside Chrome.
  }
  const monitor = new WalletReleaseMonitor({
    current: { platform: 'chrome', version: installedVersion },
    fetchFeed,
    now,
  });
  const listeners = new Set<() => void>();
  let disposed = false;
  let browserStatus: BrowserUpdateStatus = 'idle';
  let pendingVersion: string | null = null;
  let browserRevision = 0;
  let lastBrowserCheckAt: number | null = null;
  let owners = 0;
  let automaticTimer: ReturnType<typeof setTimeout> | undefined;
  let unwatchVisibility: (() => void) | undefined;
  let request: Promise<void> | null = null;
  let cancelRequest: (() => void) | undefined;
  let snapshot: WalletUpdateSnapshot = {
    ...monitor.getSnapshot(),
    browserStatus,
    installedVersion,
    pendingVersion,
  };
  const publish = () => {
    if (disposed) return;
    snapshot = {
      ...monitor.getSnapshot(),
      browserStatus,
      installedVersion,
      pendingVersion,
    };
    scheduleAutomatic();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Presentation subscribers cannot change update state.
      }
    }
  };
  function scheduleAutomatic() {
    clearTimeout(automaticTimer);
    automaticTimer = undefined;
    if (disposed || !owners || !visibility.isVisible()) return;
    const checkedAt = monitor.getSnapshot().lastAttemptAt;
    const remaining =
      checkedAt === null
        ? WALLET_RELEASE_AUTOMATIC_INTERVAL_MS
        : checkedAt + WALLET_RELEASE_AUTOMATIC_INTERVAL_MS - now();
    automaticTimer = setTimeout(refresh, Math.max(1000, remaining));
  }
  function refresh() {
    if (disposed || !owners || !visibility.isVisible()) {
      scheduleAutomatic();
      return;
    }
    void monitor.check().finally(scheduleAutomatic);
  }
  const unwatch = monitor.subscribe(publish);
  const receiveUpdate = ({
    version,
  }: chrome.runtime.UpdateAvailableDetails) => {
    if (!isWalletReleaseIdentity({ platform: 'chrome', version })) return;
    browserRevision++;
    pendingVersion = version;
    browserStatus = 'available';
    publish();
  };
  let listening = false;
  const start = () => {
    if (disposed) return () => undefined;
    owners++;
    if (owners === 1) {
      if (runtime?.onUpdateAvailable?.addListener) {
        runtime.onUpdateAvailable.addListener(receiveUpdate);
        listening = true;
      }
      unwatchVisibility = visibility.subscribe(refresh);
      refresh();
    }
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      owners--;
      if (owners) return;
      clearTimeout(automaticTimer);
      automaticTimer = undefined;
      unwatchVisibility?.();
      unwatchVisibility = undefined;
      if (listening) runtime?.onUpdateAvailable.removeListener(receiveUpdate);
      listening = false;
    };
  };
  const checkBrowser = (): Promise<void> => {
    if (request) return request;
    const attemptedAt = now();
    if (
      lastBrowserCheckAt !== null &&
      attemptedAt - lastBrowserCheckAt < WALLET_RELEASE_MANUAL_INTERVAL_MS
    ) {
      browserStatus = 'throttled';
      publish();
      return Promise.resolve();
    }
    if (!runtime?.requestUpdateCheck) {
      browserStatus = 'unavailable';
      publish();
      return Promise.resolve();
    }
    lastBrowserCheckAt = attemptedAt;
    const revision = browserRevision;
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    }).finally(() => {
      if (request === pending) request = null;
    });
    request = pending;
    let live = true;
    const finish = (status: BrowserUpdateStatus, version?: string) => {
      if (!live) return;
      live = false;
      clearTimeout(timer);
      cancelRequest = undefined;
      if (!disposed) {
        if (browserRevision === revision) {
          browserStatus = status;
          if (version) pendingVersion = version;
        }
        publish();
      }
      resolve();
    };
    const timer = setTimeout(() => finish('unavailable'), 15_000);
    cancelRequest = () => finish('unavailable');
    browserStatus = 'checking';
    publish();
    if (!live || disposed) return pending;
    try {
      runtime.requestUpdateCheck((status, details) => {
        if (runtime.lastError) finish('unavailable');
        else if (
          status === 'update_available' &&
          isWalletReleaseIdentity({
            platform: 'chrome',
            version: details?.version,
          })
        )
          finish('available', details!.version);
        else if (status === 'no_update') finish('no-update');
        else if (status === 'throttled') finish('throttled');
        else finish('unavailable');
      });
    } catch {
      finish('unavailable');
    }
    return pending;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    async check() {
      if (disposed) return;
      await Promise.all([monitor.check({ force: true }), checkBrowser()]);
    },
    dispose() {
      disposed = true;
      clearTimeout(automaticTimer);
      unwatchVisibility?.();
      cancelRequest?.();
      if (listening) runtime?.onUpdateAvailable.removeListener(receiveUpdate);
      unwatch();
      monitor.dispose();
      listeners.clear();
    },
  };
}

let walletUpdates: ReturnType<typeof createWalletUpdateStore> | undefined;
const updates = () => {
  if (!walletUpdates)
    walletUpdates = createWalletUpdateStore({
      runtime: typeof chrome === 'undefined' ? undefined : chrome.runtime,
    });
  return walletUpdates;
};

export function useWalletUpdate() {
  const store = updates();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.start(), [store]);
  return { ...snapshot, check: store.check };
}
