import { idleMinutes, weakensIdlePolicy } from '../../../../source/shared/idleLockPolicy.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { SecurityPreferences, SecurityPreferenceSnapshot } from '../core/securityPreferences.ts';
import type { PublicViewLock } from '../core/publicViewLock.ts';
import type { NativeAccountRequest, NativeNetworkSelectionProof, NativeNetworkSelectionReceipt } from './accounts.ts';
import type { NativeImportRequest, NativeUtxoImportDraft } from './importedAccounts.ts';
import type { NativePrivateAuthentication } from './privateAuthentication.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import type { NativeSmartCreationAllocation, NativeSmartCreationRequest } from '../smartAccount/preparation.ts';
import type { NativeConnectionSigningHost } from '../connections/host.ts';
import { resolveSmartAccountPreparationTarget } from '../../../../source/shared/smartAccountPreparation.ts';
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
  private readonly policy?: { preferences: SecurityPreferences; assertActive(): void; viewLock: PublicViewLock };
  private checkingIdle = false;
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
  private accountCancellation: (() => void) | null = null;
  private snapshot: CustodySnapshot = Object.freeze({
    phase: 'opening',
    revision: 0,
    presence: 'unknown',
    backup: 'unknown',
    account: null,
    error: null,
  });

  constructor(factory: CustodyRuntimeFactory, policy?: { preferences: SecurityPreferences; assertActive(): void; viewLock: PublicViewLock }) {
    this.factory = factory; this.policy = policy;
  }

  private checkIdle(): void {
    if (!this.policy || this.checkingIdle) return;
    this.checkingIdle = true;
    try { this.policy.viewLock.assertUnlocked(); const result: unknown = this.policy.assertActive(); if (result !== undefined) { if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined); throw new Error('CANCELLED'); } }
    catch { if (!['locked', 'disposed', 'unavailable'].includes(this.snapshot.phase)) this.lock(); throw new CustodyOperationError('CANCELLED'); }
    finally { this.checkingIdle = false; }
  }

  getSnapshot(): CustodySnapshot {
    if (['ready', 'authenticating'].includes(this.snapshot.phase)) { try { this.checkIdle(); } catch { /* Return the revoked snapshot. */ } }
    return this.snapshot;
  }

  getCatalogue(): NativeWalletCatalogueSnapshot | null {
    if (this.snapshot.phase !== 'ready') return null;
    return this.runtime?.accounts?.getSnapshot() ?? null;
  }

  supportsAccountManagement(): boolean { return this.runtime?.accounts?.supported() === true; }

  cancelAccountOperation(): void {
    if (this.accountCancellation) this.accountCancellation();
    else if (this.accountOperation) this.lock();
  }

  manageAccounts(request: NativeAccountRequest, expectedRevision: number, expectedCatalogueRevision: number): Promise<void> {
    return this.manageContext((runtime) => {
      if (!runtime.accounts) throw new CustodyRuntimeError('NOT_READY');
      return runtime.accounts.reserve(request, expectedCatalogueRevision);
    }, expectedRevision, true);
  }

  /** Adopt only the allocation produced by this authority's live private host. */
  allocateConnectionSmartAccount(input: NativeSmartCreationRequest, signal: AbortSignal,
    assertRequestCurrent: () => void, onCommitted: (allocation: NativeSmartCreationAllocation) => void, authentication: NativePrivateAuthentication | null): Promise<NativeSmartCreationAllocation> {
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    const runtime = this.runtime;
    if (!runtime || this.snapshot.phase !== 'ready' || !this.snapshot.account ||
        !('openConnectionHost' in runtime) || typeof runtime.openConnectionHost !== 'function')
      return Promise.reject(new CustodyOperationError('NOT_READY'));
    if (!signal || signal.aborted || typeof onCommitted !== 'function' || typeof assertRequestCurrent !== 'function')
      return Promise.reject(new CustodyOperationError('CANCELLED'));
    const request = Object.freeze({ networkId: input.networkId, label: input.label, externalOwnersAcknowledged: input.externalOwnersAcknowledged,
      target: resolveSmartAccountPreparationTarget(input.target, { slhDsaSupported: false }) });
    const openHost = runtime.openConnectionHost as () => Promise<NativeConnectionSigningHost>;
    let revision = this.revision, committed: NativeSmartCreationAllocation | undefined;
    const current = () => {
      this.checkIdle();
      if (this.runtime !== runtime || this.revision !== revision || this.snapshot.phase !== 'ready' || signal.aborted)
        throw new CustodyOperationError('CANCELLED');
      if (this.lockFailed) throw new CustodyOperationError('UNAVAILABLE');
      assertSynchronousEvmFeeGuard(assertRequestCurrent);
    };
    current();
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    this.accountOperation = true;
    return (async () => {
      try {
        await this.drainLocks(); current();
        const host = await openHost.call(runtime); current();
        const allocation = await host.allocateSmartAccount(request, signal, current, receipt => {
          current(); receipt.assertCurrent();
          if (committed && committed !== receipt) throw new CustodyOperationError('CANCELLED');
          committed = receipt;
          // The request records its durable account before either the runtime
          // or the authority publishes the deliberate selection transition.
          assertSynchronousEvmFeeGuard(() => onCommitted(receipt));
        }, authentication);
        current();
        if (!committed || allocation !== committed || allocation.networkId !== request.networkId ||
            JSON.stringify(allocation.target) !== JSON.stringify(request.target)) throw new CustodyOperationError('UNAVAILABLE');
        const assertSelection = () => {
          current(); allocation.assertCurrent();
          const catalogue = runtime.accounts?.getSnapshot();
          const selected = catalogue?.accounts.find(account => account.id === catalogue.active.accountId);
          if (!catalogue || catalogue.active.networkId !== allocation.networkId || catalogue.active.accountId !== allocation.account.id ||
              selected?.type !== 'SmartAccount' || selected.index !== allocation.account.index || selected.address !== allocation.account.address ||
              selected.smartAccount?.chainId !== allocation.chainId || this.selectedNetwork(runtime) !== allocation.networkId)
            throw new CustodyOperationError('UNAVAILABLE');
          return catalogue;
        };
        assertSelection();
        await this.readState(true); assertSelection();
        const address = normalizePublicAddress(await runtime.session.readSelectedAddress(), allocation.networkId, assertSelection().utxoNetworks);
        assertSelection();
        if (address !== allocation.account.address) throw new CustodyOperationError('UNAVAILABLE');
        revision = ++this.revision;
        this.publish({ phase: 'ready',
          account: Object.freeze({ network: allocation.networkId, address }), error: null });
        current(); allocation.assertCurrent();
        return allocation;
      } catch (cause) {
        // A commit may have succeeded even when its acknowledgement was lost.
        // Keep the saved account and retire custody instead of exposing a stale
        // ready address beside the newly selected private account.
        this.lock();
        try { await this.drainLocks(); } catch { /* Cleanup publishes quarantine. */ }
        if (this.lockFailed || this.snapshot.phase === 'unavailable') throw new CustodyOperationError('UNAVAILABLE');
        throw new CustodyOperationError(cause instanceof CustodyOperationError ? cause.code : 'OPERATION_FAILED');
      } finally {
        this.accountOperation = false; this.pending = null; release();
      }
    })();
  }

  /** A connection request selects through the same owned context publication as account management. */
  selectConnectionAccount(accountId: string, expectedRevision: number, assertRequestCurrent: () => void): Promise<void> {
    const checkRequest = () => {
      const result: unknown = assertRequestCurrent();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new CustodyOperationError('CANCELLED');
      }
    };
    checkRequest();
    const catalogue = this.getCatalogue();
    if (!catalogue) return Promise.reject(new CustodyOperationError('NOT_READY'));
    return this.manageContext((runtime) => {
      if (!runtime.accounts) throw new CustodyRuntimeError('NOT_READY');
      const selection = runtime.accounts.reserve({ kind: 'select', id: accountId }, catalogue.revision);
      return {
        cancel: selection.cancel,
        execute: (assertCurrent) => selection.execute(() => {
          assertCurrent(); checkRequest(); assertCurrent();
        }),
      };
    }, expectedRevision);
  }

  /** Local, read-only SDK preview. The form receives only the public address. */
  async previewUtxoImport(input: NativeUtxoImportDraft, expectedRevision: number,
    expectedCatalogueRevision: number, assertCurrent: () => void): Promise<string> {
    const runtime = this.runtime;
    const guard = () => {
      const result: unknown = assertCurrent();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new CustodyOperationError('CANCELLED');
      }
      this.checkIdle();
      if (runtime !== this.runtime || this.revision !== expectedRevision ||
          this.snapshot.phase !== 'ready' || this.pending)
        throw new CustodyOperationError('CANCELLED');
    };
    guard();
    if (!runtime?.imports) throw new CustodyOperationError('NOT_READY');
    const address = await runtime.imports.previewUtxo(input, expectedCatalogueRevision, guard);
    guard();
    return address;
  }

  /** Private protected-form path; imported key material never enters account projections. */
  importAccount(input: NativeImportRequest, expectedRevision: number, expectedCatalogueRevision: number, signal: AbortSignal, authentication: NativePrivateAuthentication): Promise<void> {
    return this.manageContext((runtime) => {
      if (!runtime.imports) throw new CustodyRuntimeError('NOT_READY');
      return runtime.imports.reserve(input, expectedCatalogueRevision, signal, authentication);
    }, expectedRevision, true);
  }

  /** Selection revokes outstanding reviews before changing the saved EVM context. */
  selectNetwork(id: string, expectedRevision: number, expectedCatalogueRevision: number, onCommitted: (proof: NativeNetworkSelectionProof) => void): Promise<NativeNetworkSelectionReceipt> {
    if (typeof onCommitted !== 'function') return Promise.reject(new CustodyOperationError('INVALID_INPUT'));
    return this.manageContext((runtime) => {
      if (!runtime.networks) throw new CustodyRuntimeError('NOT_READY');
      const admitted = runtime.networks.reserve(id, expectedCatalogueRevision);
      return { cancel: admitted.cancel, execute: async (check) => {
        const proof = await admitted.execute(check); check();
        if (!proof || proof.sourceCatalogueRevision !== expectedCatalogueRevision || proof.target.id !== id || proof.selection.networkId !== id)
          throw new CustodyRuntimeError('OPERATION_FAILED');
        proof.assertCurrent(); check();
        const catalogue = runtime.accounts?.getSnapshot(), selected = catalogue?.accounts.find(account => account.id === proof.selection.accountId);
        if (catalogue?.revision !== expectedCatalogueRevision + 1 || catalogue.active.accountId !== proof.selection.accountId || catalogue.active.networkId !== id || selected?.address !== proof.selection.address)
          throw new CustodyRuntimeError('OPERATION_FAILED');
        // Persistence is acknowledged here. Public state readback may still be
        // cancelled, so its receipt cannot own committed-transition cleanup.
        assertSynchronousEvmFeeGuard(() => onCommitted(proof));
        const assertReceipt = () => {
          proof.assertCurrent();
          const current = runtime.accounts?.getSnapshot();
          if (this.runtime !== runtime || this.snapshot.phase !== 'ready' || this.revision !== expectedRevision + 1 || this.snapshot.account?.network !== id || this.snapshot.account.address !== proof.selection.address || current?.revision !== expectedCatalogueRevision + 1 || current.active.accountId !== proof.selection.accountId || current.active.networkId !== id || !current.accounts.some(account => account.id === proof.selection.accountId && account.address === proof.selection.address)) throw new CustodyOperationError('CANCELLED');
        };
        return Object.freeze({ ...proof, sourceContextRevision: expectedRevision, contextRevision: expectedRevision + 1, catalogueRevision: expectedCatalogueRevision + 1, assertCurrent: assertReceipt });
      } };
    }, expectedRevision).then(receipt => { receipt.assertCurrent(); return receipt; });
  }

  async addUtxoNetwork(draft: import('./accounts.ts').NativeUtxoNetworkDraft, expectedRevision: number,
    expectedCatalogueRevision: number, signal: AbortSignal): Promise<void> {
    const { networks, check, checkRoute } = this.ownedUtxoNetworkSettings(expectedRevision, expectedCatalogueRevision, signal);
    if (!networks.prepareUtxo) throw new CustodyOperationError('NOT_READY');
    const proof = await networks.prepareUtxo(draft, expectedCatalogueRevision, signal, check);
    check();
    return this.commitUtxoNetwork(networks, proof, expectedRevision, expectedCatalogueRevision, checkRoute);
  }

  editUtxoNetwork(id: string, draft: import('./accounts.ts').NativeUtxoNetworkEditDraft, expectedRevision: number,
    expectedCatalogueRevision: number, signal: AbortSignal): Promise<void> {
    return this.changeUtxoNetwork({ kind: 'edit-utxo-network', id, draft }, expectedRevision, expectedCatalogueRevision, signal);
  }

  removeUtxoNetwork(id: string, expectedRevision: number, expectedCatalogueRevision: number, signal: AbortSignal): Promise<void> {
    return this.changeUtxoNetwork({ kind: 'remove-utxo-network', id }, expectedRevision, expectedCatalogueRevision, signal);
  }

  private async changeUtxoNetwork(request: import('./accounts.ts').NativeUtxoNetworkChange, expectedRevision: number,
    expectedCatalogueRevision: number, signal: AbortSignal): Promise<void> {
    const { networks, check, checkRoute } = this.ownedUtxoNetworkSettings(expectedRevision, expectedCatalogueRevision, signal);
    if (!networks.withUtxoChangeApproval) throw new CustodyOperationError('NOT_READY');
    return networks.withUtxoChangeApproval(request, expectedCatalogueRevision, signal, check, (proof) => {
      check();
      return this.commitUtxoNetwork(networks, proof, expectedRevision, expectedCatalogueRevision, checkRoute);
    });
  }

  private commitUtxoNetwork(networks: import('./accounts.ts').NativeNetworkRuntime,
    proof: import('./accounts.ts').NativeUtxoNetworkApproval, expectedRevision: number,
    expectedCatalogueRevision: number, checkRoute: () => void) {
    return this.manageContext(() => {
      const admitted = networks.reserve(proof, expectedCatalogueRevision);
      return {
        cancel: admitted.cancel,
        execute: async (assertCurrent) => { await admitted.execute(() => { checkRoute(); assertCurrent(); }); },
      };
    }, expectedRevision);
  }

  private ownedUtxoNetworkSettings(expectedRevision: number, expectedCatalogueRevision: number, signal: AbortSignal) {
    const runtime = this.runtime, networks = runtime?.networks;
    if (!networks) throw new CustodyOperationError('NOT_READY');
    const checkRoute = () => {
      if (signal.aborted) throw new CustodyOperationError('CANCELLED');
    };
    const check = () => {
      checkRoute();
      const snapshot = this.getSnapshot();
      if (runtime !== this.runtime || snapshot.phase !== 'ready' || snapshot.revision !== expectedRevision ||
          this.getCatalogue()?.revision !== expectedCatalogueRevision)
        throw new CustodyOperationError('CANCELLED');
    };
    check();
    return { networks, check, checkRoute };
  }

  manageNetwork(request: Exclude<import('./accounts.ts').NativeNetworkRequest, { kind: 'select-network' }>, expectedRevision: number, expectedCatalogueRevision: number): Promise<void> {
    return this.manageContext((runtime) => {
      if (!runtime.networks) throw new CustodyRuntimeError('NOT_READY');
      const admitted = runtime.networks.reserve(request, expectedCatalogueRevision);
      return { cancel: admitted.cancel, execute: async (check) => { await admitted.execute(check); } };
    }, expectedRevision);
  }

  private selectedNetwork(runtime: CustodyRuntime) {
    if (!runtime.networks) return 'ethereum' as const;
    const id = runtime.networks.getSelectedId();
    if (!id) throw new CustodyRuntimeError('NOT_READY');
    return id;
  }

  private manageContext<T>(reserve: (runtime: CustodyRuntime) => { execute(assertCurrent: () => void): Promise<T>; cancel(): void }, expectedRevision: number, accountAuthentication = false): Promise<T> {
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    if (!this.runtime || this.snapshot.phase !== 'ready')
      return Promise.reject(new CustodyOperationError('NOT_READY'));
    if (this.revision !== expectedRevision) return Promise.reject(new CustodyOperationError('CANCELLED'));
    const runtime = this.runtime;
    const previous = this.snapshot;
    const previousCatalogue = accountAuthentication ? runtime.accounts?.getSnapshot() : null;
    let reservation: { execute(assertCurrent: () => void): Promise<T>; cancel(): void };
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
    const cancelAccount = () => reservation.cancel();
    if (accountAuthentication) this.accountCancellation = cancelAccount;
    const revision = ++this.revision;
    this.publish({ phase: 'authenticating', account: null, error: null });
    const current = () => {
      if (this.revision !== revision || this.snapshot.phase === 'disposed') throw new CustodyOperationError('CANCELLED');
      this.checkIdle();
      if (this.lockFailed || this.snapshot.phase === 'unavailable') throw new CustodyOperationError('UNAVAILABLE');
    };
    return (async () => {
      try {
        await this.drainLocks(); current();
        const result = await reservation.execute(current); current();
        await this.readState(true); current();
        const network = this.selectedNetwork(runtime);
        const address = normalizePublicAddress(await runtime.session.readSelectedAddress(), network, runtime.accounts?.getSnapshot()?.utxoNetworks);
        current();
        this.publish({ phase: 'ready', account: Object.freeze({ network, address }), error: null });
        current();
        return result;
      } catch (cause) {
        if (accountAuthentication && runtime.accounts?.isAuthenticationRefusal(cause) &&
            cause instanceof CustodyRuntimeError && this.runtime === runtime && this.revision === revision &&
            this.snapshot.phase === 'authenticating' && previous.phase === 'ready' && previous.account &&
            runtime.accounts.getSnapshot() === previousCatalogue) {
          current();
          this.publish({ phase: 'ready', account: previous.account, error: cause.code });
          throw new CustodyOperationError(cause.code);
        }
        reservation.cancel();
        this.requestLock();
        try { await this.drainLocks(); } catch { /* Unavailable was published by cleanup. */ }
        this.checkIdle();
        if (this.lockFailed || this.snapshot.phase === 'unavailable') throw new CustodyOperationError('UNAVAILABLE');
        if (this.revision !== revision || this.snapshot.phase === 'disposed') throw new CustodyOperationError('CANCELLED');
        const code = cause instanceof CustodyRuntimeError ? cause.code : 'OPERATION_FAILED';
        this.publish({ phase: 'locked', account: null, error: code });
        throw new CustodyOperationError(code);
      } finally {
        if (this.accountCancellation === cancelAccount) this.accountCancellation = null;
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
    const openingRevision = this.revision;
    void (async () => {
      try {
        await this.policy?.viewLock.load();
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
          if (this.snapshot.presence === 'existing' && this.revision === openingRevision &&
              (!this.policy?.viewLock || this.policy.viewLock.getSnapshot().phase === 'unlocked')) {
            try { await this.unlock(); }
            catch (cause) {
              // Backgrounding may revoke public hydration. Its cleanup has to
              // finish, but a safely locked wallet is still initialized.
              await this.drainLocks();
              if (!(cause instanceof CustodyOperationError) || cause.code !== 'CANCELLED' ||
                  !['locked', 'disposed'].includes(this.snapshot.phase)) throw cause;
            }
          }
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

  create(): Promise<void> {
    return this.authenticate('create');
  }

  async previewPhrase(phrase: string, assertCurrent: () => void) {
    const runtime = this.runtime, revision = this.revision;
    const check = () => {
      if (!runtime?.previewPhrase || runtime !== this.runtime || revision !== this.revision || this.snapshot.phase !== 'empty')
        throw new CustodyOperationError('CANCELLED');
      assertSynchronousEvmFeeGuard(assertCurrent);
    };
    check();
    const addresses = await runtime!.previewPhrase!(phrase, check);
    check();
    return addresses;
  }

  importPhrase(phrase: string): Promise<void> {
    return this.authenticate('import', phrase);
  }

  unlock(): Promise<void> {
    if (this.getSnapshot().phase === 'ready') return Promise.resolve();
    return this.authenticate('unlock');
  }

  isAuthenticating(): boolean {
    return this.snapshot.phase === 'authenticating' && this.runtime?.security?.isAuthenticating() === true;
  }

  async getAuthenticationStatus(): Promise<Readonly<{ deviceAuth: 'ready' | 'missing' | 'unsupported'; credentialPresent: boolean }> | null> {
    const runtime = this.runtime, revision = this.revision;
    if (!runtime?.security || this.snapshot.phase === 'disposed') return null;
    const result = await runtime.security.authenticationStatus();
    if (runtime !== this.runtime || revision !== this.revision || this.getSnapshot().phase === 'disposed') throw new CustodyOperationError('CANCELLED');
    return result;
  }

  /** Refresh wallet-bound setup metadata only while the same session is live. */
  refreshAuthenticatedMetadata(): Promise<void> {
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    if (!this.runtime || !this.snapshot.account ||
      this.snapshot.phase !== 'ready')
      return Promise.reject(new CustodyOperationError('NOT_READY'));
    const runtime = this.runtime;
    const revision = this.revision;
    const account = this.snapshot.account;
    let resolveAdmission!: () => void;
    this.pending = new Promise<void>((resolve) => { resolveAdmission = resolve; });
    const current = () => {
      if (revision !== this.revision || this.snapshot.phase === 'disposed')
        throw new CustodyOperationError('CANCELLED');
      this.checkIdle();
      if (this.lockFailed || this.snapshot.phase === 'unavailable')
        throw new CustodyOperationError('UNAVAILABLE');
    };
    return (async () => {
      try {
        await this.drainLocks(); current();
        await this.readState(true); current();
        const address = normalizePublicAddress(await runtime.session.readSelectedAddress(), account.network, runtime.accounts?.getSnapshot()?.utxoNetworks);
        current();
        if (address !== account.address || this.selectedNetwork(runtime) !== account.network) throw new CustodyOperationError('UNAVAILABLE');
        this.publish({ phase: 'ready' });
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

  saveIdlePreference(expected: SecurityPreferenceSnapshot, proposed: number, signal: AbortSignal, authentication: NativePrivateAuthentication, assertScreen: () => void): Promise<SecurityPreferenceSnapshot> {
    const minutes = idleMinutes(proposed);
    const phase = this.snapshot.phase;
    if (!this.policy || !this.runtime || phase !== 'ready') return Promise.reject(new CustodyOperationError('NOT_READY'));
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    const runtime = this.runtime, policy = this.policy, revision = this.revision;
    const check = () => {
      this.checkIdle();
      if (signal.aborted || runtime !== this.runtime || revision !== this.revision || this.snapshot.phase !== phase) throw new CustodyOperationError('CANCELLED');
      const result: unknown = assertScreen();
      if (result !== undefined) { if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined); throw new CustodyOperationError('CANCELLED'); }
    };
    try { check(); policy.preferences.validate(expected); } catch (error) { return Promise.reject(error); }
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    return (async () => {
      try {
        check();
        if (weakensIdlePolicy(expected.custodyIdleMinutes, minutes)) {
          if (!runtime.security) throw new CustodyOperationError('NOT_READY');
          await runtime.security.reauthenticateIdlePolicy(signal, authentication, check); check();
        }
        return await policy.preferences.save(expected, 'custody', minutes, check);
      } catch (cause) {
        if (runtime.security?.isAuthenticationRefusal(cause)) { check(); throw new CustodyOperationError('CANCELLED'); }
        const code = cause instanceof CustodyRuntimeError || cause instanceof CustodyOperationError ? cause.code : 'OPERATION_FAILED';
        this.lock();
        if (this.snapshot.phase === 'locked') this.publish({ error: code });
        throw new CustodyOperationError(code);
      } finally { this.pending = null; release(); }
    })();
  }

  private authenticate(operation: 'create' | 'import' | 'unlock', phrase?: string): Promise<void> {
    const creating = operation !== 'unlock';
    if (operation === 'import' && (typeof phrase !== 'string' || !phrase || phrase.length > 4096)) return Promise.reject(new CustodyOperationError('INVALID_INPUT'));
    if (this.pending) return Promise.reject(new CustodyOperationError('BUSY'));
    try { this.checkIdle(); } catch (error) { return Promise.reject(error); }
    if (!this.runtime || this.snapshot.phase !== (creating ? 'empty' : 'locked')) return Promise.reject(new CustodyOperationError('NOT_READY'));
    const runtime = this.runtime, revision = this.revision;
    let attempted = false, operationSucceeded = false;
    const check = () => {
      if (revision !== this.revision || this.snapshot.phase === 'disposed') throw new CustodyOperationError('CANCELLED');
      this.checkIdle();
      if (this.lockFailed || this.snapshot.phase === 'unavailable') throw new CustodyOperationError('UNAVAILABLE');
    };
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    this.publish({ phase: 'authenticating', account: null, error: null });
    return (async () => {
      try {
        await this.drainLocks(); check(); attempted = true;
        if (operation === 'create') await runtime.session.createWallet();
        else if (operation === 'import') await runtime.session.importWallet(phrase!);
        else if (!(await runtime.session.unlock()).authenticated) throw new CustodyOperationError('UNAVAILABLE');
        operationSucceeded = true; check(); await this.readState(true); check();
        if (creating && this.snapshot.backup !== 'unconfirmed') {
          this.failUnavailable();
          throw new CustodyOperationError('UNAVAILABLE');
        }
        const network = this.selectedNetwork(runtime);
        const address = normalizePublicAddress(await runtime.session.readSelectedAddress(), network, runtime.accounts?.getSnapshot()?.utxoNetworks);
        check(); this.publish({ phase: 'ready', account: Object.freeze({ network, address }), error: null }); check();
      } catch (cause) {
        this.requestLock(); try { await this.drainLocks(); } catch { /* cleanup quarantines */ }
        if (attempted && creating && this.snapshot.phase !== 'disposed') {
          try { await this.readState(operationSucceeded); } catch { this.failUnavailable(); }
          // A lock may have published empty before an admitted creation committed.
          // Reconcile its durable presence without reviving the retired operation.
          if (this.snapshot.phase === 'empty' && this.snapshot.presence === 'existing')
            this.publish({ phase: 'locked', account: null });
        }
        if (this.snapshot.phase === 'disposed' || revision !== this.revision) throw new CustodyOperationError('CANCELLED');
        this.checkIdle();
        if (this.lockFailed || this.snapshot.phase === 'unavailable') throw new CustodyOperationError('UNAVAILABLE');
        const code = cause instanceof CustodyRuntimeError || cause instanceof CustodyOperationError ? cause.code : 'OPERATION_FAILED';
        this.publish({ phase: this.snapshot.presence === 'empty' ? 'empty' : 'locked', account: null, error: code });
        throw new CustodyOperationError(code);
      } finally { this.pending = null; release(); }
    })();
  }

  private close(): Promise<void> {
    if (!this.closing) this.closing = this.runtime?.storage.close() ?? Promise.resolve();
    return this.closing;
  }

  /** Only this owner's original runtime may supply recovery's freshness identity. */
  retireForRecovery(): Promise<string> {
    if (this.recoveryRetirement) return this.recoveryRetirement;
    if (this.disposal || !['locked', 'ready'].includes(this.snapshot.phase) || !this.runtime)
      return Promise.reject(new CustodyOperationError('NOT_READY'));
    this.startDisposal(true);
    return this.recoveryRetirement!;
  }

  retireForRemoval<T>(expected: CustodySnapshot, operation: () => Promise<T>): Promise<T> {
    const retire = this.runtime?.storage.retireForRemoval;
    if (this.disposal || this.pending || this.getSnapshot() !== expected ||
        expected.phase !== 'ready' || !retire)
      return Promise.reject(new CustodyOperationError('CANCELLED'));
    let result: Promise<T> | undefined;
    const disposal = this.startDisposal(false, () => retire(async () => {
      result = Promise.resolve().then(operation);
      await result.catch(() => undefined);
    }));
    return disposal.then(() => {
      if (!result) throw new CustodyOperationError('CLEANUP_FAILED');
      return result;
    });
  }

  dispose(): Promise<void> { return this.startDisposal(false); }

  private startDisposal(capturePair: boolean, retire?: () => Promise<void>): Promise<void> {
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
      if (retire && !failed) {
        try { await retire(); } catch { failed = true; }
      }
      try { await this.close(); } catch { failed = true; }
      if (failed) throw new CustodyOperationError('CLEANUP_FAILED');
    })().then(resolveDisposal, () => rejectDisposal(new CustodyOperationError('CLEANUP_FAILED')));
    return this.disposal;
  }
}
