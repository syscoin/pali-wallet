import type { NativeCustodyAuthority } from './authority.ts';
import { decodeStorageValue } from '../storage/json.ts';
import { WalletStorageError, type OpenWalletStorage, type RecoveryStorageSnapshot, type RecoveryWritePlan } from '../storage/types.ts';
import { sameRecoverySnapshot } from '../storage/recoverySnapshot.ts';
import { inspectRecoveryInventory } from './recoveryInventory.ts';
import { recoveryVerificationRecords, WALLET_CATALOGUE_KEY } from './walletCatalogue.ts';
import { decryptImportedKey } from './importedAccounts.ts';
import { inspectRecoveryJournal } from './transferJournal.ts';
import { getNativeNetwork } from './networkContext.ts';
import { computeAddress } from 'ethers/transaction';
import { getAddress } from 'ethers/address';

type Sdk = typeof import('@sidhujag/sysweb3-keyring/cjs/software.js');
export type RecoveryErrorCode = 'BUSY' | 'NOT_READY' | 'INVALID_INPUT' | 'WRONG_PHRASE' | 'INVALID_SAVED_DATA' | 'AUTH_THROTTLED' | 'CANCELLED' | 'STATE_CHANGED' | 'UNAVAILABLE' | 'REOPEN_REQUIRED';
export class RecoveryError extends Error {
  readonly code: RecoveryErrorCode;
  constructor(code: RecoveryErrorCode) { super(code); this.code = code; this.name = 'RecoveryError'; }
}
declare const proofBrand: unique symbol;
export type RecoveryProof = Readonly<{ [proofBrand]: true }>;
type Ready = { proof: RecoveryProof; storage: OpenWalletStorage; plan: RecoveryWritePlan; before: RecoveryStorageSnapshot; after: RecoveryStorageSnapshot; generation: number; deadline: number; guard: () => void };
type Dependencies = Readonly<{
  owner: Pick<NativeCustodyAuthority, 'getSnapshot' | 'retireForRecovery'>;
  retireControllers(): void;
  ensureCryptoReady(): Promise<void>;
  openStorage(): Promise<OpenWalletStorage>;
  loadSdk?: () => Promise<Sdk>;
  monotonicMilliseconds?: () => number;
}>;
const fail = (code: RecoveryErrorCode): never => { throw new RecoveryError(code); };
const translated = (error: unknown): RecoveryError => error instanceof RecoveryError ? error :
  new RecoveryError(error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED' ? 'AUTH_THROTTLED' :
    error instanceof WalletStorageError && error.code === 'STORAGE_CHANGED' ? 'STATE_CHANGED' :
    error instanceof WalletStorageError && error.code === 'STORAGE_REOPEN_REQUIRED' ? 'REOPEN_REQUIRED' : 'UNAVAILABLE');

/** Backend only. A proof contains no data and is accepted only by its creating instance. */
export class NativeRecoveryCoordinator {
  private generation = 0;
  private pending: Promise<unknown> | null = null;
  private closing: Promise<void> | null = null;
  private ready: Ready | null = null;
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

  private now(): number {
    const value = (this.dependencies.monotonicMilliseconds ?? (() => performance.now()))();
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 600000 || value < this.lastTime) return fail('UNAVAILABLE');
    this.lastTime = value; return value;
  }
  private check(generation: number, deadline: number, guard: () => void): void {
    if (this.disposed || generation !== this.generation || this.now() > deadline) return fail('CANCELLED');
    try {
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

  prepare(phrase: string, password: string, assertCurrent: () => void): Promise<RecoveryProof> {
    if (this.admitting || this.pending || this.ready || this.closing) return Promise.reject(new RecoveryError('BUSY'));
    this.admitting = true;
    const reject = (code: RecoveryErrorCode) => { this.admitting = false; return Promise.reject(new RecoveryError(code)); };
    let ownerRevision: number;
    try {
      const owner = this.dependencies.owner.getSnapshot(); ownerRevision = owner.revision;
      if (this.disposed || this.completed || this.unavailable || (this.retired && this.ownedPair === null) || (!this.retired && owner.phase !== 'locked')) return reject('NOT_READY');
    } catch { return reject('UNAVAILABLE'); }
    if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096 ||
        typeof password !== 'string' || !password.isWellFormed() || password.length > 1024 || new TextEncoder().encode(password).length > 1024 || [...password].length < 12 || typeof assertCurrent !== 'function')
      return reject('INVALID_INPUT');
    const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
    const generation = ++this.generation;
    let deadline: number;
    try { deadline = this.now() + 600000; } catch { return reject('UNAVAILABLE'); }
    const check = () => this.check(generation, deadline, assertCurrent);
    const task = Promise.resolve().then(async () => {
      let storage: OpenWalletStorage | undefined = this.retryStorage ?? undefined;
      this.retryStorage = null; this.clearTimer();
      let retryable = false;
      try {
        check();
        if (!this.retired) {
          const owner = this.dependencies.owner.getSnapshot();
          if (owner.phase !== 'locked' || owner.revision !== ownerRevision) return fail('CANCELLED');
          this.dependencies.retireControllers();
          const fingerprint = await this.dependencies.owner.retireForRecovery();
          this.retired = true;
          if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) return fail('UNAVAILABLE');
          // Bind the original lease even if cancellation occurred while it drained.
          this.ownedPair = fingerprint;
        }
        check(); await this.dependencies.ensureCryptoReady(); check();
        storage ??= await this.dependencies.openStorage(); check();
        const port = storage.recovery;
        if (!port?.prepareReplacement || !port.plannedSnapshot || !port.commitReplacement || !port.recordFailureForPair) return fail('UNAVAILABLE');
        const before = await port.readSnapshot(); check();
        if (this.ownedPair !== before.identity?.pairFingerprint) return fail('STATE_CHANGED');
        if (!before.identity || inspectRecoveryInventory(before).status !== 'needs-matching-phrase-verification') return fail('INVALID_SAVED_DATA');
        await storage.authGuard.checkAllowed(); check();
        const sdk = await (this.dependencies.loadSdk?.() ?? import('@sidhujag/sysweb3-keyring/cjs/software.js')); check();
        const values = new Map<string, unknown>();
        const allowed = (key: string) => { check(); if (!['vault', 'vault-keys'].includes(key)) fail('UNAVAILABLE'); };
        const stageStorage = {
          async get(key: string) { allowed(key); return values.get(key); },
          async set() { return fail('UNAVAILABLE'); }, async deleteItem() { return fail('UNAVAILABLE'); },
          async createManyIfAbsent(items: Record<string, unknown>) {
            check(); if (Object.keys(items).sort().join(',') !== 'vault,vault-keys' || values.size) return fail('UNAVAILABLE');
            for (const [key, value] of Object.entries(items)) { allowed(key); values.set(key, value); }
            return true;
          },
        };
        const keyring = new sdk.SoftwareKeyring(sdk.createSoftwareKeyringHost(stageStorage)); this.stage = keyring;
        const state = { activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
          // The public offline derivation API checks exact nonempty network context; no provider is created.
          activeNetwork: { kind: sdk.INetworkType.Ethereum, chainId: 1, slip44: 60, currency: 'ETH', label: 'Ethereum', url: getNativeNetwork('ethereum').rpcUrl },
          accounts: { HDAccount: {}, Imported: {}, Ledger: {}, Trezor: {}, SmartAccount: {} } };
        keyring.setVaultStateGetter(() => state);
        if (![12, 24].includes(normalized.split(' ').length) || !keyring.isSeedValid(normalized)) return fail('INVALID_INPUT');
        await keyring.initializeSession(normalized, password); check();
        const catalogueValue = before.records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value;
        const records = recoveryVerificationRecords(decodeStorageValue(catalogueValue), before.identity.walletBindingId);
        const first = await keyring.createFirstAccount();
        if (!first || first.id !== 0 || first.isImported || first.isLedgerWallet || first.isTrezorWallet || first.isSmartAccount ||
            typeof first.address !== 'string' || typeof first.xpub !== 'string' ||
            !/^0x(?:(?:02|03)[0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/.test(first.xpub)) return fail('UNAVAILABLE');
        try { if (getAddress(first.address) !== first.address || computeAddress(first.xpub) !== first.address) return fail('UNAVAILABLE'); }
        catch { return fail('UNAVAILABLE'); }
        const expectedRoot = records.hd.find((account) => account.index === 0)!;
        // A definitive wrong root is charged even if its UI request was just cancelled.
        if (first.address !== expectedRoot.address || first.xpub.toLowerCase() !== expectedRoot.publicKey) {
          await port.recordFailureForPair(before.identity.pairFingerprint); check(); return fail('WRONG_PHRASE');
        }
        check();
        const profileId = await keyring.getPrivateRecordProfileId(); check();
        if (typeof profileId !== 'string' || !/^0x[0-9a-f]{64}$/.test(profileId)) return fail('UNAVAILABLE');
        const root = { address: first.address, publicKey: first.xpub.toLowerCase(), profileId };
        if (before.identity.root && JSON.stringify(before.identity.root) !== JSON.stringify(root)) return fail('INVALID_SAVED_DATA');
        const verifiedHd = new Map<number, string>([[0, first.address]]);
        const derive = async (index: number) => {
          if (!verifiedHd.has(index)) {
            const account = await keyring.deriveEvmHdRuntimeAccount({ index }, { assertCurrent: check }); check();
            verifiedHd.set(index, account.address);
            const saved = records.hd.find((item) => item.index === index);
            if (saved && (saved.address !== account.address || saved.publicKey !== account.xpub.toLowerCase())) return fail('INVALID_SAVED_DATA');
          }
          return verifiedHd.get(index)!;
        };
        for (const account of records.hd) { await derive(account.index); check(); }
        const imported = new Map<string, string>();
        for (const account of records.imported) {
          if (account.envelope.profileId !== profileId) return fail('INVALID_SAVED_DATA');
          try { await decryptImportedKey(keyring, before.identity.walletBindingId,
            { id: account.id, index: account.index, address: account.address, publicKey: account.publicKey }, account.envelope, check); check(); }
          catch { check(); return fail('INVALID_SAVED_DATA'); }
          imported.set(account.id, account.address);
        }
        for (const row of before.records.filter((row) => row.key.startsWith('native-evm-transfer-v1'))) {
          const journal = inspectRecoveryJournal(row.key, decodeStorageValue(row.value), before.identity.walletBindingId);
          if (journal.type === 'HDAccount') { if (await derive(journal.index) !== journal.address) return fail('INVALID_SAVED_DATA'); }
          else if (imported.has(journal.id) ? imported.get(journal.id) !== journal.address : journal.pending > 0) return fail('INVALID_SAVED_DATA');
          check();
        }
        if (before.notes.length) {
          // Shared canonical reader authenticates every root/shard and validates all
          // retained notes and inert journals. No status reads, writes or jobs exist here.
          const { readPrivateVaultBundle } = await import('../../../../source/wallet/privateVaultInspection.ts'); check();
          for (const row of before.notes) {
            if (row.walletBindingId !== before.identity.walletBindingId || row.profileId !== profileId) return fail('INVALID_SAVED_DATA');
            try { await readPrivateVaultBundle(JSON.parse(row.value), { keyring, generation, assertCurrent: check }); check(); }
            catch { check(); return fail('INVALID_SAVED_DATA'); }
          }
        }
        const pair = { vault: values.get('vault'), keys: values.get('vault-keys') };
        const plan = await port.prepareReplacement(before, pair, root); check();
        const after = port.plannedSnapshot(plan);
        await keyring.lockWallet(); this.stage = null; values.clear(); check();
        const proof = Object.freeze({}) as RecoveryProof;
        const ready: Ready = { proof, storage, plan, before, after, generation, deadline, guard: assertCurrent };
        const remaining = Math.max(1, deadline - this.now());
        this.ready = ready; this.proofs.set(proof, ready); storage = undefined;
        this.timer = setTimeout(() => { if (this.ready?.generation === generation) this.cancel(); }, remaining);
        return proof;
      } catch (error) {
        const failure = translated(error);
        retryable = ['WRONG_PHRASE', 'AUTH_THROTTLED', 'INVALID_INPUT'].includes(failure.code);
        throw failure;
      }
      finally {
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

  commit(proof: unknown): Promise<'committed-locked'> {
    const ready = proof && typeof proof === 'object' ? this.proofs.get(proof as RecoveryProof) : undefined;
    if (!ready || this.ready !== ready || this.pending) return Promise.reject(new RecoveryError('STATE_CHANGED'));
    this.proofs.delete(ready.proof); this.ready = null; this.clearTimer();
    const check = () => this.check(ready.generation, ready.deadline, ready.guard);
    const task = Promise.resolve().then(async () => {
      let error: unknown, reopened: OpenWalletStorage | undefined, reconciled = false;
      try {
        try { check(); await ready.storage.recovery!.commitReplacement!(ready.plan, check); } catch (cause) { error = cause; }
        await this.close(ready.storage);
        reopened = await this.dependencies.openStorage();
        const actual = await reopened.recovery!.readSnapshot();
        const committed = sameRecoverySnapshot(actual, ready.after), unchanged = sameRecoverySnapshot(actual, ready.before);
        await this.close(reopened); reopened = undefined;
        reconciled = true;
        if (committed) this.completed = true;
        check();
        if (committed) return 'committed-locked' as const;
        if (unchanged) throw error ?? new RecoveryError('UNAVAILABLE');
        return fail(error instanceof WalletStorageError && error.code === 'STORAGE_CHANGED' ? 'STATE_CHANGED' : 'REOPEN_REQUIRED');
      } catch (cause) { throw reconciled || cause instanceof RecoveryError ? translated(cause) : new RecoveryError('REOPEN_REQUIRED'); }
      finally { if (reopened) await this.close(reopened); }
    });
    this.pending = task; void task.finally(() => { if (this.pending === task) this.pending = null; }).catch(() => undefined);
    return task;
  }

  cancel(): void {
    this.generation++; this.clearTimer();
    void this.stage?.lockWallet().catch(() => { this.unavailable = true; });
    const ready = this.ready; this.ready = null;
    const storage = ready?.storage ?? this.retryStorage; this.retryStorage = null;
    if (ready) this.proofs.delete(ready.proof);
    if (storage) {
      const closing = this.close(storage); this.closing = closing;
      void closing.finally(() => { if (this.closing === closing) this.closing = null; }).catch(() => undefined);
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.cancel();
    await this.pending?.catch(() => undefined); await this.closing;
    if (this.unavailable) return fail('REOPEN_REQUIRED');
  }
}
