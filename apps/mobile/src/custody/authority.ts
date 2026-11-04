import type { NativeAccountRequest } from './accounts.ts';
import type { NativeImportRequest } from './importedAccounts.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import { CustodyRuntimeError } from './types.ts';
import type {
  CustodyErrorCode,
  CustodyRuntime,
  CustodyRuntimeFactory,
  CustodySnapshot,
  CustodyStoredState,
} from './types.ts';

/** Errors deliberately omit port messages, causes and credential material. */
export class CustodyOperationError extends Error {
  readonly code: CustodyErrorCode;

  constructor(code: CustodyErrorCode) {
    super(code);
    this.name = 'CustodyOperationError';
    this.code = code;
  }
}

/**
 * Native host orchestration. The native factory must qualify crypto
 * and storage first; physical-device/release qualification remains separate.
 * JS input strings cannot be promised secure zeroization.
 */
export class NativeCustodyAuthority {
  private readonly factory: CustodyRuntimeFactory;
  private runtime: CustodyRuntime | null = null;
  private listeners = new Set<(snapshot: CustodySnapshot) => void>();
  private revision = 0;
  private initialization: Promise<void> | null = null;
  private pending: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private recoveryRetirement: Promise<string> | null = null;
  private closing: Promise<void> | null = null;
  private locks: Promise<void> = Promise.resolve();
  private lockFailed = false;
  private revoking = false;
  private accountOperation = false;
  private snapshot: CustodySnapshot = Object.freeze({
    phase: 'opening',
    revision: 0,
    presence: 'unknown',
    backup: 'unknown',
    account: null,
    error: null,
  });

  constructor(factory: CustodyRuntimeFactory) {
    this.factory = factory;
  }

  getSnapshot(): CustodySnapshot {
    return this.snapshot;
  }

  getCatalogue(): NativeWalletCatalogueSnapshot | null {
    if (!['ready', 'backup-required'].includes(this.snapshot.phase)) return null;
    return this.runtime?.accounts?.getSnapshot() ?? null;
  }

  supportsAccountManagement(): boolean { return this.runtime?.accounts?.supported() === true; }

  cancelAccountOperation(): void { if (this.accountOperation) this.lock(); }

  manageAccounts(request: NativeAccountRequest, expectedRevision: number, expectedCatalogueRevision: number): Promise<void> {
    return this.manageContext((runtime) => {
      if (!runtime.accounts) throw new CustodyRuntimeError('NOT_READY');
      return runtime.accounts.reserve(request, expectedCatalogueRevision);
    }, expectedRevision);
  }

  /** Private protected-form path; imported key material never enters account projections. */
  importEvmAccount(input: NativeImportRequest, password: string, expectedRevision: number, expectedCatalogueRevision: number): Promise<void> {
    return this.manageContext((runtime) => {
      if (!runtime.imports) throw new CustodyRuntimeError('NOT_READY');
      return runtime.imports.reserve(input, password, expectedCatalogueRevision);
    }, expectedRevision);
  }

  /** Selection revokes outstanding reviews before changing the saved EVM context. */
  selectNetwork(id: string, expectedRevision: number, expectedCatalogueRevision: number): Promise<void> {
    return this.manageContext((runtime) => {
      if (!runtime.networks) throw new CustodyRuntimeError('NOT_READY');
      return runtime.networks.reserve(id, expectedCatalogueRevision);
    }, expectedRevision);
  }

  manageNetwork(request: import('./accounts.ts').NativeNetworkRequest, expectedRevision: number, expectedCatalogueRevision: number): Promise<void> {
    return this.manageContext((runtime) => {
      if (!runtime.networks) throw new CustodyRuntimeError('NOT_READY');
      return runtime.networks.reserve(request, expectedCatalogueRevision);
    }, expectedRevision);
  }

  private selectedNetwork(runtime: CustodyRuntime) {
    if (!runtime.networks) return 'ethereum' as const;
    const id = runtime.networks.getSelectedId();
    if (!id) throw new CustodyRuntimeError('NOT_READY');
    return id;
  }

  private manageContext(reserve: (runtime: CustodyRuntime) => { execute(assertCurrent: () => void): Promise<void>; cancel(): void }, expectedRevision: number): Promise<void> {
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    if (!this.runtime || this.snapshot.phase !== 'ready') return Promise.reject(new CustodyOperationError('NOT_READY'));
    if (this.revision !== expectedRevision) return Promise.reject(new CustodyOperationError('CANCELLED'));
    const runtime = this.runtime;
    let reservation: ReturnType<NonNullable<CustodyRuntime['accounts']>['reserve']>;
    try {
      // Runtime admission happens before observers can attempt competing work.
      reservation = reserve(runtime);
    } catch (cause) {
      const code = cause instanceof CustodyRuntimeError ? cause.code : 'INVALID_INPUT';
      return Promise.reject(new CustodyOperationError(code));
    }
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    this.accountOperation = true;
    const revision = ++this.revision;
    this.publish({ phase: 'authenticating', account: null, error: null });
    const current = () => {
      if (this.revision !== revision || this.snapshot.phase === 'disposed') throw new CustodyOperationError('CANCELLED');
      if (this.lockFailed || this.snapshot.phase === 'unavailable') throw new CustodyOperationError('UNAVAILABLE');
    };
    return (async () => {
      try {
        await this.drainLocks(); current();
        await reservation.execute(current); current();
        await this.readState(true); current();
        const address = normalizePublicAddress(await runtime.session.readEthereumAddress(), 'ethereum');
        current();
        this.publish({ phase: this.snapshot.backup === 'confirmed' ? 'ready' : 'backup-required', account: Object.freeze({ network: this.selectedNetwork(runtime), address }), error: null });
        current();
      } catch (cause) {
        reservation.cancel();
        this.requestLock();
        try { await this.drainLocks(); } catch { /* Unavailable was published by cleanup. */ }
        if (this.lockFailed || this.snapshot.phase === 'unavailable') throw new CustodyOperationError('UNAVAILABLE');
        if (this.revision !== revision || this.snapshot.phase === 'disposed') throw new CustodyOperationError('CANCELLED');
        const code = cause instanceof CustodyRuntimeError ? cause.code : 'OPERATION_FAILED';
        this.publish({ phase: 'locked', account: null, error: code });
        throw new CustodyOperationError(code);
      } finally {
        reservation.cancel();
        this.accountOperation = false;
        this.pending = null;
        release();
      }
    })();
  }

  subscribe(listener: (snapshot: CustodySnapshot) => void): () => void {
    if (this.snapshot.phase === 'disposed') return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(update: Partial<CustodySnapshot>): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...update,
      revision: this.revision,
    });
    const snapshot = this.snapshot;
    for (const listener of [...this.listeners]) {
      // A listener may lock/dispose synchronously. Never send the superseded
      // ready state to remaining observers after that revocation.
      if (this.snapshot !== snapshot) break;
      if (!this.listeners.has(listener)) continue;
      try {
        listener(snapshot);
      } catch {
        // A UI observer cannot turn a committed wallet operation into failure.
      }
    }
  }

  private failUnavailable(): void {
    // Cleanup still runs for late sessions; quarantine is announced only once
    // so an observer that requests lock cannot sustain a failure event loop.
    if (this.snapshot.phase !== 'disposed' && this.snapshot.phase !== 'unavailable') {
      this.publish({ phase: 'unavailable', account: null, error: 'UNAVAILABLE' });
    }
  }

  private requestLock(): void {
    if (!this.runtime) return;
    let cleanup: Promise<void>;
    try {
      // Invoke now, not in a deferred .then(): SDK revocation begins immediately.
      cleanup = Promise.resolve(this.runtime.session.lock());
    } catch {
      cleanup = Promise.reject(new CustodyOperationError('CLEANUP_FAILED'));
    }
    const observed = cleanup.catch(() => {
      this.lockFailed = true;
      this.failUnavailable();
    });
    this.locks = Promise.all([this.locks, observed]).then(() => undefined);
  }

  private async drainLocks(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.locks;
      await current;
    } while (current !== this.locks);
    if (this.lockFailed) throw new CustodyOperationError('CLEANUP_FAILED');
  }

  private async readState(requireExisting = false): Promise<void> {
    try {
      const raw: CustodyStoredState | undefined = await this.runtime?.storage.readState();
      if (
        !raw ||
        (raw.presence !== 'empty' && raw.presence !== 'existing') ||
        (raw.backup !== 'unconfirmed' && raw.backup !== 'confirmed') ||
        (raw.presence === 'empty' &&
          (raw.backup !== 'unconfirmed' || requireExisting ||
            this.snapshot.presence === 'existing'))
      ) {
        throw new CustodyOperationError('UNAVAILABLE');
      }
      // An async read that finishes after disposal cannot mutate terminal state.
      if (this.snapshot.phase !== 'disposed') {
        this.snapshot = Object.freeze({
          ...this.snapshot,
          presence: raw.presence,
          backup: raw.backup,
        });
      }
    } catch {
      this.failUnavailable();
      throw new CustodyOperationError('UNAVAILABLE');
    }
  }

  initialize(): Promise<void> {
    if (this.snapshot.phase === 'disposed')
      return Promise.reject(new CustodyOperationError('CANCELLED'));
    if (this.initialization) return this.initialization;
    // Publish admission before invoking an injected factory. It can synchronously
    // dispose us, and disposal must wait for the runtime it is about to return.
    let resolveInitialization!: () => void;
    let rejectInitialization!: (error: CustodyOperationError) => void;
    this.initialization = new Promise<void>((resolve, reject) => {
      resolveInitialization = resolve;
      rejectInitialization = reject;
    });
    void (async () => {
      try {
        this.runtime = await this.factory.open();
        this.requestLock();
        await this.drainLocks();
        if (this.snapshot.phase === 'disposed') return;
        await this.readState();
        // A lifecycle lock may have started while storage was being read.
        // Initialization cannot reopen an authority whose cleanup failed.
        await this.drainLocks();
        if (this.getSnapshot().phase !== 'disposed') {
          this.publish({
            phase: this.snapshot.presence === 'empty' ? 'empty' : 'locked',
          });
        }
      } catch {
        this.failUnavailable();
        throw new CustodyOperationError('UNAVAILABLE');
      }
    })().then(resolveInitialization, () =>
      rejectInitialization(new CustodyOperationError('UNAVAILABLE'))
    );
    return this.initialization;
  }

  /** Immediate UI/authority revocation; pending authentication must still drain. */
  lock(): void {
    if (this.snapshot.phase === 'disposed' || this.revoking) return;
    this.revoking = true;
    this.revision++;
    this.publish({
      phase:
        this.snapshot.phase === 'unavailable'
          ? 'unavailable'
          : this.snapshot.presence === 'unknown'
          ? 'opening'
          : this.snapshot.presence === 'empty'
          ? 'empty'
          : 'locked',
      account: null,
      error: this.snapshot.phase === 'unavailable' ? 'UNAVAILABLE' : null,
    });
    this.requestLock();
    this.revoking = false;
  }

  create(password: string): Promise<void> {
    return this.authenticate('create', password);
  }

  importPhrase(phrase: string, password: string): Promise<void> {
    return this.authenticate('import', password, phrase);
  }

  unlock(password: string): Promise<void> {
    return this.authenticate('unlock', password);
  }

  /** Refresh wallet-bound setup metadata only while the same session is live. */
  refreshAuthenticatedMetadata(): Promise<void> {
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    if (!this.runtime || !this.snapshot.account ||
      !['backup-required', 'ready'].includes(this.snapshot.phase))
      return Promise.reject(new CustodyOperationError('NOT_READY'));
    const runtime = this.runtime;
    const revision = this.revision;
    const account = this.snapshot.account;
    let resolveAdmission!: () => void;
    this.pending = new Promise<void>((resolve) => { resolveAdmission = resolve; });
    const current = () => {
      if (revision !== this.revision || this.snapshot.phase === 'disposed')
        throw new CustodyOperationError('CANCELLED');
      if (this.lockFailed || this.snapshot.phase === 'unavailable')
        throw new CustodyOperationError('UNAVAILABLE');
    };
    return (async () => {
      try {
        await this.drainLocks(); current();
        await this.readState(true); current();
        const address = normalizePublicAddress(await runtime.session.readEthereumAddress(), 'ethereum');
        current();
        if (address !== account.address) throw new CustodyOperationError('UNAVAILABLE');
        this.publish({ phase: this.snapshot.backup === 'confirmed' ? 'ready' : 'backup-required' });
        current();
      } catch {
        this.requestLock();
        try { await this.drainLocks(); } catch { /* quarantine already published */ }
        if (revision !== this.revision || this.snapshot.phase === 'disposed')
          throw new CustodyOperationError('CANCELLED');
        this.failUnavailable();
        throw new CustodyOperationError('UNAVAILABLE');
      } finally {
        this.pending = null;
        resolveAdmission();
      }
    })();
  }

  private authenticate(
    operation: 'create' | 'import' | 'unlock',
    password: string,
    phrase?: string
  ): Promise<void> {
    if (
      typeof password !== 'string' || password.length === 0 || password.length > 1024 ||
      (operation === 'import' &&
        (typeof phrase !== 'string' || phrase.length === 0 || phrase.length > 4096))
    ) return Promise.reject(new CustodyOperationError('INVALID_INPUT'));
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    const expectedPhase = operation === 'unlock' ? 'locked' : 'empty';
    if (!this.runtime || this.snapshot.phase !== expectedPhase)
      return Promise.reject(new CustodyOperationError('NOT_READY'));
    const runtime = this.runtime;
    const revision = this.revision;
    let attempted = false;
    let operationSucceeded = false;
    let credentialRejected = false;
    const assertCurrent = () => {
      if (revision !== this.revision || this.snapshot.phase === 'disposed')
        throw new CustodyOperationError('CANCELLED');
      if (this.lockFailed || this.snapshot.phase === 'unavailable')
        throw new CustodyOperationError('UNAVAILABLE');
    };
    // Set admission before publishing: observers may synchronously submit again.
    let resolveAdmission!: () => void;
    this.pending = new Promise<void>((resolve) => { resolveAdmission = resolve; });
    this.publish({ phase: 'authenticating', account: null, error: null });
    const task = (async () => {
      try {
        await this.drainLocks();
        assertCurrent();
        attempted = true;
        if (operation === 'create') {
          await runtime.session.createWallet(password);
          operationSucceeded = true;
        } else if (operation === 'import') {
          await runtime.session.importWallet(phrase!, password);
          operationSucceeded = true;
        }
        else {
          const result = await runtime.session.unlock(password);
          assertCurrent();
          if (!result || typeof result.authenticated !== 'boolean')
            throw new CustodyOperationError('OPERATION_FAILED');
          if (!result.authenticated) {
            credentialRejected = true;
            throw new CustodyOperationError('INVALID_CREDENTIAL');
          }
        }
        assertCurrent();
        await this.readState(true);
        assertCurrent();
        if (operation !== 'unlock' && this.snapshot.backup !== 'unconfirmed') {
          this.failUnavailable();
          throw new CustodyOperationError('UNAVAILABLE');
        }
        const address = normalizePublicAddress(
          await runtime.session.readEthereumAddress(), 'ethereum'
        );
        assertCurrent();
        this.publish({
          phase: this.snapshot.backup === 'confirmed' ? 'ready' : 'backup-required',
          account: Object.freeze({ network: this.selectedNetwork(runtime), address }),
          error: null,
        });
        assertCurrent();
      } catch (cause) {
        // Raw SDK unlock can finish after lock. Retire its late session before
        // admitting the next attempt; cleanup must never target a newer session.
        this.requestLock();
        try { await this.drainLocks(); } catch { /* quarantined by requestLock */ }
        if (attempted && operation !== 'unlock' && this.snapshot.phase !== 'disposed') {
          try { await this.readState(operationSucceeded); } catch { this.failUnavailable(); }
        }
        if (this.snapshot.phase === 'disposed' || revision !== this.revision) {
          if (this.snapshot.phase !== 'disposed' && this.snapshot.phase !== 'unavailable') {
            this.publish({ phase: this.snapshot.presence === 'empty' ? 'empty' : 'locked', account: null });
          }
          throw new CustodyOperationError('CANCELLED');
        }
        if (this.lockFailed || this.snapshot.phase === 'unavailable')
          throw new CustodyOperationError('UNAVAILABLE');
        const code = credentialRejected ? 'INVALID_CREDENTIAL' :
          cause instanceof CustodyRuntimeError &&
          (cause.code === 'AUTH_THROTTLED' || cause.code === 'INVALID_INPUT')
            ? cause.code : 'OPERATION_FAILED';
        this.publish({
          phase: this.snapshot.presence === 'empty' ? 'empty' : 'locked',
          account: null,
          error: code,
        });
        throw new CustodyOperationError(code);
      } finally {
        this.pending = null;
        resolveAdmission();
      }
    })();
    // The admission promise lets dispose wait even when called by an observer
    // before this task has reached its first await.
    return task;
  }

  private close(): Promise<void> {
    if (!this.closing) this.closing = this.runtime?.storage.close() ?? Promise.resolve();
    return this.closing;
  }

  /** Only this owner's original runtime may supply recovery's freshness identity. */
  retireForRecovery(): Promise<string> {
    if (this.recoveryRetirement) return this.recoveryRetirement;
    if (this.disposal || this.snapshot.phase !== 'locked' || !this.runtime)
      return Promise.reject(new CustodyOperationError('NOT_READY'));
    this.startDisposal(true);
    return this.recoveryRetirement!;
  }

  dispose(): Promise<void> { return this.startDisposal(false); }

  private startDisposal(capturePair: boolean): Promise<void> {
    if (this.disposal) return this.disposal;
    // Install the promise before notifying observers to make reentrant disposal
    // idempotent, including disposal initiated during an authentication event.
    let resolveDisposal!: () => void;
    let rejectDisposal!: (error: CustodyOperationError) => void;
    this.disposal = new Promise<void>((resolve, reject) => {
      resolveDisposal = resolve;
      rejectDisposal = reject;
    });
    let pairFingerprint: string | undefined;
    if (capturePair) this.recoveryRetirement = this.disposal.then(() => {
      if (!pairFingerprint) throw new CustodyOperationError('CLEANUP_FAILED');
      return pairFingerprint;
    });
    this.revision++;
    this.publish({ phase: 'disposed', account: null, error: null });
    this.listeners.clear();
    this.requestLock();
    const pending = this.pending;
    void (async () => {
      await this.initialization?.catch(() => undefined);
      await pending;
      this.requestLock();
      let failed = false;
      try { await this.drainLocks(); } catch { failed = true; }
      if (capturePair && !failed) {
        try {
          const fingerprint = await this.runtime?.storage.retireForRecovery?.();
          if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Invalid retirement');
          pairFingerprint = fingerprint;
        } catch { failed = true; }
      }
      try { await this.close(); } catch { failed = true; }
      if (failed) throw new CustodyOperationError('CLEANUP_FAILED');
    })().then(resolveDisposal, () => rejectDisposal(new CustodyOperationError('CLEANUP_FAILED')));
    return this.disposal;
  }
}
