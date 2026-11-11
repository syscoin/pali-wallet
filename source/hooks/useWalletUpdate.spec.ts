import { createWalletUpdateStore } from './useWalletUpdate';

type Runtime = NonNullable<
  Parameters<typeof createWalletUpdateStore>[0]['runtime']
>;
type Callback = Parameters<Runtime['requestUpdateCheck']>[0];
const emptyFeed = { version: 1 as const, releases: [] };

function fixture(installedVersion = '1.0.0') {
  let receive: ((details: { version: string }) => void) | undefined;
  const runtime = {
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
  const fetchFeed = jest.fn().mockResolvedValue(emptyFeed);
  const store = createWalletUpdateStore({
    runtime: runtime as unknown as Runtime,
    fetchFeed,
  });
  return {
    store,
    runtime,
    fetchFeed,
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
  const fetchFeed = jest.fn().mockResolvedValue(emptyFeed);
  const store = createWalletUpdateStore({
    fetchFeed,
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
