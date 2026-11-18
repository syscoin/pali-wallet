import {
  CANARY_EXTENSION_ID,
  CANARY_STORE_EXTENSION_ID,
  CANARY_EXTENSION_STORE_URL,
  CHROME_STORE_UPDATE_URL,
  STABLE_EXTENSION_ID,
} from '../shared/extensionReleaseChannel';

import { createWalletUpdateStore } from './useWalletUpdate';

type Runtime = NonNullable<
  Parameters<typeof createWalletUpdateStore>[0]['runtime']
>;
type Callback = Parameters<Runtime['requestUpdateCheck']>[0];
const emptyFeed = { version: 1 as const, releases: [] };

function fixture(
  installedVersion = '1.0.0',
  options: {
    delayed?: boolean;
    id?: string;
    info?: Partial<chrome.management.ExtensionInfo>;
    visibility?: Parameters<typeof createWalletUpdateStore>[0]['visibility'];
  } = {}
) {
  let receive: ((details: { version: string }) => void) | undefined;
  let identify: ((info: chrome.management.ExtensionInfo) => void) | undefined;
  const info = {
    id: options.id ?? STABLE_EXTENSION_ID,
    version: installedVersion,
    type: 'extension',
    enabled: true,
    installType: 'normal',
    updateUrl: CHROME_STORE_UPDATE_URL,
    ...options.info,
  } as chrome.management.ExtensionInfo;
  const runtime = {
    id: options.id ?? STABLE_EXTENSION_ID,
    getManifest: jest.fn(() => ({ version: installedVersion })),
    onUpdateAvailable: {
      addListener: jest.fn((listener) => {
        receive = listener;
      }),
      removeListener: jest.fn(),
    },
    requestUpdateCheck: jest.fn((callback: Callback) => callback('no_update')),
    reload: jest.fn(),
  };
  const management = {
    getSelf: jest.fn(
      (callback: (value: chrome.management.ExtensionInfo) => void) => {
        identify = callback;
        if (!options.delayed) callback(info);
      }
    ),
  };
  const fetchFeed = jest.fn().mockResolvedValue(emptyFeed);
  const store = createWalletUpdateStore({
    runtime: runtime as unknown as Runtime,
    management: management as unknown as NonNullable<
      Parameters<typeof createWalletUpdateStore>[0]['management']
    >,
    fetchFeed,
    visibility: options.visibility,
  });
  return {
    store,
    runtime,
    fetchFeed,
    management,
    info,
    identify: () => identify?.(info),
    receive: (version: string) => receive?.({ version }),
  };
}

it.each([
  ['5.0.0', 'critical'],
  ['5.0.1', 'routine'],
])(
  'uses outstanding shared urgency for extension %s',
  async (installed, severity) => {
    const f = fixture(installed);
    f.fetchFeed.mockResolvedValue({
      version: 1,
      releases: ['5.0.1', '5.0.2'].map((version, index) => ({
        platform: 'chrome',
        version,
        severity: index ? 'routine' : 'critical',
        title: 'Pali update',
        summary: 'Cumulative improvements.',
        publishedAt: '2026-01-01T00:00:00Z',
        releaseNotesUrl: `https://github.com/syscoin/pali-wallet/releases/tag/v${version}`,
        availability: { status: 'published' },
      })),
    });
    try {
      await f.store.check();
      expect(f.store.getSnapshot().release).toMatchObject({
        version: '5.0.2',
        severity,
      });
      expect(f.runtime.reload).not.toHaveBeenCalled();
    } finally {
      f.store.dispose();
    }
  }
);

it('automatically checks public metadata but asks Chrome only after a manual check', async () => {
  const f = fixture();
  try {
    f.store.start();
    await Promise.resolve();
    expect(f.fetchFeed).toHaveBeenCalledTimes(1);
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
    await f.store.check();
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledTimes(1);
    expect(f.store.getSnapshot()).toMatchObject({
      status: 'ready',
      browserStatus: 'no-update',
      installedVersion: '1.0.0',
      pendingVersion: null,
    });
    expect(f.runtime.reload).not.toHaveBeenCalled();
  } finally {
    f.store.dispose();
  }
});

it('keeps unavailable release information distinct from a browser no-update result', async () => {
  const f = fixture();
  f.fetchFeed.mockResolvedValue(null);
  try {
    await f.store.check();
    expect(f.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'unavailable',
      release: null,
      browserStatus: 'no-update',
    });
  } finally {
    f.store.dispose();
  }
});

it('preserves a newly downloaded update over a late older manual-check callback', async () => {
  const f = fixture();
  let callback!: Callback;
  f.runtime.requestUpdateCheck.mockImplementation((next) => {
    callback = next;
  });
  try {
    f.store.start();
    const checked = f.store.check();
    f.receive('1.3.0');
    callback('update_available', { version: '1.2.0' });
    await checked;
    expect(f.store.getSnapshot()).toMatchObject({
      browserStatus: 'available',
      pendingVersion: '1.3.0',
    });
    expect(f.runtime.reload).not.toHaveBeenCalled();
  } finally {
    f.store.dispose();
  }
});

it('coalesces manual checks and ignores callbacks after disposal', async () => {
  const f = fixture();
  let callback!: Callback;
  f.runtime.requestUpdateCheck.mockImplementation((next) => {
    callback = next;
  });
  const listener = jest.fn();
  f.store.subscribe(listener);
  const first = f.store.check();
  const second = f.store.check();
  expect(f.runtime.requestUpdateCheck).toHaveBeenCalledTimes(1);
  f.store.dispose();
  const calls = listener.mock.calls.length;
  callback('update_available', { version: '1.2.0' });
  await Promise.all([first, second]);
  expect(listener).toHaveBeenCalledTimes(calls);
  expect(f.store.getSnapshot().pendingVersion).toBeNull();
});

it('coalesces a check requested synchronously by a status subscriber', async () => {
  const f = fixture();
  let nested: Promise<void> | undefined;
  f.store.subscribe(() => {
    if (!nested && f.store.getSnapshot().browserStatus === 'checking')
      nested = f.store.check();
  });
  try {
    await f.store.check();
    await nested;
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledTimes(1);
  } finally {
    f.store.dispose();
  }
});

it('settles an unresponsive Chrome check as unavailable', async () => {
  jest.useFakeTimers();
  const f = fixture();
  f.runtime.requestUpdateCheck.mockImplementation(() => undefined);
  try {
    const checked = f.store.check();
    jest.advanceTimersByTime(15_000);
    await checked;
    expect(f.store.getSnapshot().browserStatus).toBe('unavailable');
  } finally {
    f.store.dispose();
    jest.useRealTimers();
  }
});

it('reports a Chrome throttle without clearing a known pending update', async () => {
  const f = fixture();
  f.runtime.requestUpdateCheck.mockImplementation((callback) =>
    callback('throttled')
  );
  try {
    f.store.start();
    f.receive('1.2.0');
    await f.store.check();
    expect(f.store.getSnapshot()).toMatchObject({
      browserStatus: 'throttled',
      pendingVersion: '1.2.0',
    });
  } finally {
    f.store.dispose();
  }
});

it('limits manual Chrome requests to once a minute', async () => {
  jest.useFakeTimers();
  const f = fixture();
  try {
    await f.store.check();
    await f.store.check();
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledTimes(1);
    expect(f.store.getSnapshot().browserStatus).toBe('throttled');
    jest.advanceTimersByTime(60_000);
    await f.store.check();
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledTimes(2);
  } finally {
    f.store.dispose();
    jest.useRealTimers();
  }
});

it('refreshes metadata every six hours only while a view is mounted', async () => {
  jest.useFakeTimers();
  const f = fixture();
  try {
    const stopFirst = f.store.start(),
      stopSecond = f.store.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.fetchFeed).toHaveBeenCalledTimes(1);
    expect(f.runtime.onUpdateAvailable.addListener).toHaveBeenCalledTimes(1);
    stopFirst();
    expect(f.runtime.onUpdateAvailable.removeListener).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(f.fetchFeed).toHaveBeenCalledTimes(2);
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
    stopSecond();
    expect(f.runtime.onUpdateAvailable.removeListener).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(f.fetchFeed).toHaveBeenCalledTimes(2);
  } finally {
    f.store.dispose();
    jest.useRealTimers();
  }
});

it('checks stale metadata on visibility return and removes the watcher on unmount', async () => {
  jest.useFakeTimers();
  let visible = false,
    changed: (() => void) | undefined;
  const unsubscribe = jest.fn();
  const { store, fetchFeed } = fixture('1.0.0', {
    visibility: {
      isVisible: () => visible,
      subscribe(listener) {
        changed = listener;
        return unsubscribe;
      },
    },
  });
  try {
    const stop = store.start();
    expect(fetchFeed).not.toHaveBeenCalled();
    visible = true;
    changed!();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    visible = false;
    changed!();
    await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    visible = true;
    changed!();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  } finally {
    store.dispose();
    jest.useRealTimers();
  }
});

it.each([
  { info: { installType: 'development' as const } },
  { info: { installType: 'sideload' as const } },
  { info: { updateUrl: 'https://untrusted.example/update' } },
  { info: { id: 'a'.repeat(32) } },
  { id: 'a'.repeat(32) },
  { id: CANARY_EXTENSION_ID },
])(
  'does not advertise or check store updates for an unadmitted installation %p',
  async (options) => {
    const f = fixture('5.0.0', options);
    try {
      f.store.start();
      await f.store.check();
      f.receive('5.0.9');
      expect(f.store.getSnapshot()).toMatchObject({
        installation: 'unavailable',
        channel: null,
        storeUrl: null,
        release: null,
        pendingVersion: null,
      });
      expect(f.fetchFeed).not.toHaveBeenCalled();
      expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
      expect(f.runtime.onUpdateAvailable.addListener).not.toHaveBeenCalled();
    } finally {
      f.store.dispose();
    }
  }
);

it('waits for exact installation identity before any release I/O and uses only the stable channel', async () => {
  const f = fixture('5.0.0', { delayed: true });
  try {
    f.store.start();
    const checking = f.store.check();
    expect(f.fetchFeed).not.toHaveBeenCalled();
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
    f.identify();
    await checking;
    expect(f.management.getSelf).toHaveBeenCalledTimes(1);
    expect(f.fetchFeed.mock.calls.every((call) => call[1] === 'stable')).toBe(
      true
    );
    expect(f.store.getSnapshot()).toMatchObject({
      installation: 'store',
      channel: 'stable',
    });
  } finally {
    f.store.dispose();
  }
});

it('uses the Canary feed and listing for the verified Canary store installation', async () => {
  const f = fixture('5.0.0.2', { id: CANARY_STORE_EXTENSION_ID });
  try {
    f.store.start();
    await f.store.check();
    expect(f.fetchFeed).toHaveBeenCalled();
    expect(f.fetchFeed.mock.calls.every((call) => call[1] === 'canary')).toBe(
      true
    );
    expect(f.store.getSnapshot()).toMatchObject({
      installation: 'store',
      channel: 'canary',
      storeUrl: CANARY_EXTENSION_STORE_URL,
    });
  } finally {
    f.store.dispose();
  }
});

it('ignores delayed installation identity after disposal', async () => {
  const f = fixture('5.0.0', { delayed: true });
  f.store.start();
  const pending = f.store.check();
  f.store.dispose();
  await pending;
  f.identify();
  expect(f.fetchFeed).not.toHaveBeenCalled();
  expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
  expect(f.runtime.onUpdateAvailable.addListener).not.toHaveBeenCalled();
});

it('ignores queued browser events after the last update view unmounts', () => {
  const f = fixture();
  try {
    const stop = f.store.start();
    stop();
    f.receive('9.0.0');
    expect(f.store.getSnapshot().pendingVersion).toBeNull();
    f.store.start();
    f.receive('9.0.0');
    expect(f.store.getSnapshot().pendingVersion).toBe('9.0.0');
  } finally {
    f.store.dispose();
  }
});

it('refuses an identity change while installation information is pending', async () => {
  const f = fixture('5.0.0', { delayed: true });
  try {
    const pending = f.store.check();
    f.runtime.id = CANARY_EXTENSION_ID;
    f.identify();
    await pending;
    expect(f.store.getSnapshot().installation).toBe('unavailable');
    expect(f.fetchFeed).not.toHaveBeenCalled();
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
  } finally {
    f.store.dispose();
  }
});

it('refuses a browser-reported installation lookup error without using its result', async () => {
  const f = fixture('5.0.0', { delayed: true });
  try {
    const pending = f.store.check();
    Object.assign(f.runtime, { lastError: { message: 'unavailable' } });
    f.identify();
    await pending;
    expect(f.store.getSnapshot().installation).toBe('unverified');
    expect(f.fetchFeed).not.toHaveBeenCalled();
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
    Object.assign(f.runtime, { lastError: undefined });
    const retried = f.store.check();
    f.identify();
    await retried;
    expect(f.store.getSnapshot().installation).toBe('store');
    expect(f.management.getSelf).toHaveBeenCalledTimes(2);
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledTimes(1);
  } finally {
    f.store.dispose();
  }
});

it('times out an unavailable installation API without fallback store traffic', async () => {
  jest.useFakeTimers();
  const f = fixture('5.0.0', { delayed: true });
  try {
    const pending = f.store.check();
    jest.advanceTimersByTime(15000);
    await pending;
    f.identify();
    expect(f.store.getSnapshot().installation).toBe('unverified');
    expect(f.fetchFeed).not.toHaveBeenCalled();
    expect(f.runtime.requestUpdateCheck).not.toHaveBeenCalled();
    f.management.getSelf.mockImplementation((callback) => callback(f.info));
    await f.store.check();
    expect(f.store.getSnapshot().installation).toBe('store');
    expect(f.management.getSelf).toHaveBeenCalledTimes(2);
    expect(f.runtime.requestUpdateCheck).toHaveBeenCalledTimes(1);
  } finally {
    f.store.dispose();
    jest.useRealTimers();
  }
});
