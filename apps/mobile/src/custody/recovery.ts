import { captureSLHDSAEncryptedStateEnvelope, createSlhDsaStateStore, parseSLHDSAStateStorageKey } from '../../../../source/wallet/slhDsaState.ts';
import { createSlhDsaProfileStateCrypto } from '../../../../source/wallet/slhDsaStateCrypto.ts';
import { getSLHDSAKeyId } from '../../../../source/utils/slhDsa/constants.ts';
import { normalizeSLHDSAPublicKeyField } from '../../../../source/utils/slhDsa/hex.ts';
import { decodeStorageValue } from '../storage/json.ts';
import { decodeAccountRecord } from '../storage/accountRecordKey.ts';
import { createNativeCredentialVault, settleNativeCredentialRemoval, snapshotAfterNativeCredentialCleanup, type NativeCredentialPort, type NativeCredentialReference } from './credentialVault.ts';
import { createNativePublicSessionRecord, type NativePublicSessionRecord } from './publicSession.ts';
import { readNativeSlhPublicStates } from '../smartAccount/slhDsaRuntime.ts';
import type { NativeCustodyAuthority } from './authority.ts';
import { WalletStorageError, type OpenWalletStorage, type RecoveryStorageSnapshot, type RecoveryWritePlan, type RecoveryRoot } from '../storage/types.ts';
import { sameRecoverySnapshot } from '../storage/recoverySnapshot.ts';
import { isOperationAuthenticationCancellation } from '../core/operationAuthentication.ts';
import { readSentrySlot, sentrySlotNetwork } from '../storage/sentryKeyDomain.ts';
import { inspectRecoveryInventory } from './recoveryInventory.ts';
import { recoveryVerificationRecords,
  replaceRecoveredAccountRecords,
  sentryRootPublicIdentity,
  WALLET_CATALOGUE_KEY,
  type NativeAccountRecord } from './walletCatalogue.ts';
import { stageAccountRecovery, type StagedAccountRecovery } from '../../../../source/wallet/accountRecovery.ts';
import { createPrivateVaultSession } from '../../../../source/wallet/privateVaultInspection.ts';
import { createSentryKeyVault, sentryKeyVaultStorageKey } from '../../../../source/wallet/sentryKeyVault.ts';
import { UTXO_SIGNED_RECORD_KEY } from '../../../../source/wallet/utxoSignedBundle.ts';

type Sdk = typeof import('@sidhujag/sysweb3-keyring/cjs/software.js');
export type RecoveryErrorCode = 'BUSY' | 'NOT_READY' | 'INVALID_INPUT' | 'WRONG_PHRASE' | 'INVALID_SAVED_DATA' | 'AUTH_THROTTLED' | 'CANCELLED' | 'STATE_CHANGED' | 'UNAVAILABLE' | 'REOPEN_REQUIRED';
export class RecoveryError extends Error {
  readonly code: RecoveryErrorCode;
  constructor(code: RecoveryErrorCode) { super(code); this.code = code; this.name = 'RecoveryError'; }
}
declare const proofBrand: unique symbol;
export type RecoveryProof = Readonly<{ [proofBrand]: true }>;
type Ready = { lifetime: AbortController; proof: RecoveryProof; storage: OpenWalletStorage; plan: RecoveryWritePlan | null; before: RecoveryStorageSnapshot; after: RecoveryStorageSnapshot | null; generation: number; deadline: number; guard: () => void; secret: string; publicKey: Uint8Array; stagedCredential: NativeCredentialReference | null; candidate: (StagedAccountRecovery['pair'] & { accountRecords: NativeAccountRecord; publicSession: NativePublicSessionRecord }) | null; root: RecoveryRoot; fingerprint: string };
type Dependencies = Readonly<{
  credentialPort: NativeCredentialPort | null;
  isAuthenticationActive(owner: AbortSignal): boolean;
  owner: Pick<NativeCustodyAuthority, 'getSnapshot' | 'retireForRecovery'>;
  retireControllers(): Promise<void>;
  ensureCryptoReady(): Promise<void>;
  openStorage(): Promise<OpenWalletStorage>;
  loadSdk?: () => Promise<Sdk>;
  monotonicMilliseconds?: () => number;
  assertActive?: () => void;
}>;
const fail = (code: RecoveryErrorCode): never => { throw new RecoveryError(code); };
const translated = (error: unknown): RecoveryError => error instanceof RecoveryError ? error :
  new RecoveryError(error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED' ? 'AUTH_THROTTLED' :
    error instanceof WalletStorageError && error.code === 'STORAGE_CHANGED' ? 'STATE_CHANGED' :
    error instanceof WalletStorageError && error.code === 'STORAGE_REOPEN_REQUIRED' ? 'REOPEN_REQUIRED'
          : error instanceof Error &&
            error.message === 'WALLET_RECOVERY_PHRASE_INVALID'
          ? 'INVALID_INPUT'
          : error instanceof Error &&
            [
              'WALLET_RECOVERY_DATA_INVALID',
              'IMPORTED_RECOVERY_INVALID',
            ].includes(error.message)
          ? 'INVALID_SAVED_DATA'
          : 'UNAVAILABLE');

// Prove that the phrase decrypts each envelope and matches its authenticated
// summary. Public-key derivation remains the import executor's responsibility.
async function authenticateSentryBuckets(
  records: RecoveryStorageSnapshot['records'],
  catalogue: NativeAccountRecord,
  phrase: string,
  check: () => void
): Promise<void> {
  for (const { key, value } of records) {
    const network = sentrySlotNetwork(key);
    if (!network) continue;
    check();
    const bucket = readSentrySlot(value, network);
    const storageKey = sentryKeyVaultStorageKey(bucket.vaultId, network);
    const vault = createSentryKeyVault({
      crypto: () => globalThis.crypto,
      async read(requested) {
        check();
        if (requested !== storageKey) return fail('INVALID_SAVED_DATA');
        return bucket;
      },
      async write() { return fail('INVALID_SAVED_DATA'); },
    });
    const vaultId = await vault.getSentryVaultId(sentryRootPublicIdentity(catalogue, network));
    check();
    if (vaultId !== bucket.vaultId) return fail('INVALID_SAVED_DATA');
    for (const { summary } of bucket.keys) {
      await vault.loadSentryKey({ vaultId, network, id: summary.id, seed: phrase, assertCurrent: check });
      check();
    }
  }
}

/** Backend only. A proof contains no data and is accepted only by its creating instance. */
export class NativeRecoveryCoordinator {
  private generation = 0;
  private pending: Promise<unknown> | null = null;
  private closing: Promise<void> | null = null;
  private ready: Ready | null = null;
  private authenticating: Ready | null = null;
  private retryStorage: OpenWalletStorage | null = null;
  private readonly proofs = new WeakMap<RecoveryProof, Ready>();
  private stage: InstanceType<Sdk['SoftwareKeyring']> | null = null;
  private retired = false;
  private completed = false;
  private disposed = false;
  private unavailable = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastTime = -Infinity;
  private admitting = false;
  private ownedPair: string | null = null;
  private readonly dependencies: Dependencies;
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }

  isAuthenticating(): boolean {
    const ready = this.authenticating;
    if (!ready || this.disposed || ready.lifetime.signal.aborted || ready.generation !== this.generation || this.ready !== ready) return false;
    try { return this.now() < ready.deadline && this.dependencies.isAuthenticationActive(ready.lifetime.signal) === true; }
    catch { return false; }
  }

  private now(): number {
    const value = (this.dependencies.monotonicMilliseconds ?? (() => performance.now()))();
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 600000 || value < this.lastTime) return fail('UNAVAILABLE');
    this.lastTime = value; return value;
  }
  private check(generation: number, deadline: number, guard: () => void): void {
    if (this.disposed || generation !== this.generation || this.now() > deadline) return fail('CANCELLED');
    try {
      const active: unknown = this.dependencies.assertActive?.();
      if (active !== undefined) { if (active && (typeof active === 'object' || typeof active === 'function')) void Promise.resolve(active).catch(() => undefined); return fail('CANCELLED'); }
      const result: unknown = guard();
      if (result !== undefined) {
        if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
        return fail('CANCELLED');
      }
    } catch { return fail('CANCELLED'); }
    // The caller's synchronous guard may itself cancel or dispose this flow.
    const afterGuard = this.now();
    if (this.disposed || generation !== this.generation || afterGuard > deadline) return fail('CANCELLED');
  }
  private async close(storage: OpenWalletStorage): Promise<void> {
    try { await storage.close(); } catch { this.unavailable = true; return fail('REOPEN_REQUIRED'); }
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  prepare(phrase: string, assertCurrent: () => void): Promise<RecoveryProof> {
    if (this.admitting || this.pending || this.ready || this.closing) return Promise.reject(new RecoveryError('BUSY'));
    this.admitting = true;
    const reject = (code: RecoveryErrorCode) => { this.admitting = false; return Promise.reject(new RecoveryError(code)); };
    let ownerRevision: number;
    try {
      const owner = this.dependencies.owner.getSnapshot(); ownerRevision = owner.revision;
      if (this.disposed || this.completed || this.unavailable || (this.retired && this.ownedPair === null) || (!this.retired && !['locked', 'ready'].includes(owner.phase))) return reject('NOT_READY');
    } catch { return reject('UNAVAILABLE'); }
    if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096 ||
        typeof assertCurrent !== 'function')
      return reject('INVALID_INPUT');
    const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
    const generation = ++this.generation;
    let deadline: number;
    try { deadline = this.now() + 600000; } catch { return reject('UNAVAILABLE'); }
    const check = () => this.check(generation, deadline, assertCurrent);
    const task = Promise.resolve().then(async () => {
      let storage: OpenWalletStorage | undefined = this.retryStorage ?? undefined;
      let publicKey: Uint8Array | undefined;
      this.retryStorage = null; this.clearTimer();
      let retryable = false;
      try {
        check();
        if (!this.retired) {
          const owner = this.dependencies.owner.getSnapshot();
          if (!['locked', 'ready'].includes(owner.phase) || owner.revision !== ownerRevision) return fail('CANCELLED');
          await this.dependencies.retireControllers();
          const fingerprint = await this.dependencies.owner.retireForRecovery();
          this.retired = true;
          if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) return fail('UNAVAILABLE');
          // Bind the original lease even if cancellation occurred while it drained.
          this.ownedPair = fingerprint;
        }
        check(); await this.dependencies.ensureCryptoReady(); check();
        storage ??= await this.dependencies.openStorage(); check();
        await settleNativeCredentialRemoval(storage, this.dependencies.credentialPort); check();
        const port = storage.recovery;
        if (!port?.prepareReplacement || !port.plannedSnapshot || !port.commitReplacement || !port.recordFailureForPair || !port.fingerprintPair || !this.dependencies.credentialPort) return fail('UNAVAILABLE');
        const credentialVault = createNativeCredentialVault(storage.credential, this.dependencies.credentialPort);
        const secret = credentialVault.createSecret();
        publicKey = credentialVault.createPublicKey();
        const before = await port.readSnapshot(); check();
        if (this.ownedPair !== before.identity?.pairFingerprint) return fail('STATE_CHANGED');
        if (!before.identity || inspectRecoveryInventory(before).status !== 'needs-matching-phrase-verification') return fail('INVALID_SAVED_DATA');
        await storage.authGuard.checkAllowed(); check();
        const sdk = await (this.dependencies.loadSdk?.() ?? import('@sidhujag/sysweb3-keyring/cjs/software.js')); check();
        const catalogueValue = before.records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value;
        const records = recoveryVerificationRecords(decodeAccountRecord(catalogueValue), before.identity.walletBindingId);
        const expectedRoot = records.groups.find((group) => group.activeNetwork.slip44 === 60
        )!.accounts.HDAccount[0]!;
        let publicSession: NativePublicSessionRecord | undefined;
        const staged = await stageAccountRecovery(
          {
            groups: records.groups,
            imported: records.recovery,
            phrase: normalized,
            password: secret,
          },
          {
            assertCurrent: check,
            fingerprintPair: pair => port.fingerprintPair!(pair),
            loadSdk: async () => sdk,
            captureSession: (keyring) => {
              this.stage = keyring;
              return () => {
                if (this.stage === keyring) this.stage = null;
              };
            },
            verifyRoot: async (actual) => {
              if (
                actual.address !== expectedRoot.address ||
                actual.publicKey !== expectedRoot.xpub.toLowerCase()
              ) {
          await port.recordFailureForPair!(before.identity!.pairFingerprint); check(); return fail('WRONG_PHRASE');
        }
              if (before.identity!.root && JSON.stringify(before.identity!.root) !== JSON.stringify(actual)) return fail('INVALID_SAVED_DATA');
          },
            validateRetained: async ({ keyring, profileId, staged }) => {
              try { await authenticateSentryBuckets(before.records, records, normalized, check); }
              catch { check(); return fail('INVALID_SAVED_DATA'); }
              for (const row of before.records) {
                const keyId = parseSLHDSAStateStorageKey(row.key);
                if (keyId === null) continue;
                const envelope = captureSLHDSAEncryptedStateEnvelope(decodeStorageValue(row.value), keyId);
                const store = createSlhDsaStateStore({
                  async read(key) { check(); if (key !== row.key) return fail('INVALID_SAVED_DATA'); return { present: true, value: envelope }; },
                  async mutate() { return fail('INVALID_SAVED_DATA'); },
                });
                try {
                  const state = await store.load({ keyId, crypto: createSlhDsaProfileStateCrypto(keyring, check), assertOwner: check });
                  check();
                  if (!state || getSLHDSAKeyId({ pkRoot: normalizeSLHDSAPublicKeyField(state.pkRoot), pkSeed: normalizeSLHDSAPublicKeyField(state.pkSeed) }) !== keyId)
                    return fail('INVALID_SAVED_DATA');
                } catch { check(); return fail('INVALID_SAVED_DATA'); }
              }
              const utxo = before.records.find(({ key }) => key === UTXO_SIGNED_RECORD_KEY);
              if (utxo) {
                const captured = utxo.value;
                const { UtxoSignedRecords } = await import('../../../../source/wallet/utxoSignedRecords.ts'); check();
                const snapshot = {
                  read: async (profile: string) => profile === profileId ? captured : fail('INVALID_SAVED_DATA'),
                  compareAndSet: async () => fail('INVALID_SAVED_DATA'),
                };
                const reader = new UtxoSignedRecords(snapshot, snapshot);
                try { await reader.validate({ keyring, assertCurrent: check }); check(); }
                catch { check(); return fail('INVALID_SAVED_DATA'); }
              }
              if (before.signedRecords.length) {
                const row = before.signedRecords[0]!;
                if (before.signedRecords.length !== 1 || row.profileId !== profileId ||
                    row.walletBindingId !== before.identity!.walletBindingId) return fail('INVALID_SAVED_DATA');
                const captured = row.value;
                const { EvmSignedRecords } = await import(
                  '../../../../source/wallet/evmSignedRecords.ts'
                );
                check();
                const snapshot = {
                  read: async (profile: string) => { check(); return profile === profileId ? captured : fail('INVALID_SAVED_DATA'); },
                  compareAndSet: async () => fail('INVALID_SAVED_DATA'),
                };
                try { await new EvmSignedRecords(snapshot).validate({ keyring, assertCurrent: check }); check(); }
                catch { check(); return fail('INVALID_SAVED_DATA'); }
              }
        if (before.notes.length) {
                const { readPrivateVaultBundle } = await import('../../../../source/wallet/privateVaultInspection.ts'); check();
          for (const row of before.notes) {
            if (row.walletBindingId !== before.identity!.walletBindingId || row.profileId !== profileId) return fail('INVALID_SAVED_DATA');
            try { await readPrivateVaultBundle(JSON.parse(row.value), createPrivateVaultSession({ keyring, generation, assertCurrent: check })); check(); }
            catch { check(); return fail('INVALID_SAVED_DATA'); }
          }
        }
              const nextRecords = replaceRecoveredAccountRecords(decodeAccountRecord(catalogueValue), before.identity!.walletBindingId, staged.groups);
              const pairFingerprint = await port.fingerprintPair!(staged.pair); check();
              const publicStates = await readNativeSlhPublicStates(before.records.filter(row => parseSLHDSAStateStorageKey(row.key) !== null)
                .map(row => ({ key: row.key, value: decodeStorageValue(row.value) })), keyring, check);
              publicSession = await createNativePublicSessionRecord(keyring, nextRecords, {
                ...before.identity!, pairFingerprint, root: { address: expectedRoot.address, publicKey: expectedRoot.xpub.toLowerCase(), profileId },
              }, publicStates, publicKey!, check);
              check();
            },
          }
        );
        check();
        const root = {
          address: expectedRoot.address,
          publicKey: expectedRoot.xpub.toLowerCase(),
          profileId: staged.profileId,
        };
        const accountRecords = replaceRecoveredAccountRecords(
          decodeAccountRecord(catalogueValue),
          before.identity.walletBindingId,
          staged.groups
        );
        const fingerprint = await port.fingerprintPair(staged.pair); check();
        if (!publicSession) return fail('INVALID_SAVED_DATA');
        const proof = Object.freeze({}) as RecoveryProof;
        const ready: Ready = { lifetime: new AbortController(), proof, storage, plan: null, before, after: null, generation, deadline, guard: assertCurrent,
          secret, publicKey, stagedCredential: null, candidate: { ...staged.pair, accountRecords, publicSession }, root, fingerprint };
        const remaining = Math.max(1, deadline - this.now());
        this.ready = ready; this.proofs.set(proof, ready); storage = undefined;
        publicKey = undefined;
        this.timer = setTimeout(() => { if (this.ready?.generation === generation) this.cancel(); }, remaining);
        return proof;
      } catch (error) {
        const failure = translated(error);
        retryable = ['WRONG_PHRASE', 'AUTH_THROTTLED', 'INVALID_INPUT'].includes(failure.code);
        throw failure;
      }
      finally {
        publicKey?.fill(0);
        const stage = this.stage; this.stage = null;
        if (stage) await stage.lockWallet().catch(() => { this.unavailable = true; });
        if (storage && retryable && !this.unavailable) {
          const held = storage;
          try {
            check();
            // Keep this connection's monotonic cooldown. Reopening would start
            // the full persisted delay again, regardless of elapsed wall time.
            const timer = setTimeout(() => { if (this.retryStorage === held) this.cancel(); }, Math.max(1, deadline - this.now()));
            this.retryStorage = held; this.timer = timer; storage = undefined;
          } catch (error) {
            await this.close(held); storage = undefined;
            throw translated(error);
          }
        }
        if (storage) await this.close(storage);
        if (this.unavailable) fail('REOPEN_REQUIRED');
      }
    });
    this.pending = task; this.admitting = false;
    void task.finally(() => { if (this.pending === task) this.pending = null; }).catch(() => undefined);
    return task;
  }

  /** The matching phrase and retained wallet are verified before OS credential replacement. */
  private stageCredential(proof: unknown): Promise<void> {
    const ready = proof && typeof proof === 'object' ? this.proofs.get(proof as RecoveryProof) : undefined;
    if (!ready || this.ready !== ready || this.pending || ready.plan || !ready.candidate || !ready.secret)
      return Promise.reject(new RecoveryError('STATE_CHANGED'));
    const check = () => this.check(ready.generation, ready.deadline, ready.guard);
    const task = Promise.resolve().then(async () => {
      check();
      const credentialVault = createNativeCredentialVault(ready.storage.credential, this.dependencies.credentialPort!);
      let plan: RecoveryWritePlan | undefined;
      try {
        const reference = credentialVault.createReference({ walletBindingId: ready.before.identity!.walletBindingId, pairFingerprint: ready.fingerprint });
        ready.stagedCredential = reference;
        plan = await ready.storage.recovery!.prepareReplacement!(ready.before, { ...ready.candidate!, credential: reference }, ready.root, check);
        check();
        this.authenticating = ready;
        try { await credentialVault.stage(reference, ready.secret, ready.publicKey, { signal: ready.lifetime.signal, assertCurrent: check, purpose: 'account-change' }); }
        finally { if (this.authenticating === ready) this.authenticating = null; }
        check();
        if (!plan) return fail('REOPEN_REQUIRED');
        ready.after = ready.storage.recovery!.plannedSnapshot!(plan);
        ready.plan = plan;
        ready.secret = '';
        ready.publicKey.fill(0);
        ready.candidate = null;
      } catch (error) {
        let changed = false;
        try {
          await ready.storage.credential.settleCredentialRemoval(async record => {
            if (!ready.stagedCredential || JSON.stringify(record) !== JSON.stringify(ready.stagedCredential)) return fail('REOPEN_REQUIRED');
            await this.dependencies.credentialPort!.remove(record);
          });
          ready.stagedCredential = null;
          if (this.ready === ready) {
            const refreshed = await ready.storage.recovery!.readSnapshot();
            changed = !sameRecoverySnapshot(refreshed, ready.before);
            if (!changed) ready.before = refreshed;
          }
        } catch { this.unavailable = true; return fail('REOPEN_REQUIRED'); }
        if (changed) { this.cancel(); return fail('STATE_CHANGED'); }
        if (isOperationAuthenticationCancellation(error)) {
          check();
          if (this.ready !== ready || ready.plan || ready.stagedCredential || !ready.candidate || !ready.secret) return fail('CANCELLED');
        }
        throw error;
      }
    });
    this.pending = task;
    void task.finally(() => { if (this.pending === task) this.pending = null; }).catch(() => undefined);
    return task;
  }

  async commit(proof: unknown): Promise<'committed-locked'> {
    const staged = proof && typeof proof === 'object' ? this.proofs.get(proof as RecoveryProof) : undefined;
    if (staged && !staged.plan) await this.stageCredential(proof);
    const ready = proof && typeof proof === 'object' ? this.proofs.get(proof as RecoveryProof) : undefined;
    if (!ready || this.ready !== ready || this.pending || !ready.plan || !ready.after) return Promise.reject(new RecoveryError('STATE_CHANGED'));
    this.proofs.delete(ready.proof); this.ready = null; this.clearTimer();
    const check = () => this.check(ready.generation, ready.deadline, ready.guard);
    const task = Promise.resolve().then(async () => {
      let error: unknown, reopened: OpenWalletStorage | undefined, reconciled = false;
      try {
        try { check(); await ready.storage.recovery!.commitReplacement!(ready.plan, check); } catch (cause) { error = cause; }
        await this.close(ready.storage);
        reopened = await this.dependencies.openStorage();
        await settleNativeCredentialRemoval(reopened, this.dependencies.credentialPort);
        const actual = await reopened.recovery!.readSnapshot();
        const committed = sameRecoverySnapshot(actual, snapshotAfterNativeCredentialCleanup(ready.after!)), unchanged = sameRecoverySnapshot(actual, ready.before);
        await this.close(reopened); reopened = undefined;
        reconciled = true;
        if (committed) this.completed = true;
        check();
        if (committed) return 'committed-locked' as const;
        if (unchanged) throw error ?? new RecoveryError('UNAVAILABLE');
        return fail(error instanceof WalletStorageError && error.code === 'STORAGE_CHANGED' ? 'STATE_CHANGED' : 'REOPEN_REQUIRED');
      } catch (cause) { throw reconciled || cause instanceof RecoveryError ? translated(cause) : new RecoveryError('REOPEN_REQUIRED'); }
      finally { ready.lifetime.abort(); if (reopened) await this.close(reopened); }
    });
    this.pending = task; void task.finally(() => { if (this.pending === task) this.pending = null; }).catch(() => undefined);
    return task;
  }

  cancel(): void {
    this.generation++; this.clearTimer();
    void this.stage?.lockWallet().catch(() => { this.unavailable = true; });
    const ready = this.ready; this.ready = null;
    const storage = ready?.storage ?? this.retryStorage; this.retryStorage = null;
    if (ready) { ready.lifetime.abort(); this.proofs.delete(ready.proof); ready.secret = ''; ready.publicKey.fill(0); ready.candidate = null; }
    if (storage) {
      const closing = Promise.resolve(this.pending).catch(() => undefined).then(async () => {
        try { if (ready?.stagedCredential) await storage.credential.settleCredentialRemoval(async record => {
          if (JSON.stringify(record) !== JSON.stringify(ready.stagedCredential)) return fail('REOPEN_REQUIRED');
          await this.dependencies.credentialPort!.remove(record);
        }); }
        finally { await this.close(storage); }
      }).catch(() => { this.unavailable = true; return fail('REOPEN_REQUIRED'); });
      this.closing = closing;
      void closing.finally(() => { if (this.closing === closing) this.closing = null; }).catch(() => undefined);
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.cancel();
    await this.pending?.catch(() => undefined); await this.closing;
    if (this.unavailable) return fail('REOPEN_REQUIRED');
  }
}
