import type { CustodySnapshot } from './types.ts';

export interface RecoveryOwner {
  cancel(): void;
  dispose(): Promise<void>;
}
export interface ManagedNativeControllers {
  authority: { getSnapshot(): CustodySnapshot; initialize(): Promise<void>; lock(): void; dispose(): Promise<void> };
  keyExport: { dispose(): void };
  backup: { dispose(): void };
  removal?: RecoveryOwner & { hasVerifiedRemoval(): boolean };
  disposeTokens(): void;
  disposeTransfers(): void;
}
type Entry<T> = { token: object; value: T; recovery: RecoveryOwner | null; retiring: Promise<void> | null };

/** One process-lifetime gate, shared by successive native screen mounts. */
export class NativeControllerLifecycle<T extends ManagedNativeControllers, R extends RecoveryOwner> {
  private entry: Entry<T> | null = null;
  private wanted: object | null = null;
  private generation = 0;
  private barrier: Promise<void> = Promise.resolve();
  private pending: { token: object; generation: number; promise: Promise<T | null> } | null = null;
  private poisoned = false;
  private knownExisting = false;
  private creatingRecovery = false;
  private readonly dependencies: { create(): T; protect(): Promise<void>; recovery(value: T): R };

  constructor(dependencies: { create(): T; protect(): Promise<void>; recovery(value: T): R }) { this.dependencies = dependencies; }

  current(token: object): T | null { return this.entry?.token === token ? this.entry.value : null; }
  hasRecovery(token: object): boolean { return this.entry?.token === token && this.entry.recovery !== null; }

  private retire(entry: Entry<T>): Promise<void> {
    if (entry.retiring) return entry.retiring;
    let resolve!: () => void, reject!: (error: Error) => void;
    entry.retiring = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    if (this.entry === entry) this.entry = null;
    this.barrier = Promise.all([this.barrier, entry.retiring]).then(() => undefined);
    void this.barrier.catch(() => undefined); void entry.retiring.catch(() => undefined);
    const work: Promise<unknown>[] = [];
    let failed = false;
    const invoke = (action: () => unknown) => { try { work.push(Promise.resolve(action())); } catch { failed = true; } };
    // Reserve retirement before any injected callback can reenter this gate.
    invoke(() => entry.recovery?.cancel());
    invoke(() => entry.value.removal?.cancel());
    invoke(() => entry.value.disposeTokens()); invoke(() => entry.value.disposeTransfers());
    invoke(() => entry.value.keyExport.dispose()); invoke(() => entry.value.backup.dispose());
    invoke(() => entry.value.authority.lock());
    invoke(() => entry.recovery?.dispose()); invoke(() => entry.value.authority.dispose());
    invoke(() => entry.value.removal?.dispose());
    void Promise.allSettled(work).then((results) => {
      if (failed || results.some((result) => result.status === 'rejected')) {
        this.poisoned = true; reject(new Error('REOPEN_REQUIRED'));
      } else {
        try {
          if (entry.value.removal?.hasVerifiedRemoval()) this.knownExisting = false;
          resolve();
        } catch { this.poisoned = true; reject(new Error('REOPEN_REQUIRED')); }
      }
    });
    return entry.retiring;
  }

  acquire(token: object, isCurrent: () => boolean): Promise<T | null> {
    if (this.poisoned) return Promise.reject(new Error('REOPEN_REQUIRED'));
    if (this.pending?.token === token && this.pending.generation === this.generation) return this.pending.promise;
    if (this.wanted === token && this.entry?.token === token) return Promise.resolve(this.entry.value);
    this.wanted = token;
    const generation = ++this.generation;
    if (this.entry) void this.retire(this.entry).catch(() => undefined);
    const admitted = () => {
      if (this.poisoned || this.wanted !== token || this.generation !== generation) return false;
      const valid = isCurrent() === true;
      return valid && !this.poisoned && this.wanted === token && this.generation === generation;
    };
    const task = (async () => {
      await this.barrier;
      if (!admitted()) return null;
      await this.dependencies.protect();
      if (!admitted()) return null;
      const value = this.dependencies.create();
      const entry: Entry<T> = { token, value, recovery: null, retiring: null };
      this.entry = entry;
      try {
        if (!admitted()) { await this.retire(entry); return null; }
        await value.authority.initialize();
        if (!admitted()) { await this.retire(entry); return null; }
        const state = value.authority.getSnapshot();
        if (this.knownExisting && (state.presence !== 'existing' || state.phase !== 'locked')) throw new Error('REOPEN_REQUIRED');
        if (state.presence === 'existing') this.knownExisting = true;
        return value;
      } catch {
        try { await this.retire(entry); } catch { /* The gate remains poisoned. */ }
        this.poisoned = true;
        throw new Error('REOPEN_REQUIRED');
      }
    })();
    this.pending = { token, generation, promise: task };
    void task.finally(() => { if (this.pending?.promise === task) this.pending = null; }).catch(() => undefined);
    return task;
  }

  startRecovery(token: object, value: T): R {
    const entry = this.entry;
    if (!entry || entry.token !== token || entry.value !== value || entry.retiring || this.poisoned || this.creatingRecovery)
      throw new Error('NOT_READY');
    if (entry.recovery) return entry.recovery as R;
    const state = value.authority.getSnapshot();
    if (state.phase !== 'locked' || state.presence !== 'existing') throw new Error('NOT_READY');
    this.creatingRecovery = true; this.knownExisting = true;
    let resolve!: (recovery: R | null) => void;
    let produced: R | null = null, cancelled = false;
    const created = new Promise<R | null>((yes) => { resolve = yes; });
    // A reentrant release must also drain the capability being constructed.
    entry.recovery = { cancel() { cancelled = true; produced?.cancel(); }, async dispose() { await (await created)?.dispose(); } };
    try {
      const recovery = this.dependencies.recovery(value);
      produced = recovery; resolve(recovery);
      if (cancelled) recovery.cancel();
      if (this.entry !== entry || entry.retiring) throw new Error('NOT_READY');
      entry.recovery = recovery;
      return recovery;
    } catch (error) {
      resolve(null);
      if (!entry.retiring) entry.recovery = null;
      throw error;
    } finally { this.creatingRecovery = false; }
  }

  release(token: object, cleanupFailed = false): Promise<void> {
    if (cleanupFailed) this.poisoned = true;
    if (this.wanted === token) { this.wanted = null; this.generation++; }
    if (this.entry?.token === token) return this.retire(this.entry);
    return this.barrier;
  }
}
