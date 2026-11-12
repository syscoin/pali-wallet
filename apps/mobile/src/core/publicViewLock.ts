import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';

export const PUBLIC_VIEW_LOCK_KEY = 'pali.mobile.public-view-lock.v1';
type Snapshot = Readonly<{ phase: 'opening' | 'unlocked' | 'locked' | 'unavailable' }>;
type Port = Readonly<{ get(): Promise<string | null>; set(value: string): Promise<void> }>;
export type PublicViewAuthorization = (signal: AbortSignal, assertCurrent: () => void) => Promise<void>;
const refused = () => new Error('PUBLIC_VIEW_LOCKED');
const read = (raw: string | null) => {
  if (raw !== null && raw !== 'locked' && raw !== 'unlocked') throw refused();
  return raw === 'locked' ? 'locked' : 'unlocked';
};

/** One persistent privacy gate for every local/watch view. It never receives wallet keys. */
export class PublicViewLock {
  private state: Snapshot = Object.freeze({ phase: 'opening' });
  private readonly listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;
  private lockRequired = false;
  private authorization: AbortController | undefined;
  private readonly port: Port;
  constructor(port: Port) { this.port = port; }
  getSnapshot = (): Snapshot => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  assertUnlocked = () => { if (this.state.phase !== 'unlocked') throw refused(); };
  cancelUnlock = () => { this.authorization?.abort(); };
  private publish(phase: Snapshot['phase']) {
    this.state = Object.freeze({ phase });
    for (const listener of [...this.listeners]) {
      if (this.listeners.has(listener)) { try { listener(); } catch { /* Observers cannot unlock a view. */ } }
    }
  }
  private queued<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  load(): Promise<void> {
    const epoch = this.epoch;
    return this.queued(async () => {
      try {
        let raw = await this.port.get();
        if (epoch !== this.epoch) return;
        // A failed lock write must not turn a retry into unauthenticated entry.
        if (this.lockRequired && raw !== 'locked') {
          await this.port.set('locked');
          raw = await this.port.get();
          if (raw !== 'locked') throw refused();
        }
        if (epoch === this.epoch) {
          const phase = read(raw);
          this.lockRequired = phase === 'locked';
          this.publish(phase);
        }
      } catch { if (epoch === this.epoch) this.publish('unavailable'); throw refused(); }
    });
  }
  /** Hide immediately; success acknowledges the persistent lock marker. */
  lock(): Promise<void> {
    const epoch = ++this.epoch;
    this.lockRequired = true;
    this.cancelUnlock();
    this.publish('locked');
    return this.queued(async () => {
      try {
        await this.port.set('locked');
        if (await this.port.get() !== 'locked') throw refused();
        if (epoch === this.epoch) this.publish('locked');
      } catch { if (epoch === this.epoch) this.publish('unavailable'); throw refused(); }
    });
  }
  async unlock(authorize: PublicViewAuthorization, assertCurrent: () => void): Promise<void> {
    if (this.state.phase !== 'locked' || this.authorization || typeof authorize !== 'function') throw refused();
    const owner = new AbortController(), epoch = this.epoch;
    this.authorization = owner;
    const check = () => {
      if (owner.signal.aborted || this.authorization !== owner || epoch !== this.epoch || this.state.phase !== 'locked') throw refused();
      assertSynchronousEvmFeeGuard(assertCurrent);
    };
    try {
      check();
      await this.queue;
      check();
      if (await this.port.get() !== 'locked') throw refused();
      check(); await authorize(owner.signal, check); check();
      await this.queued(async () => {
        let writing = false;
        try {
          check();
          if (await this.port.get() !== 'locked') throw refused();
          check(); writing = true;
          await this.port.set('unlocked');
          check();
          if (await this.port.get() !== 'unlocked') throw refused();
          check(); this.lockRequired = false; this.publish('unlocked');
        } catch (error) {
          // A platform write may commit before acknowledging cancellation.
          // Restore the privacy lock within the same serial slot before any
          // new load/lock operation can observe the interrupted unlock.
          if (writing) {
            try {
              await this.port.set('locked');
              if (await this.port.get() !== 'locked') throw refused();
              if (epoch === this.epoch) this.publish('locked');
            } catch { this.publish('unavailable'); }
          }
          throw error;
        }
      });
    } finally { owner.abort(); if (this.authorization === owner) this.authorization = undefined; }
  }
}
