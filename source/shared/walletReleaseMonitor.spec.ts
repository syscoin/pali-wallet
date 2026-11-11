import {
  parseWalletReleaseFeed,
  type WalletReleaseFeed,
} from './walletRelease.ts';
import {
  WalletReleaseMonitor,
  WALLET_RELEASE_AUTOMATIC_INTERVAL_MS,
  WALLET_RELEASE_MANUAL_INTERVAL_MS,
} from './walletReleaseMonitor.ts';

const current = { platform: 'chrome' as const, version: '4.0.0' };
const released = () =>
  parseWalletReleaseFeed({
    version: 1,
    releases: [
      {
        platform: 'chrome',
        version: '4.1.0',
        severity: 'important',
        title: 'Pali update',
        summary: 'Improved reliability.',
        publishedAt: '2026-01-01T00:00:00Z',
        releaseNotesUrl:
          'https://github.com/syscoin/pali-wallet/releases/tag/v4.1.0',
        availability: { status: 'published' },
      },
    ],
  })!;
const empty = () => parseWalletReleaseFeed({ version: 1, releases: [] })!;

describe('wallet release monitor', () => {
  it('starts idle and shares one explicit check across concurrent and reentrant callers', async () => {
    let resolve!: (feed: WalletReleaseFeed) => void;
    const fetchFeed = jest.fn(
      () =>
        new Promise<WalletReleaseFeed>((done) => {
          resolve = done;
        })
    );
    const monitor = new WalletReleaseMonitor({
      current,
      fetchFeed,
      now: () => Date.parse('2026-11-12T00:00:00Z'),
    });
    expect(monitor.getSnapshot().status).toBe('idle');
    expect(fetchFeed).not.toHaveBeenCalled();
    let nested: Promise<unknown> | undefined;
    monitor.subscribe(() => {
      if (monitor.getSnapshot().status === 'checking')
        nested = monitor.check({ force: true });
    });
    const pending = monitor.check();
    expect(monitor.check()).toBe(pending);
    expect(nested).toBe(pending);
    expect(Object.isFrozen(monitor.getSnapshot())).toBe(true);
    await Promise.resolve();
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    resolve(released());
    const value = await pending;
    expect(value.status).toBe('ready');
    expect(value.release?.version).toBe('4.1.0');
    monitor.dispose();
  });

  it('throttles automatic and manual checks, including after failure', async () => {
    let now = Date.parse('2026-11-12T00:00:00Z');
    const fetchFeed = jest.fn(async () => null);
    const monitor = new WalletReleaseMonitor({
      current,
      fetchFeed,
      now: () => now,
    });
    await monitor.check();
    expect(monitor.getSnapshot().status).toBe('error');
    now += WALLET_RELEASE_MANUAL_INTERVAL_MS - 1;
    await monitor.check({ force: true });
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    now++;
    await monitor.check({ force: true });
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    now += WALLET_RELEASE_AUTOMATIC_INTERVAL_MS - 1;
    await monitor.check();
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    now++;
    await monitor.check();
    expect(fetchFeed).toHaveBeenCalledTimes(3);
    monitor.dispose();
  });

  it('retains a known release on failure, distinguishes latest verification, then clears on a verified empty feed', async () => {
    let now = Date.parse('2026-11-12T00:00:00Z');
    const fetchFeed = jest
      .fn<Promise<WalletReleaseFeed | null>, [AbortSignal]>()
      .mockResolvedValueOnce(released())
      .mockRejectedValueOnce(Error('offline'))
      .mockResolvedValueOnce(empty());
    const monitor = new WalletReleaseMonitor({
      current,
      fetchFeed,
      now: () => now,
    });
    const successful = await monitor.check();
    now += WALLET_RELEASE_AUTOMATIC_INTERVAL_MS;
    const failed = await monitor.check();
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('unavailable');
    expect(failed.release).toBe(successful.release);
    expect(failed.lastCheckedAt).toBe(successful.lastCheckedAt);
    expect(failed.lastAttemptAt).toBe(now);
    now += WALLET_RELEASE_AUTOMATIC_INTERVAL_MS;
    expect(await monitor.check()).toEqual(
      expect.objectContaining({
        status: 'ready',
        release: null,
        error: null,
        lastCheckedAt: now,
      })
    );
    monitor.dispose();
  });

  it('treats malformed feeds as unavailable rather than current', async () => {
    const monitor = new WalletReleaseMonitor({
      current,
      fetchFeed: async () =>
        ({ version: 2, releases: [] } as unknown as WalletReleaseFeed),
    });
    expect(await monitor.check()).toEqual(
      expect.objectContaining({
        status: 'error',
        lastCheckedAt: null,
        error: 'unavailable',
      })
    );
    monitor.dispose();
  });

  it('aborts disposal and prevents late results or subscriber failures from publishing', async () => {
    let resolve!: (value: WalletReleaseFeed) => void, signal!: AbortSignal;
    const monitor = new WalletReleaseMonitor({
      current,
      fetchFeed: (received) => {
        signal = received;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const changed = jest.fn();
    monitor.subscribe(changed);
    monitor.subscribe(() => {
      throw Error('view gone');
    });
    const pending = monitor.check();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);
    monitor.dispose();
    expect(signal.aborted).toBe(true);
    resolve(released());
    await pending;
    expect(changed).toHaveBeenCalledTimes(1);
    expect(monitor.getSnapshot().lastCheckedAt).toBeNull();
    await monitor.check({ force: true });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('captures installed identity and refuses invalid or backwards clocks', async () => {
    let now = Date.parse('2026-11-12T00:00:00Z');
    const identity = { ...current };
    const fetchFeed = jest.fn(async () => released());
    const monitor = new WalletReleaseMonitor({
      current: identity,
      fetchFeed,
      now: () => now,
    });
    identity.version = '99.0.0';
    expect((await monitor.check()).release?.version).toBe('4.1.0');
    now -= 1;
    await monitor.check({ force: true });
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    monitor.dispose();
    const bad = new WalletReleaseMonitor({
      current,
      fetchFeed,
      now: () => NaN,
    });
    await bad.check();
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    bad.dispose();
  });
});
