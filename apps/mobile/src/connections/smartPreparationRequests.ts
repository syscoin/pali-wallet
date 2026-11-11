import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope, type NativePrivateAuthentication } from '../custody/privateAuthentication.ts';
import { getAddress } from '../../../../source/utils/ethersV6Compat.ts';
import { buildECDSAAuthenticator } from '../../../../source/utils/smartAccount/authenticators.ts';
import { DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';
import { projectSmartAccountPreparationResult, resolveSmartAccountPreparationTarget, type SmartAccountPreparationAuthenticator, type SmartAccountPreparationTarget } from '../../../../source/shared/smartAccountPreparation.ts';
import { NativeOperationDrain } from '../custody/operationDrain.ts';
import type { NativeSmartCreationAllocation } from '../smartAccount/preparation.ts';
import type { NativeSmartAccountOperation, NativeSmartAccountOperationSnapshot } from '../smartAccount/operation.ts';
import type { NativeConnectionSigningHost, NativeRequestAuthenticationBinder } from './host.ts';
import type { NativeSigningHandoff } from './signingHandoff.ts';
import type { WalletConnectRequest, WalletConnectVerification } from './walletConnect.ts';

export type NativeSmartPreparationRequest = Readonly<{ label: string; authenticator: SmartAccountPreparationAuthenticator }>;
export type NativeSmartPreparationAdmission = Readonly<{
  order: number; networkId: string; networkLabel: string; chainId: string;
  assertCurrent(): void; assertSessionCurrent(): void;
}>;
export type NativeSmartPreparationReview = Readonly<{
  id: string; revision: number; appName: string; origin: string; verification: WalletConnectVerification;
  label: string; requestedAuthenticatorId: string; networkLabel: string; chainId: string; expiresAt: number;
  busy: boolean; error: 'BLOCKED_SITE' | 'SITE_MISMATCH' | 'PREPARATION_UNAVAILABLE' | 'DELIVERY_UNCERTAIN' | null;
  externalOwners: readonly string[]; accountAddress: string | null; operation: NativeSmartAccountOperationSnapshot | null;
  requestedOwners: readonly string[]; requestedThreshold: number | null; canRetry: boolean;
}>;
type Pending = {
  authenticationScope: NativePrivateAuthenticationScope; authentication: NativePrivateAuthentication | null;
  id: string; wire: WalletConnectRequest; request: NativeSmartPreparationRequest; owner: NativeSmartPreparationAdmission;
  target?: Extract<SmartAccountPreparationTarget, { id: 'ecdsa' }> | Readonly<{ id: 'p256-webauthn' }>; lifetime: AbortController; expiresAt: number; timer: ReturnType<typeof setTimeout>;
  busy: boolean; allocating: boolean; consentAccepted: boolean; externalOwners: readonly string[];
  error: NativeSmartPreparationReview['error']; allocation?: NativeSmartCreationAllocation;
  operation?: NativeSmartAccountOperation; unsubscribe?: () => void; signingAttempted: boolean; broadcast: boolean;
  stages: number; deploymentSeen: boolean; connectionAttempted: boolean; responseAttempted: boolean; dispatched: boolean; work?: Promise<void>; retiring?: Promise<void>;
};
type Options = Readonly<{
  bindAuthentication: NativeRequestAuthenticationBinder;
  host(): Pick<NativeConnectionSigningHost, 'context' | 'allocateSmartAccount' | 'prepareSmartAccountCreationOperation'>; foreground(order: number): boolean; changed(): void;
  checkSite(origin: string): Promise<Readonly<{ isBlacklisted: boolean }>>;
  connect(wire: WalletConnectRequest, allocation: NativeSmartCreationAllocation, signal: AbortSignal, assertCurrent: () => void): Promise<void>;
  respond(wire: WalletConnectRequest, response: { result: unknown } | { error: { code: number; message: string } }, assertCurrent: () => void, onDispatch: () => void): Promise<void>;
}>;

/** Ephemeral creation consent. A committed account receipt is never replaced by a retry. */
export class NativeSmartPreparationRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly retirements = new Map<Promise<void>, number>();
  private readonly drain = new NativeOperationDrain();
  private closed = false;
  private readonly options: Options;
  constructor(options: Options) { this.options = options; }
  private first(): Pending | undefined { return this.pending.values().next().value; }
  private retirementOrder() { return Math.min(Infinity, ...this.retirements.values()); }
  get firstOrder() { return Math.min(this.first()?.owner.order ?? Infinity, this.retirementOrder()); }
  isRequestAuthenticating(id: string): boolean {
    const entry = this.first();
    if (!entry || entry.id !== id || !this.foreground(entry)) return false;
    try { this.check(entry); return entry.authenticationScope.isAuthenticating(); } catch { return false; }
  }
  private authentication(entry: Pending): NativePrivateAuthentication {
    if (!entry.authentication) throw Error('REQUEST_EXPIRED');
    return entry.authentication;
  }
  get size() { return this.pending.size; }
  count(topic: string) { return [...this.pending.values()].filter(entry => entry.wire.session.binding.topic === topic).length; }
  has(wire: WalletConnectRequest) { return [...this.pending.values()].some(entry => entry.wire.id === wire.id && entry.wire.session.binding.topic === wire.session.binding.topic); }
  private sessionCurrent(entry: Pending) {
    if (this.closed || this.pending.get(entry.id) !== entry || entry.lifetime.signal.aborted || Date.now() >= entry.expiresAt) throw Error('REQUEST_EXPIRED');
    entry.owner.assertSessionCurrent();
  }
  private check(entry: Pending) {
    this.sessionCurrent(entry);
    if (entry.allocating) return;
    if (entry.allocation) entry.allocation.assertCurrent(); else entry.owner.assertCurrent();
  }
  private foreground(entry: Pending) { return this.first() === entry && entry.owner.order < this.retirementOrder() && this.options.foreground(entry.owner.order); }
  private externalOwners(target: Pending['target']): readonly string[] {
    if (target?.id !== 'ecdsa' || !target.config) return Object.freeze([]);
    const local = this.options.host().context().accounts.filter(account => ['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(account.type));
    return Object.freeze(target.config.owners.filter(owner => !local.some(account => account.address.toLowerCase() === owner.toLowerCase())));
  }
  private retryable(entry: Pending) {
    return entry.error === 'PREPARATION_UNAVAILABLE' && !!entry.target && !entry.connectionAttempted && !entry.responseAttempted &&
      (!entry.signingAttempted || entry.operation?.getSnapshot().phase === 'complete');
  }
  enqueue(wire: WalletConnectRequest, request: NativeSmartPreparationRequest, owner: NativeSmartPreparationAdmission) {
    if (this.closed || this.has(wire) || this.pending.size >= DAPP_REQUEST_LIMITS.pendingRequests) throw Error('REQUEST_EXPIRED');
    owner.assertCurrent();
    const expiresAt = Math.min(wire.expiresAt, wire.session.expiry * 1000, Date.now() + 5 * 60_000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw Error('REQUEST_EXPIRED');
    const captured = Object.freeze({ label: request.label, authenticator: JSON.parse(JSON.stringify(request.authenticator)) as SmartAccountPreparationAuthenticator });
    const id = `preparation-${owner.order}`;
    if (this.pending.has(id)) throw Error('REQUEST_EXPIRED');
    let target: Pending['target'], error: Pending['error'] = wire.verification.isScam ? 'BLOCKED_SITE' : wire.verification.validation === 'INVALID' ? 'SITE_MISMATCH' : null;
    try {
      const selected = resolveSmartAccountPreparationTarget(captured.authenticator, { slhDsaSupported: false });
      if (selected.id !== 'ecdsa' && selected.id !== 'p256-webauthn') throw Error('UNSUPPORTED_AUTHENTICATOR');
      target = selected.id === 'p256-webauthn' ? { id: selected.id } : selected as Extract<SmartAccountPreparationTarget, { id: 'ecdsa' }>;
    } catch { error ??= 'PREPARATION_UNAVAILABLE'; }
    const entry: Pending = { authenticationScope: createNativePrivateAuthenticationScope(), authentication: null, id, wire, request: captured, owner, target, lifetime: new AbortController(), expiresAt,
      timer: setTimeout(() => { void this.retire(entry, true); }, expiresAt - Date.now()), busy: false, allocating: false,
      consentAccepted: false, externalOwners: this.externalOwners(target), error, signingAttempted: false, broadcast: false,
      stages: 0, deploymentSeen: false, connectionAttempted: false, responseAttempted: false, dispatched: false };
    this.pending.set(id, entry);
    try { entry.authentication = this.options.bindAuthentication(entry.authenticationScope, () => this.sessionCurrent(entry)); }
    catch (error) { void this.retire(entry, false); throw error; }
    this.options.changed();
  }
  review(revision: number): NativeSmartPreparationReview | null {
    const entry = this.first();
    if (!entry || !this.foreground(entry)) return null;
    return Object.freeze({ id: entry.id, revision, appName: entry.wire.session.metadata.name, origin: entry.wire.session.binding.origin,
      verification: entry.wire.verification, label: entry.request.label, requestedAuthenticatorId: entry.request.authenticator.id ?? '',
      networkLabel: entry.owner.networkLabel, chainId: entry.owner.chainId, expiresAt: entry.expiresAt, busy: entry.busy,
      error: entry.error, externalOwners: entry.externalOwners, accountAddress: entry.allocation?.account.address ?? null,
      operation: entry.operation?.getSnapshot() ?? null, requestedOwners: entry.target?.id === 'ecdsa' ? entry.target.config?.owners ?? Object.freeze([]) : Object.freeze([]),
      requestedThreshold: entry.target?.id === 'ecdsa' ? entry.target.config?.threshold ?? null : null, canRetry: this.retryable(entry) });
  }
  private admitted(id: string) {
    const entry = this.first();
    if (!entry || entry.id !== id || !this.foreground(entry)) throw Error('REQUEST_EXPIRED');
    this.check(entry); return entry;
  }
  private handoff(entry: Pending): NativeSigningHandoff {
    return Object.freeze({ id: entry.id, expiresAt: entry.expiresAt,
      beforeSuiteOpen() { throw Error('Suite continuation is unavailable for smart account creation'); },
      beforeSignature: () => this.check(entry), isSuspended: () => false });
  }
  private assertAllocation(entry: Pending, allocation: NativeSmartCreationAllocation) {
    if (allocation.account.type !== 'SmartAccount' || allocation.networkId !== entry.owner.networkId ||
        BigInt(allocation.chainId) !== BigInt(entry.owner.chainId) || JSON.stringify(allocation.target) !== JSON.stringify(entry.target)) throw Error('Creation allocation changed');
  }
  private verifyOperation(entry: Pending, snapshot: NativeSmartAccountOperationSnapshot) {
    if (!entry.allocation || snapshot.account.toLowerCase() !== entry.allocation.account.address.toLowerCase() ||
        BigInt(snapshot.network.chainId) !== BigInt(entry.allocation.chainId)) throw Error('Creation operation changed');
    if (snapshot.intent.kind === 'deploy') {
      if (entry.deploymentSeen) throw Error('Repeated creation deployment');
      return;
    }
    if (snapshot.intent.kind !== 'authenticator') throw Error('Creation target changed');
    if (entry.target?.id === 'p256-webauthn') {
      const expected = entry.allocation.targetAuth, command = snapshot.intent.command;
      if (!expected || command.targetModule.id !== 'p256-webauthn' || command.target.module !== 'p256-webauthn' ||
          command.chainId !== entry.allocation.chainId || getAddress(command.accountAddress) !== getAddress(entry.allocation.account.address) ||
          getAddress(command.target.validator) !== getAddress(expected.validator) || getAddress(command.targetModule.address) !== getAddress(expected.validator) ||
          command.target.data.toLowerCase() !== expected.data.toLowerCase() || command.targetModule.data?.toLowerCase() !== expected.data.toLowerCase())
        throw Error('Creation target changed');
      return;
    }
    if (entry.target?.id !== 'ecdsa' || !entry.target.config || snapshot.intent.command.targetModule.id !== 'ecdsa') throw Error('Creation target changed');
    const requested = entry.target.config, command = snapshot.intent.command, module = command.targetModule;
    if (module.id !== 'ecdsa') throw Error('Creation target changed');
    const actual = module.config;
    const expected = buildECDSAAuthenticator({ chainId: entry.allocation.chainId, config: { owners: [...requested.owners], threshold: requested.threshold } });
    if (actual.threshold !== requested.threshold || actual.owners.length !== requested.owners.length ||
        actual.owners.some((owner, index) => getAddress(owner) !== getAddress(requested.owners[index]!)) ||
        command.chainId !== entry.allocation.chainId || getAddress(command.accountAddress) !== getAddress(entry.allocation.account.address) ||
        command.target.module !== 'ecdsa' || getAddress(command.target.validator) !== getAddress(expected.auth.validator) ||
        getAddress(command.targetModule.address) !== getAddress(expected.auth.validator) ||
        command.target.data.toLowerCase() !== expected.auth.data.toLowerCase() || command.targetModule.data?.toLowerCase() !== expected.auth.data.toLowerCase()) throw Error('Creation target changed');
  }
  private async prepareNext(entry: Pending) {
    if (!entry.allocation || !(entry.target?.id === 'p256-webauthn' || entry.target?.id === 'ecdsa' && entry.target.config) || entry.stages >= 3) throw Error('Creation stages unavailable');
    this.check(entry);
    const operation = await this.options.host().prepareSmartAccountCreationOperation(entry.allocation, this.handoff(entry), () => this.check(entry), this.authentication(entry));
    try {
      this.check(entry);
      await operation.prepare(); this.check(entry);
      const prepared = operation.getSnapshot();
      if (prepared.phase !== 'authorize' && prepared.phase !== 'complete') throw Error('Creation preparation unavailable');
      this.verifyOperation(entry, prepared);
    } catch (error) { await operation.dispose(); throw error; }
    entry.stages++; entry.operation = operation; entry.signingAttempted = false;
    entry.unsubscribe = operation.subscribe(() => {
      if (this.pending.get(entry.id) !== entry || entry.operation !== operation) return;
      if (operation.getSnapshot().transactionHash) entry.broadcast = true;
      this.options.changed();
    });
    this.options.changed();
  }
  private async finishCreation(entry: Pending) {
    this.check(entry);
    const allocation = entry.allocation!;
    let validator: string | undefined;
    if (entry.target?.id === 'p256-webauthn' || entry.target?.id === 'ecdsa' && entry.target.config) {
      const snapshot = entry.operation?.getSnapshot();
      if (!snapshot || snapshot.phase !== 'complete' || snapshot.intent.kind !== 'authenticator' || snapshot.metadataRefresh !== 'complete') return;
      this.verifyOperation(entry, snapshot); validator = snapshot.intent.command.target.validator;
    }
    if (entry.connectionAttempted) throw Error('Creation connection was already attempted');
    entry.connectionAttempted = true;
    await this.options.connect(entry.wire, allocation, entry.lifetime.signal, () => this.check(entry)); this.check(entry);
    entry.responseAttempted = true;
    await this.options.respond(entry.wire, { result: projectSmartAccountPreparationResult(allocation.account.address, allocation.chainId, validator) },
      () => this.check(entry), () => { entry.dispatched = true; });
    await this.retire(entry, false, false);
  }
  private async advance(entry: Pending) {
    if (!(entry.target?.id === 'p256-webauthn' || entry.target?.id === 'ecdsa' && entry.target.config)) { await this.finishCreation(entry); return; }
    for (let stage = 0; stage < 3; stage++) {
      if (!entry.operation) await this.prepareNext(entry);
      const operation = entry.operation!, snapshot = operation.getSnapshot();
      if (snapshot.phase === 'authorize') return;
      if (snapshot.phase !== 'complete') throw Error('Creation operation unavailable');
      if (snapshot.intent.kind === 'authenticator') { await this.finishCreation(entry); return; }
      if (snapshot.intent.kind !== 'deploy' || entry.deploymentSeen) throw Error('Creation operation unavailable');
      entry.deploymentSeen = true; entry.unsubscribe?.(); entry.unsubscribe = undefined;
      entry.operation = undefined; entry.signingAttempted = false; await operation.dispose(); this.check(entry);
    }
    throw Error('Creation stages unavailable');
  }
  approve(id: string, externalOwnersAck: boolean): Promise<void> {
    const entry = this.admitted(id);
    if (entry.busy || typeof externalOwnersAck !== 'boolean' || entry.error && !this.retryable(entry)) return Promise.reject(Error('REQUEST_EXPIRED'));
    entry.busy = true;
    const finish = this.drain.begin();
    let resolve!: () => void, reject!: (error: unknown) => void;
    const work = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; }); entry.work = work;
    void (async () => {
      try {
        entry.error = null; this.options.changed(); this.check(entry);
        const site = await this.options.checkSite(entry.wire.session.binding.origin); this.check(entry);
        if (site.isBlacklisted) { entry.error = 'BLOCKED_SITE'; return; }
        if (!entry.consentAccepted) {
          entry.externalOwners = this.externalOwners(entry.target);
          if (entry.externalOwners.length && !externalOwnersAck) throw Error('External owner acknowledgement is required');
          entry.consentAccepted = true;
        }
        if (!entry.allocation) {
          entry.owner.assertCurrent(); entry.allocating = true;
          try {
            const allocation = await this.options.host().allocateSmartAccount({ networkId: entry.owner.networkId, label: entry.request.label,
              target: entry.target!, externalOwnersAcknowledged: externalOwnersAck }, entry.lifetime.signal, () => this.sessionCurrent(entry), committed => {
                if (entry.allocation && entry.allocation !== committed) throw Error('Creation allocation changed');
                entry.allocation = committed;
              }, this.authentication(entry));
            if (entry.allocation && entry.allocation !== allocation) throw Error('Creation allocation changed');
            entry.allocation = allocation;
          } finally { entry.allocating = false; }
        }
        this.assertAllocation(entry, entry.allocation); this.check(entry);
        if (entry.operation?.getSnapshot().phase === 'failed' && !entry.signingAttempted) {
          const old = entry.operation; entry.unsubscribe?.(); entry.unsubscribe = undefined; entry.operation = undefined; await old.dispose(); this.check(entry);
        }
        if (entry.operation?.getSnapshot().phase === 'authorize') {
          entry.signingAttempted = true;
          await entry.operation.authorize(entry.operation.getSnapshot().revision); this.check(entry);
        }
        await this.advance(entry);
      } catch (error) {
        if (this.pending.get(entry.id) === entry) {
          try { this.check(entry); } catch { await this.retire(entry, false, false); throw error; }
          entry.error = entry.responseAttempted ? 'DELIVERY_UNCERTAIN' : 'PREPARATION_UNAVAILABLE';
        }
        throw error;
      } finally { entry.busy = false; finish(); this.options.changed(); }
    })().then(resolve, reject);
    return work;
  }
  confirmPayer(id: string, payerId: number) {
    const entry = this.admitted(id);
    if (entry.error || !entry.operation || entry.operation.getSnapshot().phase !== 'review-fee') throw Error('REQUEST_EXPIRED');
    entry.operation.confirmPayer(payerId);
  }
  retryMetadata(id: string): Promise<void> {
    const entry = this.admitted(id), operation = entry.operation;
    if (entry.busy || entry.connectionAttempted || entry.responseAttempted || !operation || operation.getSnapshot().phase !== 'complete' || operation.getSnapshot().intent.kind !== 'authenticator') throw Error('REQUEST_EXPIRED');
    entry.busy = true; const finish = this.drain.begin();
    let resolve!: () => void, reject!: (error: unknown) => void;
    const work = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; }); entry.work = work;
    void (async () => {
      try { entry.error = null; this.options.changed(); await operation.retryMetadata(); this.check(entry); await this.finishCreation(entry); }
      catch (error) { if (this.pending.get(id) === entry) entry.error = entry.responseAttempted ? 'DELIVERY_UNCERTAIN' : 'PREPARATION_UNAVAILABLE'; throw error; }
      finally { entry.busy = false; finish(); this.options.changed(); }
    })().then(resolve, reject);
    return work;
  }
  reject(id: string) { const entry = this.pending.get(id); return entry ? this.retire(entry, true) : Promise.resolve(); }
  revalidate() { for (const entry of this.pending.values()) { try { this.check(entry); } catch { void this.retire(entry, false); } } }
  expire(id: number) { for (const entry of this.pending.values()) if (entry.wire.id === id) void this.retire(entry, false); }
  clear() { for (const entry of this.pending.values()) void this.retire(entry, false); }
  dispose() { return this.drain.close(() => { this.closed = true; this.clear(); }, [() => Promise.allSettled([...this.retirements.keys()]).then(() => undefined)]); }
  private retire(entry: Pending, respond: boolean, joinWork = true): Promise<void> {
    if (entry.retiring) return entry.retiring;
    if (this.pending.get(entry.id) !== entry) return Promise.resolve();
    this.pending.delete(entry.id); entry.authenticationScope.retire(); clearTimeout(entry.timer); entry.lifetime.abort(); entry.unsubscribe?.();
    const operation = entry.operation?.dispose();
    const retiring = Promise.allSettled([operation, joinWork ? entry.work : undefined]).then(async () => {
      if (respond && !entry.connectionAttempted && !entry.responseAttempted && !entry.broadcast && !this.closed) await this.options.respond(entry.wire,
        { error: { code: 4001, message: 'User rejected or request expired' } }, entry.owner.assertSessionCurrent, () => { entry.dispatched = true; }).catch(() => undefined);
    }).finally(() => { this.retirements.delete(retiring); this.options.changed(); });
    entry.retiring = retiring; this.retirements.set(retiring, entry.owner.order); this.options.changed(); return retiring;
  }
}
