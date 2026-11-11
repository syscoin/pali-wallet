import {
  isWalletReleaseIdentity,
  parseWalletReleaseFeed,
  selectWalletRelease,
  type WalletRelease,
  type WalletReleaseFeed,
  type WalletReleaseIdentity,
} from './walletRelease.ts';

export const WALLET_RELEASE_AUTOMATIC_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const WALLET_RELEASE_MANUAL_INTERVAL_MS = 60 * 1000;
export type WalletReleaseSnapshot = Readonly<{
  error: 'unavailable' | null;
  lastAttemptAt: number | null;
  lastCheckedAt: number | null;
  release: WalletRelease | null;
  status: 'idle' | 'checking' | 'ready' | 'error';
}>;

/** Public metadata only. Hosts own activation, transport timeouts and presentation. */
export class WalletReleaseMonitor {
  private snapshot: WalletReleaseSnapshot = Object.freeze({
    status: 'idle',
    release: null,
    lastCheckedAt: null,
    lastAttemptAt: null,
    error: null,
  });
  private readonly listeners = new Set<() => void>();
  private readonly current: WalletReleaseIdentity;
  private readonly fetchFeed: (
    signal: AbortSignal
  ) => Promise<WalletReleaseFeed | null>;
  private readonly now: () => number;
  private pending: Promise<WalletReleaseSnapshot> | null = null;
  private request: AbortController | null = null;
  private disposed = false;

  constructor(
    options: Readonly<{
      current: WalletReleaseIdentity;
      fetchFeed(signal: AbortSignal): Promise<WalletReleaseFeed | null>;
      now?: () => number;
    }>
  ) {
    this.current = Object.freeze({ ...options.current });
    this.fetchFeed = options.fetchFeed;
    this.now = options.now ?? Date.now;
  }

  getSnapshot = (): WalletReleaseSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    if (!this.disposed) this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: WalletReleaseSnapshot): void {
    if (this.disposed) return;
    this.snapshot = Object.freeze(snapshot);
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* One presentation subscriber cannot interrupt checking. */
      }
    }
  }

  check = ({
    force = false,
  }: Readonly<{ force?: boolean }> = {}): Promise<WalletReleaseSnapshot> => {
    if (this.pending) return this.pending;
    if (this.disposed) return Promise.resolve(this.snapshot);
    let started: number;
    try {
      started = this.now();
    } catch {
      return Promise.resolve(this.snapshot);
    }
    if (
      !Number.isFinite(started) ||
      started < 0 ||
      (this.snapshot.lastAttemptAt !== null &&
        started - this.snapshot.lastAttemptAt <
          (force
            ? WALLET_RELEASE_MANUAL_INTERVAL_MS
            : WALLET_RELEASE_AUTOMATIC_INTERVAL_MS))
    )
      return Promise.resolve(this.snapshot);
    const request = new AbortController();
    this.request = request;
    // Install the single-flight promise before notifying subscribers or calling host code.
    const task = Promise.resolve()
      .then(async () => {
        try {
          if (
            this.disposed ||
            request.signal.aborted ||
            !isWalletReleaseIdentity(this.current)
          )
            throw new Error('UNAVAILABLE');
          const feed = parseWalletReleaseFeed(
            await this.fetchFeed(request.signal)
          );
          if (this.disposed || request.signal.aborted) return this.snapshot;
          if (!feed) throw new Error('UNAVAILABLE');
          const completed = this.now();
          if (!Number.isFinite(completed) || completed < started)
            throw new Error('UNAVAILABLE');
          this.publish({
            status: 'ready',
            release: selectWalletRelease(feed, this.current, completed),
            lastCheckedAt: completed,
            lastAttemptAt: started,
            error: null,
          });
        } catch {
          this.publish({
            ...this.snapshot,
            status: 'error',
            error: 'unavailable',
          });
        }
        return this.snapshot;
      })
      .finally(() => {
        if (this.request === request) this.request = null;
        if (this.pending === task) this.pending = null;
      });
    this.pending = task;
    this.publish({
      ...this.snapshot,
      status: 'checking',
      lastAttemptAt: started,
      error: null,
    });
    return task;
  };

  dispose(): void {
    this.disposed = true;
    this.request?.abort();
    this.listeners.clear();
  }
}
