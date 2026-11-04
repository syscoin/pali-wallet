import { isNativeNewPassword, isNativePasswordInput } from './password.ts';
import type { IKeyringAccountState } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { normalizePublicAddress } from '../core/addresses.ts';
import { RPC_ENDPOINTS } from '../platformRpc.ts';
import { WalletStorageError, type OpenWalletStorage, type WalletIdentityRead } from '../storage/types.ts';
import type { CustodyRuntime, CustodyRuntimeFactory } from './types.ts';
import { CustodyRuntimeError } from './types.ts';
import { type JournalRemovalSnapshot, NativeTransferJournal, TransferJournalError, journalRequiresReopen } from './transferJournal.ts';
import { NativeWalletCatalogue, WalletCatalogueError, MAX_HD_ACCOUNTS, MAX_HD_ACCOUNT_INDEX } from './walletCatalogue.ts';
import { getNativeNetwork, nativeSigningEnabled, type EvmNetworkId } from './networkContext.ts';
import type { NativeAccountRequest, NativeAccountRuntime, NativeNetworkRuntime } from './accounts.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import type { NativeTransferRuntime } from './transfers.ts';
import { assertTransferIntentEnvelope, snapshotErc20TransferIntent } from './transferIntent.ts';
import { snapshotUnsignedTransfer } from './evmFeeContracts.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import { NativeTokenRegistry } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenScope } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenRuntime } from '../portfolio/nativeTokens.ts';
import { NativeActivityHistory } from '../activity/historyStore.ts';
import { createActivityScope, type ActivityScope } from '../activity/types.ts';
import type { NativeActivityRuntime } from '../activity/nativeActivity.ts';
import { computeAddress } from 'ethers/transaction';
import { snapshotHdKeyExportScope, type NativeHdKeyExportRuntime } from './hdKeyExport.ts';
import { parseNativeAccountId, type NativeAccountType } from './accountIdentity.ts';
import { importedKeyIdentity, normalizeImportedKey } from './importedAccounts.ts';
import { importAccountWithRecovery, readImportedRecoverySecret } from '../../../../source/wallet/importedAccountRecovery.ts';
import type { NativeImportRuntime } from './importedAccounts.ts';

type SoftwareSdk = typeof import('@sidhujag/sysweb3-keyring/cjs/software.js');
type IndexedKeyring = InstanceType<SoftwareSdk['SoftwareKeyring']> & {
  deriveEvmHdRuntimeAccount?: (request: { index: number }, options: { assertCurrent(): void }) => Promise<IKeyringAccountState>;
};

export class KeyringRuntimeError extends CustodyRuntimeError {
  constructor(code: KeyringRuntimeError['code']) {
    super(code);
    this.name = 'KeyringRuntimeError';
  }
}

export type KeyringRuntimeDependencies = Readonly<{
  ensureCryptoReady(): Promise<void>;
  openStorage(): Promise<OpenWalletStorage>;
  loadSdk?: () => Promise<SoftwareSdk>;
}>;

/** Internal host capabilities consumed by context-bound controllers, never public DTOs. */
export interface KeyringRuntime extends CustodyRuntime {
  /** Selected HD key only, consumed by the context-bound secret presentation flow. */
  readonly keyExport?: NativeHdKeyExportRuntime;
  readonly activity?: NativeActivityRuntime;
  /** Local public token descriptors only; never exposes the underlying store. */
  readonly tokens?: NativeTokenRuntime;
  /** Native transfer host only; never exposed directly to a screen. */
  readonly transfers?: NativeTransferRuntime;
  /** Public metadata only; no selection/signing authority. Cleared on lock. */
  readonly catalogue: { getSnapshot(): NativeWalletCatalogueSnapshot | null };
  readonly backup: {
    readPhrase(password: string): Promise<readonly string[]>;
    fingerprint(): Promise<string>;
    confirm(fingerprint: string): Promise<void>;
  };
}

function validPassword(password: unknown, creating: boolean): asserts password is string {
  if (
    !(creating ? isNativeNewPassword(password) : isNativePasswordInput(password))
  ) throw new KeyringRuntimeError('INVALID_INPUT');
}

/** A Promise/thenable return cannot satisfy the host's synchronous revocation check. */
function checkGuard(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
    throw new KeyringRuntimeError('CANCELLED');
  }
}

/**
 * Adapt the published software keyring without exposing it, account secrets or
 * storage to a screen. The factory cannot load SDK code before native crypto
 * qualification and cannot silently substitute an in-memory store.
 */
export function createKeyringRuntimeFactory(
  dependencies: KeyringRuntimeDependencies
): CustodyRuntimeFactory {
  return {
    async open(): Promise<KeyringRuntime> {
      await dependencies.ensureCryptoReady();
      const storage = await dependencies.openStorage();
      try {
        const sdk = await (dependencies.loadSdk?.() ?? import('@sidhujag/sysweb3-keyring/cjs/software.js'));
        const host = sdk.createSoftwareKeyringHost(storage.keyringStorage);
        const keyring = new sdk.SoftwareKeyring(host) as IndexedKeyring;
        const state = {
          activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
          activeNetwork: {
            kind: sdk.INetworkType.Ethereum,
            chainId: 1,
            slip44: 60,
            currency: 'ETH',
            label: 'Ethereum',
            url: RPC_ENDPOINTS.ethereum!,
          },
          accounts: {
            HDAccount: {} as Record<number, IKeyringAccountState>,
            Imported: {} as Record<number, IKeyringAccountState>, Ledger: {}, Trezor: {}, SmartAccount: {},
          },
        };
        keyring.setVaultStateGetter(() => state);
        const catalogue = new NativeWalletCatalogue(storage.keyringStorage);
        const tokens = new NativeTokenRegistry(storage.keyringStorage);
        const activityHistory = new NativeActivityHistory(storage.keyringStorage);
        let catalogueSnapshot: NativeWalletCatalogueSnapshot | null = null;
        let generation = 0;
        let closed = false;
        let active: Promise<unknown> | null = null;
        let reserved: object | null = null;
        let closing: Promise<void> | null = null;
        let recoveryRetirement: Promise<string> | null = null;
        let authenticatedPair: string | null = null;
        let verifiedIdentity: WalletIdentityRead | null = null;
        const readIdentity = async (): Promise<WalletIdentityRead> => {
          if (storage.recovery) {
            const identity = await storage.recovery.readIdentity();
            if (!identity) throw new KeyringRuntimeError('NOT_READY');
            return identity;
          }
          const pairFingerprint = await storage.getWalletFingerprint();
          return { walletBindingId: pairFingerprint, pairFingerprint, root: null, verification: 'requires-unlock' };
        };

        const current = (captured: number) => {
          if (closed || captured !== generation) throw new Error('CANCELLED');
          if (catalogue.requiresReopen || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage)) throw new KeyringRuntimeError('CLEANUP_FAILED');
        };
        const lock = (): Promise<void> => {
          generation++;
          // Invoke the SDK now: its secret buffers are retired synchronously.
          const pending = keyring.lockWallet();
          state.accounts.HDAccount = {};
          state.accounts.Imported = {};
          catalogueSnapshot = null;
          authenticatedPair = null; verifiedIdentity = null;
          // Retire secrets synchronously, then report quarantine asynchronously.
          // storage.close() must still install its cleanup promise and drain work.
          return pending.then(() => {
            if (catalogue.requiresReopen || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage)) throw new KeyringRuntimeError('CLEANUP_FAILED');
          });
        };
        const closeRuntime = (capturePair: boolean): Promise<void> => {
          if (closing) return closing;
          let resolveClose!: () => void, rejectClose!: (error: KeyringRuntimeError) => void;
          let pairFingerprint: string | undefined;
          // Install both admissions before lock can invoke any injected callback.
          closing = new Promise<void>((resolve, reject) => { resolveClose = resolve; rejectClose = reject; });
          if (capturePair) recoveryRetirement = closing.then(() => {
            if (!pairFingerprint) throw new KeyringRuntimeError('CLEANUP_FAILED');
            return pairFingerprint;
          });
          closed = true;
          const work = active;
          let revocation: Promise<void>;
          try { revocation = lock(); } catch { revocation = Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED')); }
          void (async () => {
            await Promise.allSettled([work, revocation]);
            let failed = false;
            try { await keyring.lockWallet(); } catch { failed = true; }
            if (capturePair && !failed) {
              try {
                const fingerprint = await storage.getWalletFingerprint();
                if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Invalid retirement');
                pairFingerprint = fingerprint;
              } catch { failed = true; }
            }
            try { await storage.close(); } catch { failed = true; }
            if (failed) throw new KeyringRuntimeError('CLEANUP_FAILED');
          })().then(resolveClose, () => rejectClose(new KeyringRuntimeError('CLEANUP_FAILED')));
          return closing;
        };
        const run = <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          if (closed) return Promise.reject(new Error('CANCELLED'));
          if (catalogue.requiresReopen || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage)) {
            void lock().catch(() => undefined);
            return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
          }
          if (active || reserved) return Promise.reject(new Error('BUSY'));
          const captured = generation;
          // Admit before invoking any injected storage/SDK callback.
          const task = Promise.resolve().then(() => operation(captured));
          const handled = task.catch(async (error: unknown) => {
            const wasCurrent = captured === generation && !closed;
            try { await lock(); }
            catch { closed = true; throw new KeyringRuntimeError('CLEANUP_FAILED'); }
            if (!wasCurrent || closed) throw new KeyringRuntimeError('CANCELLED');
            if (error instanceof KeyringRuntimeError) throw error;
            if (error instanceof TransferJournalError && error.code === 'PENDING_TRANSFER') throw new KeyringRuntimeError('PENDING_TRANSFER');
            if (error instanceof WalletCatalogueError && error.code === 'CATALOGUE_LIMIT') throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (error instanceof WalletCatalogueError && error.code === 'CATALOGUE_NOT_REMOVABLE') throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            if (error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED')
              throw new KeyringRuntimeError('AUTH_THROTTLED');
            throw new KeyringRuntimeError('OPERATION_FAILED');
          }).finally(() => { active = null; });
          active = handled;
          return handled;
        };
        const checkedAccount = (account: IKeyringAccountState, index: number) => {
          if (!account || account.id !== index || account.isImported || account.isLedgerWallet ||
              account.isTrezorWallet || account.isSmartAccount) throw new Error('UNAVAILABLE');
          normalizePublicAddress(account.address, 'ethereum');
          return account;
        };
        const deriveAt = async (index: number, captured: number, assertCurrent: () => void = () => undefined) => {
          current(captured); checkGuard(assertCurrent);
          if (typeof keyring.deriveEvmHdRuntimeAccount !== 'function') throw new KeyringRuntimeError('NOT_READY');
          const account = await keyring.deriveEvmHdRuntimeAccount({ index }, { assertCurrent: () => { current(captured); checkGuard(assertCurrent); } });
          current(captured); checkGuard(assertCurrent);
          return checkedAccount(account, index);
        };
        const checkedImported = (value: IKeyringAccountState, key: string, index: number) => {
          const expected = importedKeyIdentity(key, index);
          if (!value || value.isImported !== true || value.isLedgerWallet || value.isTrezorWallet || value.isSmartAccount ||
              !Number.isSafeInteger(value.id) || value.id < 0 || value.id > MAX_HD_ACCOUNT_INDEX ||
              normalizePublicAddress(value.address, 'ethereum') !== expected.address ||
              typeof value.xpub !== 'string' || !/^0x(?:(?:02|03)[0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/.test(value.xpub) || computeAddress(value.xpub) !== expected.address ||
              typeof value.xprv !== 'string' || value.xprv.length < 32 || value.xprv.length > 1024)
            throw new KeyringRuntimeError('OPERATION_FAILED');
          // Imported EVM scalars have no derivation path. The host owns their durable ordinal.
          return { ...value, id: index, address: expected.address };
        };
        const publishAccounts = (next: NativeWalletCatalogueSnapshot) => {
          state.accounts.HDAccount = Object.fromEntries(next.accounts.filter((a) => a.type === 'HDAccount').map((a) =>
            [a.index, { ...state.accounts.HDAccount[a.index]!, label: a.label }]));
          state.accounts.Imported = Object.fromEntries(next.accounts.filter((a) => a.type === 'Imported').map((a) =>
            [a.index, { ...state.accounts.Imported[a.index]!, label: a.label }]));
          const selected = next.accounts.find((a) => a.id === next.active.accountId)!;
          state.activeAccount = { id: selected.index, type: selected.type === 'HDAccount' ? sdk.KeyringAccountType.HDAccount : sdk.KeyringAccountType.Imported };
          const network = getNativeNetwork(next.active.networkId);
          state.activeNetwork = { ...state.activeNetwork, chainId: Number(network.chainId), slip44: network.slip44,
            url: network.rpcUrl, currency: network.symbol, label: network.id };
          catalogueSnapshot = next;
        };
        const hydrate = async (captured: number) => {
          current(captured);
          verifiedIdentity = null;
          const identity = await readIdentity(); current(captured);
          if (authenticatedPair !== null && authenticatedPair !== identity.pairFingerprint) throw new KeyringRuntimeError('CANCELLED');
          state.accounts.Imported = {};
          const first = checkedAccount(await keyring.createFirstAccount(), 0);
          current(captured);
          if (identity.root) {
            if (first.address !== identity.root.address || first.xpub.toLowerCase() !== identity.root.publicKey ||
                typeof keyring.getPrivateRecordProfileId !== 'function' || await keyring.getPrivateRecordProfileId() !== identity.root.profileId)
              throw new KeyringRuntimeError('OPERATION_FAILED');
            current(captured);
          }
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          current(captured);
          authenticatedPair = identity.pairFingerprint;
          const derived = new Map<number, IKeyringAccountState>([[0, first]]);
          const walletFingerprint = identity.walletBindingId;
          current(captured);
          const nextCatalogue = await catalogue.reconcile({ walletFingerprint, address: first.address, publicKey: first.xpub },
            () => current(captured), async (index) => {
              const account = await deriveAt(index, captured); derived.set(index, account);
              return { address: account.address, publicKey: account.xpub };
            }, async (record) => {
              state.accounts.HDAccount = Object.fromEntries(derived);
              const guard = () => current(captured);
              const { secret: key } = await readImportedRecoverySecret(keyring, record.recovery, { kind: 'ethereum', slip44: 60, id: record.index, address: record.address, xpub: record.publicKey }, guard); guard();
              const imported = checkedImported(await keyring.importAccount(key, record.label), key, record.index); guard();
              state.accounts.Imported[record.index] = imported;
              return { address: imported.address, publicKey: importedKeyIdentity(key, record.index).publicKey };
            });
          current(captured);
          state.accounts.HDAccount = Object.fromEntries(derived);
          for (const account of nextCatalogue.accounts) {
            await new NativeTransferJournal(storage.keyringStorage, { walletFingerprint, address: account.address, chainId: '1' },
              () => current(captured), Date.now, account.index, undefined, undefined, account.type).load();
            current(captured);
          }
          publishAccounts(nextCatalogue);
          verifiedIdentity = identity;
        };
        const selectedAccount = () => {
          if (!catalogueSnapshot || !keyring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
          const catalogue = catalogueSnapshot;
          const selected = catalogue.accounts.find((a) => a.id === catalogue.active.accountId);
          if (!selected || selected.index !== state.activeAccount.id || selected.type !== state.activeAccount.type)
            throw new KeyringRuntimeError('CANCELLED');
          const runtime = state.accounts[selected.type][selected.index];
          if (!runtime || runtime.address !== selected.address || (selected.type === 'Imported') !== runtime.isImported)
            throw new KeyringRuntimeError('CANCELLED');
          return selected;
        };
        const authenticate = async (password: string, captured: number) => {
          validPassword(password, false);
          await storage.authGuard.checkAllowed();
          current(captured);
          const identity = await readIdentity(); current(captured);
          const result = await keyring.unlock(password);
          if (!result || typeof result.canLogin !== 'boolean') throw new Error('UNAVAILABLE');
          if (!result.canLogin) {
            // A definitive rejected credential still counts when lock/background
            // revokes the session while its unabortable KDF is finishing.
            if (storage.recovery?.recordFailureForPair) await storage.recovery.recordFailureForPair(identity.pairFingerprint);
            else await storage.authGuard.recordFailure();
            current(captured);
            return false;
          }
          current(captured);
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          current(captured);
          await storage.authGuard.recordSuccess();
          current(captured);
          authenticatedPair = identity.pairFingerprint; verifiedIdentity = null;
          return true;
        };
        const dataBinding = async (captured: number, guard: () => void = () => undefined): Promise<string> => {
          current(captured); checkGuard(guard);
          const identity = await readIdentity(); current(captured); checkGuard(guard);
          if (!keyring.isUnlocked() || !verifiedIdentity || JSON.stringify(identity) !== JSON.stringify(verifiedIdentity))
            throw new KeyringRuntimeError('CANCELLED');
          return verifiedIdentity.walletBindingId;
        };
        const reserveContext = (input: NativeAccountRequest | { kind: 'select-network'; id: EvmNetworkId }, expectedRevision: number, networkSelection = false) => {
            if (closed || !keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (typeof keyring.deriveEvmHdRuntimeAccount !== 'function' || catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            const request = decodeStorageValue(encodeStorageValue(input)) as NativeAccountRequest | { kind: 'select-network'; id: EvmNetworkId };
            if (!request || typeof request !== 'object' || Array.isArray(request) || (!networkSelection && request.kind === 'select-network')) throw new KeyringRuntimeError('INVALID_INPUT');
            const fields = request.kind === 'create' ? ['kind', 'label', 'password'] : request.kind === 'restore'
              ? ['kind', 'index', 'label', 'password'] : request.kind === 'rename' ? ['kind', 'id', 'label']
              : request.kind === 'remove' ? ['kind', 'id', 'password'] : request.kind === 'select' || request.kind === 'select-network' ? ['kind', 'id'] : [];
            if (!fields.length || Object.keys(request).sort().join(',') !== fields.sort().join(',') ||
                ('id' in request && request.kind !== 'select-network' && (typeof request.id !== 'string' || (() => { try { parseNativeAccountId(request.id); return false; } catch { return true; } })())) ||
                ('index' in request && (!Number.isSafeInteger(request.index) || request.index < 1 || request.index > 4095)) ||
                ('label' in request && (typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label || request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label))))
              throw new KeyringRuntimeError('INVALID_INPUT');
            if ('password' in request) validPassword(request.password, false);
            // Expected eligibility failures leave the current authority/reviews intact.
            if ((request.kind === 'create' || request.kind === 'restore') && catalogueSnapshot.accounts.length >= MAX_HD_ACCOUNTS)
              throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (request.kind === 'create' && catalogue.nextIndex > MAX_HD_ACCOUNT_INDEX && !catalogueSnapshot.removed.length)
              throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (request.kind === 'restore' && !catalogueSnapshot.removed.some((account) => account.index === request.index))
              throw new KeyringRuntimeError('INVALID_INPUT');
            if (request.kind === 'select-network') getNativeNetwork(request.id);
            if ('id' in request && request.kind !== 'select-network') {
              const target = catalogueSnapshot.accounts.find((account) => account.id === request.id);
              if (!target) throw new KeyringRuntimeError('INVALID_INPUT');
              if (request.kind === 'remove' && ((target.type === 'HDAccount' && target.index === 0) || target.id === catalogueSnapshot.active.accountId || catalogueSnapshot.accounts.length <= 1))
                throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            }
            const token = {};
            reserved = token;
            const generationAtAdmission = ++generation;
            let used = false;
            return {
              cancel() { if (!used && reserved === token) reserved = null; used = true; },
              execute(assertCurrent: () => void) {
                if (used || reserved !== token || generationAtAdmission !== generation) {
                  if (reserved === token) reserved = null;
                  return Promise.reject(new KeyringRuntimeError('CANCELLED'));
                }
                used = true; reserved = null;
                return run(async (captured) => {
                  current(captured); checkGuard(assertCurrent);
                  if ('password' in request) {
                    if (!await authenticate(request.password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                    current(captured); checkGuard(assertCurrent);
                    await hydrate(captured);
                    current(captured); checkGuard(assertCurrent);
                  }
                  const before = catalogueSnapshot;
                  if (!before || before.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
                  let derived: IKeyringAccountState | undefined;
                  let mutation;
                  if (request.kind === 'create' || request.kind === 'restore') {
                    if (request.kind === 'create') {
                      // Use the extension's SDK allocator, which fills gaps in live HD accounts.
                      const created = await keyring.addNewAccount(request.label);
                      current(captured); checkGuard(assertCurrent);
                      if (!created || !Number.isSafeInteger(created.id) || created.id < 1 || created.id > MAX_HD_ACCOUNT_INDEX ||
                          before.accounts.some((account) => account.type === 'HDAccount' && account.index === created.id))
                        throw new KeyringRuntimeError('CANCELLED');
                      derived = checkedAccount(created, created.id);
                    } else {
                      derived = await deriveAt(request.index, captured, assertCurrent);
                    }
                    current(captured); checkGuard(assertCurrent);
                    mutation = { kind: request.kind, index: derived.id, address: derived.address, publicKey: derived.xpub, label: request.label } as const;
                  } else {
                    mutation = request.kind === 'remove' ? { kind: 'remove' as const, id: request.id, journal: null as JournalRemovalSnapshot | null } : request;
                    if (request.kind === 'remove') {
                      const account = before.accounts.find((a) => a.id === request.id);
                      if (!account) throw new KeyringRuntimeError('CANCELLED');
                      const fingerprint = await dataBinding(captured, assertCurrent);
                      current(captured); checkGuard(assertCurrent);
                      const journal = new NativeTransferJournal(storage.keyringStorage, { walletFingerprint: fingerprint, address: account.address, chainId: '1' }, () => { current(captured); checkGuard(assertCurrent); }, Date.now, account.index, undefined, (record, guard) => activityHistory.archiveTerminal(record, guard), account.type);
                      const pending = await journal.removalSnapshot();
                      current(captured); checkGuard(assertCurrent);
                      mutation = { kind: 'remove' as const, id: request.id, journal: pending };
                    }
                  }
                  const next = await catalogue.mutate(expectedRevision, mutation, () => { current(captured); checkGuard(assertCurrent); });
                  current(captured); checkGuard(assertCurrent);
                  if (derived) state.accounts.HDAccount[derived.id] = derived;
                  publishAccounts(next);
                });
              },
            };
        };
        const imports: NativeImportRuntime = {
          reserve(input, password, expectedRevision) {
            if (closed || !keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            let request: typeof input;
            try {
              request = decodeStorageValue(encodeStorageValue(input)) as typeof input;
              if (!request || typeof request !== 'object' || Array.isArray(request) ||
                  Object.keys(request).sort().join(',') !== 'expectedAddress,label,privateKey' ||
                  typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label ||
                  request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label)) throw new Error('INVALID_INPUT');
              const key = normalizeImportedKey(request.privateKey);
              const identity = importedKeyIdentity(key, 0);
              if (request.expectedAddress !== identity.address) throw new Error('INVALID_INPUT');
              request = Object.freeze({ ...request, privateKey: key });
              validPassword(password, false);
            } catch { throw new KeyringRuntimeError('INVALID_INPUT'); }
            if (catalogueSnapshot.accounts.length >= MAX_HD_ACCOUNTS)
              throw new KeyringRuntimeError('ACCOUNT_LIMIT');
            if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
              throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
            const token = {}; reserved = token; const generationAtAdmission = ++generation; let used = false;
            return {
              cancel() { if (!used && reserved === token) reserved = null; used = true; },
              execute(assertCurrent) {
                if (used || reserved !== token || generationAtAdmission !== generation) {
                  if (reserved === token) reserved = null;
                  return Promise.reject(new KeyringRuntimeError('CANCELLED'));
                }
                used = true; reserved = null;
                return run(async (captured) => {
                  const guard = () => { current(captured); checkGuard(assertCurrent); current(captured); };
                  guard();
                  if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                  guard(); await hydrate(captured); guard();
                  if (!catalogueSnapshot || catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
                  if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
                    throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
                  const prepared = await importAccountWithRecovery(keyring, { secret: request.privateKey, label: request.label,
                    network: { kind: 'ethereum', slip44: 60 } }, guard); guard();
                  const index = prepared.account.id;
                  const imported = checkedImported(prepared.account, request.privateKey, index);
                  const next = await catalogue.mutate(expectedRevision, { kind: 'import', index, address: imported.address,
                    publicKey: prepared.recovery.identity.xpub, label: request.label, recovery: prepared.recovery }, guard); guard();
                  state.accounts.Imported[index] = imported;
                  publishAccounts(next);
                });
              },
            };
          },
        };
        const accounts: NativeAccountRuntime = {
          supported: () => typeof keyring.deriveEvmHdRuntimeAccount === 'function',
          getSnapshot: () => closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked() ? null : catalogueSnapshot,
          reserve: (input, expectedRevision) => reserveContext(input, expectedRevision),
        };
        const networks: NativeNetworkRuntime = {
          getSelectedId: () => closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked() ? null : catalogueSnapshot?.active.networkId ?? null,
          reserve: (id, expectedRevision) => {
            if (typeof id !== 'string') throw new KeyringRuntimeError('INVALID_INPUT');
            const network = getNativeNetwork(id);
            return reserveContext({ kind: 'select-network', id: network.id }, expectedRevision, true);
          },
        };
        const canSign = () => !!catalogueSnapshot && nativeSigningEnabled(catalogueSnapshot.active.networkId);
        const activityContext = async (assertCurrent: () => void): Promise<{ scope: ActivityScope; guard: () => void; index: number; type: NativeAccountType }> => {
          const captured = generation;
          const guard = () => { current(captured); checkGuard(assertCurrent); if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY'); };
          guard();
          const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
          const networkId = catalogueSnapshot!.active.networkId;
          const fingerprint = await dataBinding(captured, guard); guard();
          return { scope: createActivityScope(fingerprint, selected.id, selected.address, networkId), guard, index: selected.index, type: selected.type };
        };
        const checkActivityContext = async (scope: ActivityScope, assertCurrent: () => void) => {
          const context = await activityContext(assertCurrent);
          if (context.scope.key !== scope.key || context.scope.sourceId !== scope.sourceId) throw new KeyringRuntimeError('CANCELLED');
          return context;
        };
        const tokenOperation = <T>(assertCurrent: () => void, action: (scope: NativeTokenScope, guard: () => void) => Promise<T>): Promise<T> => {
          if (active || reserved) return Promise.reject(new KeyringRuntimeError('BUSY'));
          const captured = generation;
          const check = () => {
            current(captured); checkGuard(assertCurrent);
            if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
          };
          try { check(); } catch (error) { return Promise.reject(error); }
          // Reserve before any await so account/network/authentication cannot race admission.
          const task = Promise.resolve().then(async () => {
            check();
            const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
            const network = getNativeNetwork(catalogueSnapshot!.active.networkId);
            const walletFingerprint = await dataBinding(captured, check); check();
            const result = await action(Object.freeze({ walletFingerprint, accountId: selected.id, address: selected.address,
              network: network.id, chainId: network.chainId, registrationHash: network.registrationHash }), check);
            check(); return result;
          }).catch(async (error: unknown) => {
            if (tokens.requiresReopen) {
              try { await lock(); } catch { /* Quarantine remains visible to authority cleanup. */ }
              throw new KeyringRuntimeError('CLEANUP_FAILED');
            }
            throw error;
          }).finally(() => { if (active === task) active = null; });
          active = task;
          return task;
        };
        return {
          accounts,
          imports,
          networks,
          tokens: {
            load: async (guard) => {
              // Connection replay may retire a read while its storage call is draining.
              // Wait for that reservation, then validate the new caller before reading.
              while (active) { await active.catch(() => undefined); checkGuard(guard); }
              return tokenOperation(guard, (scope, check) => tokens.load(scope, check));
            },
            add: (revision, metadata, guard) => tokenOperation(guard, (scope, check) => tokens.add(scope, revision, metadata, check)),
            remove: (revision, contract, guard) => tokenOperation(guard, (scope, check) => tokens.remove(scope, revision, contract, check)),
          },
          catalogue: { getSnapshot: () => closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked() ? null : catalogueSnapshot },
          keyExport: {
            readSelected: (input, password, assertCurrent) => {
              let scope;
              try {
                scope = snapshotHdKeyExportScope(input);
                if (typeof assertCurrent !== 'function') throw new KeyringRuntimeError('INVALID_INPUT');
              } catch { return Promise.reject(new KeyringRuntimeError('INVALID_INPUT')); }
              return run(async (captured) => {
                const check = () => {
                  current(captured); checkGuard(assertCurrent);
                  current(captured);
                  const catalogue = catalogueSnapshot;
                  const selected = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId);
                  if (!keyring.isUnlocked() || !catalogue || !selected) throw new KeyringRuntimeError('NOT_READY');
                  if (catalogue.revision !== scope.catalogueRevision || selected.type !== parseNativeAccountId(scope.accountId).type ||
                      selected.slip44 !== 60 || selected.id !== scope.accountId || selected.index !== scope.index ||
                      selected.address !== scope.address || catalogue.active.networkId !== scope.networkId ||
                      getNativeNetwork(catalogue.active.networkId).registrationHash !== scope.registrationHash ||
                      state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type)
                    throw new KeyringRuntimeError('CANCELLED');
                };
                check();
                const stored = await storage.readState(); check();
                if (stored.presence !== 'existing' || stored.backup !== 'confirmed') throw new KeyringRuntimeError('NOT_READY');
                if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                check();
                await hydrate(captured); check();
                // The SDK selector is fixed here; no account type or alternate index comes from a screen.
                const privateKey = await keyring.getPrivateKeyByAccountId(scope.index, parseNativeAccountId(scope.accountId).type === 'HDAccount' ? sdk.KeyringAccountType.HDAccount : sdk.KeyringAccountType.Imported, password);
                check();
                if (typeof privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(privateKey) ||
                    BigInt(privateKey) === 0n || BigInt(privateKey) >= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n ||
                    computeAddress(privateKey) !== scope.address) throw new KeyringRuntimeError('OPERATION_FAILED');
                check();
                return privateKey.toLowerCase();
              });
            },
          },
          session: {
            createWallet: (password) => run(async (captured) => {
              validPassword(password, true);
              current(captured);
              const phrase = keyring.createNewSeed(12);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              await keyring.initializeSession(phrase, password);
              current(captured);
              await hydrate(captured);
            }),
            importWallet: (phrase, password) => run(async (captured) => {
              validPassword(password, true);
              if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096) throw new KeyringRuntimeError('INVALID_INPUT');
              const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
              if (![12, 24].includes(normalized.split(' ').length) || !keyring.isSeedValid(normalized)) throw new KeyringRuntimeError('INVALID_INPUT');
              current(captured);
              await keyring.initializeSession(normalized, password);
              current(captured);
              await hydrate(captured);
            }),
            unlock: (password) => run(async (captured) => {
              const authenticated = await authenticate(password, captured);
              if (authenticated) await hydrate(captured);
              return { authenticated };
            }),
            async readEthereumAddress() {
              if (closed || tokens.requiresReopen || journalRequiresReopen(storage.keyringStorage) || !keyring.isUnlocked()) throw new Error('NOT_READY');
              return normalizePublicAddress(selectedAccount().address, 'ethereum');
            },
            lock,
          },
          activity: {
            async load(assertCurrent) {
              const { scope, guard, index, type } = await activityContext(assertCurrent);
              const journal = new NativeTransferJournal(storage.keyringStorage, { walletFingerprint: scope.walletFingerprint, address: scope.address, chainId: scope.network.chainId }, guard, Date.now, index, scope.network, (record, check) => activityHistory.archiveTerminal(record, check), type);
              const local = await journal.activity(); guard();
              const saved = await activityHistory.load(scope, guard); guard();
              return { scope, local, saved };
            },
            async saveCache(scope, candidates, assertCurrent) {
              const { guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveCache(scope, candidates, guard);
            },
            async saveView(scope, view, assertCurrent) {
              const { guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveView(scope, view, guard);
            },
          },
          transfers: {
            async token(contractAddress, assertCurrent) {
              const contract = normalizeErc20Address(contractAddress);
              while (active) { await active.catch(() => undefined); checkGuard(assertCurrent); }
              return tokenOperation(assertCurrent, async (scope, check) => {
                const inventory = await tokens.load(scope, check);
                check();
                const token = inventory.items.find((item) => item.contractAddress === contract);
                if (!token) throw new KeyringRuntimeError('NOT_READY');
                return token;
              });
            },
            async journal(assertCurrent) {
              if (closed || !keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              if (!canSign()) throw new KeyringRuntimeError('NOT_READY');
              const captured = generation;
              current(captured); checkGuard(assertCurrent);
              if (!keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              const selected = selectedAccount();
              const fingerprint = await dataBinding(captured, assertCurrent);
              current(captured); checkGuard(assertCurrent);
              const address = normalizePublicAddress(selected.address, 'ethereum');
              const network = getNativeNetwork(catalogueSnapshot!.active.networkId);
              return new NativeTransferJournal(storage.keyringStorage, { walletFingerprint: fingerprint, address, chainId: network.chainId }, () => { current(captured); checkGuard(assertCurrent); }, Date.now, selected.index, network, (record, guard) => activityHistory.archiveTerminal(record, guard), selected.type);
            },
            authorize: (password, assertCurrent) => {
              if (closed || !keyring.isUnlocked()) return Promise.reject(new KeyringRuntimeError('CANCELLED'));
              if (!canSign()) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              return run(async (captured) => {
              if (!keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              checkGuard(assertCurrent);
              if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              current(captured); checkGuard(assertCurrent);
              await hydrate(captured);
              current(captured); checkGuard(assertCurrent);
            }); },
            sign: (transaction, password, assertCurrent, inputIntent) => {
              if (closed || !keyring.isUnlocked()) return Promise.reject(new KeyringRuntimeError('CANCELLED'));
              if (!canSign()) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              let intent;
              try {
                intent = inputIntent === undefined ? undefined : snapshotErc20TransferIntent(inputIntent);
                assertTransferIntentEnvelope(transaction, intent);
                if (transaction.chainId !== getNativeNetwork(catalogueSnapshot!.active.networkId).chainId)
                  throw new KeyringRuntimeError('INVALID_INPUT');
                if (catalogueSnapshot!.active.networkId === 'zksys-testnet')
                  snapshotUnsignedTransfer(transaction as Parameters<typeof snapshotUnsignedTransfer>[0], getNativeNetwork('zksys-testnet'));
              } catch { return Promise.reject(new KeyringRuntimeError('INVALID_INPUT')); }
              return run(async (captured) => {
              if (!keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              checkGuard(assertCurrent);
              if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              current(captured); checkGuard(assertCurrent);
              await hydrate(captured);
              current(captured); checkGuard(assertCurrent);
              assertTransferIntentEnvelope(transaction, intent);
              const network = getNativeNetwork(catalogueSnapshot!.active.networkId);
              if (!nativeSigningEnabled(network.id) || transaction.chainId !== network.chainId)
                throw new KeyringRuntimeError('INVALID_INPUT');
              if (network.id === 'zksys-testnet')
                snapshotUnsignedTransfer(transaction as Parameters<typeof snapshotUnsignedTransfer>[0], network);
              const signed = keyring.signPreparedEvmTransaction({
                account: { id: selectedAccount().index, type: selectedAccount().type, expectedAddress: transaction.from },
                network: { kind: 'ethereum', chainId: network.chainId, slip44: 60, url: network.rpcUrl },
                transaction,
              }, { assertCurrent: () => { current(captured); checkGuard(assertCurrent); } });
              current(captured); checkGuard(assertCurrent);
              return Object.freeze({ rawTransaction: signed.rawTransaction, hash: signed.hash });
            }); },
          },
          storage: {
            readState: () => storage.readState(),
            retireForRecovery() {
              if (recoveryRetirement) return recoveryRetirement;
              if (closing) return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
              closeRuntime(true);
              return recoveryRetirement!;
            },
            close: () => closeRuntime(false),
          },
          backup: {
            readPhrase: (password) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              await hydrate(captured); current(captured);
              const phrase = await keyring.getSeed(password);
              current(captured);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              return Object.freeze(phrase.split(' '));
            }),
            fingerprint: () => storage.getWalletFingerprint(),
            confirm: (fingerprint) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              current(captured);
              await storage.confirmBackup(fingerprint);
              current(captured);
            }),
          },
        };
      } catch {
        try { await storage.close(); } catch { /* the factory remains unavailable */ }
        throw new Error('UNAVAILABLE');
      }
    },
  };
}
