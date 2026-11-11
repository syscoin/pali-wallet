import { CustodyOperationError, type NativeCustodyAuthority } from './authority.ts';
import type { KeyringRuntime } from './keyringRuntime.ts';
import { isOperationAuthenticationCancellation } from '../core/operationAuthentication.ts';
import type { NativePrivateAuthentication, NativePrivateAuthenticationScope } from './privateAuthentication.ts';
import type { NativePinRecord } from './pinVault.ts';
import { CustodyRuntimeError, type CustodySnapshot } from './types.ts';
import { sameRecoverySnapshot } from '../storage/recoverySnapshot.ts';
import { WalletStorageError, type OpenWalletStorage, type RecoveryStorageSnapshot, type WalletRemovalResult } from '../storage/types.ts';

declare const removalTicket: unique symbol;
export type WalletRemovalTicket = Readonly<{ [removalTicket]: true }>;
export type WalletRemovalOutcome = 'wallet-records-removed' | 'wallet-records-unchanged';
type ErrorCode = 'NOT_READY' | 'BUSY' | 'INVALID_INPUT' | 'INVALID_CREDENTIAL' |
  'AUTH_THROTTLED' | 'CANCELLED' | 'STATE_CHANGED' | 'SELECTION_UNAVAILABLE' | 'UNAVAILABLE' | 'REOPEN_REQUIRED';
export class WalletRemovalError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.name = 'WalletRemovalError'; this.code = code; }
}

type Source = Readonly<{
  runtime: Pick<KeyringRuntime, 'authorizeWalletRemoval' | 'catalogue'>;
  storage: OpenWalletStorage;
}>;
type Dependencies = Readonly<{
  owner: Pick<NativeCustodyAuthority, 'getSnapshot' | 'subscribe' | 'lock' | 'retireForRemoval'>;
  source(): Source | undefined;
  reopen(installationId: string): Promise<OpenWalletStorage>;
  clearNativeSelection(assertCurrent: () => void): Promise<void>;
  /** Retire asynchronous producers before sealing the authenticated removal snapshot. */
  beforeSnapshot(assertCurrent: () => void): Promise<void>;
  bindAuthentication(scope: NativePrivateAuthenticationScope, assertOwner: () => void): NativePrivateAuthentication;
  assertActive(): void;
  monotonicMilliseconds?: () => number;
}>;
type Scope = Readonly<{ owner: CustodySnapshot; source: Source; generation: number; signal: AbortSignal; guard: () => void }>;
type Authorized = Readonly<Scope & {
  ticket: WalletRemovalTicket;
  before: RecoveryStorageSnapshot;
  assertRuntime(): void;
  purgePublicCaches(assertCleanupCurrent: () => void): Promise<void>;
  removePinCredential(record: NativePinRecord): Promise<void>;
  installation: string;
  deadline: number;
}>;

const TICKET_MS = 30_000;
const fail = (code: ErrorCode): never => { throw new WalletRemovalError(code); };
function checkGuard(guard: () => void) {
  const result: unknown = guard();
  if (result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
  fail('CANCELLED');
}
function translated(cause: unknown): WalletRemovalError {
  if (cause instanceof WalletRemovalError) return cause;
  if (cause instanceof WalletStorageError) {
    if (cause.code === 'STORAGE_CHANGED') return new WalletRemovalError('STATE_CHANGED');
    if (cause.code === 'STORAGE_CLOSED') return new WalletRemovalError('CANCELLED');
    if (cause.code === 'STORAGE_REOPEN_REQUIRED') return new WalletRemovalError('REOPEN_REQUIRED');
  }
  if (cause instanceof CustodyRuntimeError || cause instanceof CustodyOperationError || cause instanceof WalletStorageError) {
    switch (cause.code) {
      case 'BUSY': case 'NOT_READY': case 'INVALID_INPUT': case 'INVALID_CREDENTIAL':
      case 'AUTH_THROTTLED': case 'CANCELLED': return new WalletRemovalError(cause.code);
      case 'CLEANUP_FAILED': return new WalletRemovalError('REOPEN_REQUIRED');
    }
  }
  return new WalletRemovalError('UNAVAILABLE');
}

/** Private host flow. A ticket contains no password, account data or storage values. */
export class NativeWalletRemoval {
  private generation = 0;
  private lastTime = -Infinity;
  private ready: Authorized | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<unknown> | null = null;
  private authorization: { abort(): void } | null = null;
  private authorizingOwner: CustodySnapshot | null = null;
  private admitting = false;
  private disposed = false;
  private verified = false;
  private unresolved = false;
  private producersRetired = false;
  private readonly unsubscribe: () => void;
  private readonly dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    if (typeof dependencies.beforeSnapshot !== 'function' || typeof dependencies.bindAuthentication !== 'function')
      throw new TypeError('Removal retirement and authentication boundaries are required');
    this.dependencies = dependencies;
    this.unsubscribe = dependencies.owner.subscribe((snapshot) => {
      if ((this.ready && snapshot !== this.ready.owner) || (this.authorizingOwner && snapshot !== this.authorizingOwner)) this.cancel();
    });
  }

  private now() {
    const value = (this.dependencies.monotonicMilliseconds ?? (() => performance.now()))();
    if (!Number.isFinite(value) || value < 0 || value < this.lastTime || value > Number.MAX_SAFE_INTEGER - TICKET_MS) fail('UNAVAILABLE');
    this.lastTime = value;
    return value;
  }

  private owns(scope: Scope) {
    const source = this.dependencies.source();
    return source?.storage === scope.source.storage && source.runtime === scope.source.runtime;
  }

  private reflectRuntimeLock(scope: Scope) {
    try {
      if (!scope.source.runtime.catalogue.getSnapshot() && this.owns(scope) &&
          this.dependencies.owner.getSnapshot() === scope.owner) this.dependencies.owner.lock();
    } catch { /* Report the original typed failure. */ }
  }

  private checkOwnership(scope: Scope, current: CustodySnapshot, deadline = Infinity) {
    const now = this.now(), owned = this.owns(scope), owner = this.dependencies.owner.getSnapshot();
    if (this.disposed || this.generation !== scope.generation || scope.signal.aborted || now >= deadline || !owned || owner !== current) fail('CANCELLED');
  }

  private check(scope: Scope, current: CustodySnapshot, deadline = Infinity, confirm?: () => void) {
    this.checkOwnership(scope, current, deadline);
    try {
      checkGuard(this.dependencies.assertActive);
      checkGuard(scope.guard);
      if (confirm) checkGuard(confirm);
    } catch { fail('CANCELLED'); }
    this.checkOwnership(scope, current, deadline);
  }

  private clearTicket() {
    this.ready = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private retireAuthorization() {
    const authorization = this.authorization;
    this.authorization = null;
    authorization?.abort();
  }

  private own<T>(task: Promise<T>): Promise<T> {
    this.pending = task;
    const release = () => { if (this.pending === task) this.pending = null; };
    void task.then(release, release);
    return task;
  }

  authorize(signal: AbortSignal, authentication: NativePrivateAuthenticationScope, guard: () => void): Promise<WalletRemovalTicket> {
    if (this.pending || this.admitting) return Promise.reject(new WalletRemovalError('BUSY'));
    if (this.disposed || this.verified || this.unresolved) return Promise.reject(new WalletRemovalError('NOT_READY'));
    if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' ||
        !authentication || typeof guard !== 'function') return Promise.reject(new WalletRemovalError('INVALID_INPUT'));
    if (signal.aborted) return Promise.reject(new WalletRemovalError('CANCELLED'));
    this.admitting = true;
    this.clearTicket();
    this.retireAuthorization();
    const generation = ++this.generation;
    const cancellation = new AbortController();
    const abort = () => cancellation.abort();
    signal.addEventListener('abort', abort, { once: true });
    const authorization = { abort() { cancellation.abort(); signal.removeEventListener('abort', abort); } };
    this.authorization = authorization;
    try {
      const owner = this.dependencies.owner.getSnapshot(), source = this.dependencies.source();
      const authorize = source?.runtime.authorizeWalletRemoval;
      if (!source?.storage.removal || !source.storage.recovery || !authorize ||
          owner.presence !== 'existing' || !['ready', 'backup-required'].includes(owner.phase)) return fail('NOT_READY');
      this.authorizingOwner = owner;
      const scope = { owner, source, generation, signal: cancellation.signal, guard };
      const check = () => this.check(scope, owner);
      check();
      // The marker checks only ownership. The view guard may itself ask whether
      // this exact native prompt owns an inactive/blur interruption.
      const binding = this.dependencies.bindAuthentication(authentication, () => this.checkOwnership(scope, owner));
      return this.own(Promise.resolve().then(async () => {
        try {
          check();
          const { snapshot: before, assertCurrent: assertRuntime, purgePublicCaches, removePinCredential } = await authorize(cancellation.signal, binding, check, async (assertCurrent) => {
            checkGuard(assertCurrent);
            check();
            this.producersRetired = true;
            await this.dependencies.beforeSnapshot(assertCurrent);
          });
          check();
          if (typeof purgePublicCaches !== 'function' || typeof removePinCredential !== 'function') return fail('NOT_READY');
          const installation = before.metadata.find((entry) => entry.key === 'installation')?.value;
          if (before.state.presence !== 'existing' || !before.identity || !installation || !/^[0-9a-f]{32}$/.test(installation))
            return fail('STATE_CHANGED');
          const ticket = Object.freeze({}) as WalletRemovalTicket;
          const ready = { ...scope, ticket, before, assertRuntime, purgePublicCaches, removePinCredential, installation, deadline: this.now() + TICKET_MS };
          check();
          this.ready = ready;
          this.timer = setTimeout(() => { if (this.ready === ready) this.cancel(); }, TICKET_MS);
          return ticket;
        } catch (cause) {
          try { check(); } catch (stale) { throw translated(stale); }
          if (isOperationAuthenticationCancellation(cause)) throw cause;
          this.reflectRuntimeLock(scope);
          throw translated(cause);
        } finally {
          if (this.authorizingOwner === owner) this.authorizingOwner = null;
          if (!this.ready && this.authorization === authorization) this.retireAuthorization();
        }
      }));
    } catch (cause) {
      this.authorizingOwner = null;
      if (this.authorization === authorization) this.retireAuthorization();
      return Promise.reject(translated(cause));
    }
    finally { this.admitting = false; }
  }

  confirm(ticket: WalletRemovalTicket, guard: () => void): Promise<WalletRemovalOutcome> {
    const authorized = this.ready;
    if (!authorized || ticket !== authorized.ticket || this.pending || this.admitting || typeof guard !== 'function')
      return Promise.reject(new WalletRemovalError('STATE_CHANGED'));
    this.clearTicket();
    return this.own(Promise.resolve().then(() => this.commit(authorized, guard)).finally(() => this.retireAuthorization()));
  }

  private async commit(authorized: Authorized, guard: () => void): Promise<WalletRemovalOutcome> {
    const { owner, source, deadline } = authorized;
    let result: WalletRemovalResult;
    try {
      this.check(authorized, owner, deadline, guard);
      authorized.assertRuntime();
      this.check(authorized, owner, deadline, guard);
      const current = await source.storage.recovery!.readSnapshot();
      this.check(authorized, owner, deadline, guard);
      if (!sameRecoverySnapshot(current, authorized.before)) return fail('STATE_CHANGED');
      authorized.assertRuntime();
      this.check(authorized, owner, deadline, guard);
      result = await this.dependencies.owner.retireForRemoval(owner, async () => {
        const retired = this.dependencies.owner.getSnapshot();
        if (retired.phase !== 'disposed' || retired.revision !== owner.revision + 1) return fail('CANCELLED');
        const check = () => this.check(authorized, retired, deadline, guard);
        check();
        await authorized.purgePublicCaches(check);
        check();
        // Do this before SQL COMMIT so a process death cannot leave the old
        // native hint pointing at a wallet whose records were removed.
        try { await this.dependencies.clearNativeSelection(check); }
        catch { check(); return fail('SELECTION_UNAVAILABLE'); }
        check();
        return source.storage.removal!.commit(authorized.before, () => {
          try { check(); } catch { throw new WalletStorageError('STORAGE_CHANGED'); }
        });
      });
    } catch (cause) {
      const error = translated(cause);
      if (error.code === 'REOPEN_REQUIRED') this.unresolved = true;
      if (error.code === 'CANCELLED') this.reflectRuntimeLock(authorized);
      throw error;
    }

    // A dispatched write needs durable reconciliation even if its screen
    // cancels. Never replay the deletion and never reopen the retired owner.
    try {
      if (result?.status !== 'wallet-records-removed' && result?.status !== 'reopen-required') return fail('REOPEN_REQUIRED');
      const reopened = await this.dependencies.reopen(authorized.installation);
      if (reopened === source.storage) return fail('REOPEN_REQUIRED');
      let actual: RecoveryStorageSnapshot;
      try {
        if (!reopened.recovery || !reopened.removal) return fail('REOPEN_REQUIRED');
        await reopened.removal.settlePinCredential(authorized.removePinCredential);
        actual = await reopened.recovery.readSnapshot();
      } finally { await reopened.close(); }
      if (actual.state.presence === 'empty' && actual.state.backup === 'unconfirmed' && !actual.identity &&
          actual.metadata.length === 1 && actual.metadata[0]?.key === 'installation' && actual.metadata[0].value === authorized.installation &&
          !actual.records.length && !actual.notes.length && !actual.signedRecords.length) {
        this.verified = true;
        return 'wallet-records-removed';
      }
      if (result.status === 'reopen-required' && actual.state.presence === 'existing' && sameRecoverySnapshot(actual, authorized.before))
        return 'wallet-records-unchanged';
      return fail('REOPEN_REQUIRED');
    } catch {
      this.unresolved = true;
      return fail('REOPEN_REQUIRED');
    }
  }

  hasVerifiedRemoval(): boolean { return this.verified; }

  requiresControllerReopen(): boolean { return this.producersRetired; }

  cancel(): void { this.generation++; this.authorizingOwner = null; this.clearTicket(); this.retireAuthorization(); }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancel(); this.unsubscribe();
    await this.pending?.catch(() => undefined);
    if (this.unresolved) fail('REOPEN_REQUIRED');
  }
}
