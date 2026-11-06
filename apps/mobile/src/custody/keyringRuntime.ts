import type { EvmObservationRequest, EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import type { NativeNetworkRegistration } from './networkContext.ts';
import { sameRecoverySnapshot } from '../storage/recoverySnapshot.ts';
import { EvmSignedRecords, createEvmSignedRecordLifecycle, type EvmVerifiedReplacementBinding } from '../../../../source/wallet/evmSignedRecords.ts';
import { UTXO_SIGNED_RECORD_KEY } from '../../../../source/wallet/utxoSignedBundle.ts';
import { EvmSignedReplay, observeRetainedEvmTransaction } from '../../../../source/wallet/evmSignedReplay.ts';
import { assertNativeRecordDomains } from './recoveryInventory.ts';
import { createNativeSignedRecordView } from './sharedSignedRecords.ts';
import type { EvmSubmissionContext } from '@sidhujag/sysweb3-keyring';
import { isNativeNewPassword, isNativePasswordInput } from './password.ts';
import type { IKeyringAccountState, INetwork as SdkNetwork } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { normalizePublicAddress } from '../core/addresses.ts';
import { canonicalUtxoEndpoint, findUtxoNetwork, getUtxoSdkNetwork, isCustomUtxoNetworkId, projectUtxoRegistration, supportsUtxoSoftwareCustody, utxoRegistrationData, type UtxoNetwork, type UtxoNetworkId } from '../core/utxoNetworks.ts';
import { exactUtxoResponseFetch, verifyUtxoRegistration } from '../core/utxoReadSession.ts';
import type { UtxoActivityContext, UtxoActivitySource } from '../core/utxoActivity.ts';
import type { UtxoBalance } from '../core/utxoBalanceReader.ts';
import { findWifAddressType, normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { parseUtxoPublicIdentifier, type UtxoPublicIdentifier } from '../core/utxoIdentifier.ts';
import { WalletStorageError, type OpenWalletStorage, type RecoveryStorageSnapshot, type WalletIdentityRead } from '../storage/types.ts';
import type { CustodyRuntime, CustodyRuntimeFactory } from './types.ts';
import { CustodyRuntimeError } from './types.ts';
import { TransferJournalError } from './transferJournal.ts';
import { NativeWalletCatalogue, WalletCatalogueError,
  catalogueAccountGroup,
  catalogueEvmNetworks,
  catalogueUtxoNetworks,
  createNativeAccountRecord,
  recoveryVerificationRecords,
  WALLET_CATALOGUE_KEY,
} from './walletCatalogue.ts';
import { getNativeNetwork, snapshotNativeNetwork, nativeSigningEnabled } from './networkContext.ts';
import type { NativeAccountRequest, NativeAccountRuntime, NativeNetworkRuntime } from './accounts.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
import { NativeTransferError, type NativeReplacementApproval, type NativeTransferRuntime } from './transfers.ts';
import { assertTransferIntentEnvelope, equalTransferIntent, snapshotErc20TransferIntent, snapshotNativeAssetTransferIntent, type NativeAssetTransferIntent } from './transferIntent.ts';
import { assertSpeedUpEnvelope } from './transferRpc.ts';
import { snapshotCancellationTransfer, snapshotNftQuoteEnvelope, snapshotUnsignedTransfer, unsignedTransferBytes } from './evmFeeContracts.ts';
import { normalizeErc20Address } from '../portfolio/erc20Metadata.ts';
import { NativeTokenRegistry, snapshotSavedCollectible } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenInventory, NativeTokenScope, SavedCollectible } from '../portfolio/tokenRegistry.ts';
import type { NativeTokenRuntime } from '../portfolio/nativeTokens.ts';
import { NativeActivityHistory } from '../activity/historyStore.ts';
import { createActivityScope, type ActivityScope, type EvmActivityReadScope } from '../activity/types.ts';
import type { NativeActivityRuntime } from '../activity/nativeActivity.ts';
import { computeAddress, Transaction } from 'ethers/transaction';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { keyExportRegistrationHash, snapshotHdKeyExportScope, type NativeHdKeyExportRuntime } from './hdKeyExport.ts';
import { parseNativeAccountId, type NativeAccountType } from './accountIdentity.ts';
import { importedKeyIdentity, isUtxoAccountPrivateKey, isUtxoWifText, normalizeImportedKey, normalizeUtxoImport } from './importedAccounts.ts';
import { importAccountWithRecovery } from '../../../../source/wallet/importedAccountRecovery.ts';
import type { NativeImportRuntime } from './importedAccounts.ts';
import { stageInitialWallet, type RecoveryAccountGroup } from '../../../../source/wallet/accountRecovery.ts';
import type { IPrivateVaultSession } from '../../../../source/wallet/privateVault.ts';
import type { NativeNoteBackupRuntime, NativeNoteCapacityRuntime, NativeNoteInventory } from './noteBackupRuntime.ts';
import type { NativeUtxoSend } from './utxoSend.ts';

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
  assertActive?: () => void;
  readUtxoBalance?: (network: UtxoNetwork, address: string, signal: AbortSignal, guard: () => void) => Promise<UtxoBalance>;
  readUtxoAccount?: (network: UtxoNetwork, xpub: string, signal: AbortSignal, guard: () => void) => Promise<UtxoBalance>;
  utxoFetch?: typeof globalThis.fetch;
  observeActivity?: (network: NativeNetworkRegistration, expected: EvmObservationRequest, signal: AbortSignal, guard: () => void) => Promise<EvmTransactionObservation>;
}>;

/** Internal host capabilities consumed by context-bound controllers, never public DTOs. */
export interface KeyringRuntime extends CustodyRuntime {
  readonly readUtxoBalance?: (id: UtxoNetworkId, address: string, signal: AbortSignal) => Promise<UtxoBalance>;
  /** Owns the private Blockbook identifier; a screen receives only projected rows. */
  withUtxoActivityRead<T>(
    expected: UtxoActivityContext,
    signal: AbortSignal,
    assertOwner: () => void,
    assertView: () => void,
    read: (source: UtxoActivitySource & { readonly readSentry?: never }, signal: AbortSignal, check: () => void) => Promise<T>,
  ): Promise<T>;
  /** Selected software key only, consumed by the context-bound secret presentation flow. */
  readonly keyExport?: NativeHdKeyExportRuntime;
  readonly activity?: NativeActivityRuntime;
  /** Local public token descriptors only; never exposes the underlying store. */
  readonly tokens?: NativeTokenRuntime & {
    addCollectible(revision: number, collectible: SavedCollectible, guard: () => void): Promise<NativeTokenInventory>;
    removeCollectible(revision: number, collectible: SavedCollectible, guard: () => void): Promise<NativeTokenInventory>;
  };
  /** Native transfer host only; never exposed directly to a screen. */
  readonly transfers?: NativeTransferRuntime;
  openUtxoSend?(assertCurrent: () => void): Promise<NativeUtxoSend>;
  /** Trusted note file adapter only. Never part of a public wallet snapshot. */
  openNoteBackup?(assertCurrent: () => void): Promise<NativeNoteBackupRuntime>;
  openNoteCapacity?(assertCurrent: () => void): Promise<NativeNoteCapacityRuntime>;
  readNoteInventory?(assertCurrent: () => void): Promise<NativeNoteInventory>;
  /** Internal removal authorization. The protected snapshot never reaches a screen. */
  authorizeWalletRemoval?(password: string, assertCurrent: () => void): Promise<Readonly<{
    snapshot: RecoveryStorageSnapshot;
    assertCurrent(): void;
  }>>;
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
        if (typeof sdk.captureEvmSubmission !== 'function' || typeof sdk.submitSignedEvmTransaction !== 'function') throw new Error('Shared EVM submission SDK is required');
        const host = sdk.createKeyringHost(storage.keyringStorage);
        const initialEvmNetwork = getNativeNetwork('ethereum');
        const sdkEvmNetwork = (network: NativeNetworkRegistration): SdkNetwork => ({
          kind: sdk.INetworkType.Ethereum, chainId: Number(network.chainId), slip44: network.slip44,
          url: network.rpcUrl, currency: network.symbol, label: network.name,
        });
        const initialState = () => ({
          activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
          activeNetwork: sdkEvmNetwork(initialEvmNetwork),
          accounts: {
            HDAccount: {} as Record<number, IKeyringAccountState>,
            Imported: {} as Record<number, IKeyringAccountState>, Ledger: {}, Trezor: {}, SmartAccount: {},
          },
        });
        type State = ReturnType<typeof initialState>;
        const openKeyring = (scope: State) => {
          const instance = new sdk.SoftwareKeyring(host, { captureEvmSubmission: null }) as IndexedKeyring;
          instance.setVaultStateGetter(() => scope);
          return instance;
        };
        let state = initialState();
        let keyring = openKeyring(state);
        const catalogue = new NativeWalletCatalogue(storage.keyringStorage);
        const tokens = new NativeTokenRegistry(storage.keyringStorage);
        const activityHistory = new NativeActivityHistory(storage.keyringStorage);
        const signedRecords = new EvmSignedRecords(storage.signedRecords, Date.now, () => { void lock().catch(() => undefined); });
        const utxoRecords = storage.utxoSignedRecords && new (await import('../../../../source/wallet/utxoSignedRecords.ts')).UtxoSignedRecords(
          storage.utxoSignedRecords, storage.utxoSignedRecords,
          () => { void lock().catch(() => undefined); }
        );
        let catalogueSnapshot: NativeWalletCatalogueSnapshot | null = null;
        let generation = 0;
        let collectibleLifetime: AbortController | undefined;
        const retireCollectibleLifetime = () => {
          const previous = collectibleLifetime;
          collectibleLifetime = undefined;
          previous?.abort();
        };
        let pendingBalance: AbortController | null = null;
        let pendingRegistration: AbortController | null = null;
        let utxoSend: NativeUtxoSend | undefined;
        type NoteRuntime = ReturnType<typeof import('./noteBackupRuntime.ts').createNativeNoteBackupRuntime>;
        let noteBackups: NoteRuntime | undefined;
        let noteStorageFault: 'unreported' | 'reopen' | undefined;
        const requireNoteReopen = () => { noteStorageFault ??= 'unreported'; };
        const requiresReopen = () => catalogue.requiresReopen || tokens.requiresReopen || signedRecords.requiresReopen || utxoRecords?.requiresReopen === true || noteStorageFault === 'reopen';
        const revokeGeneration = () => {
          const next = ++generation;
          retireCollectibleLifetime();
          noteBackups?.invalidate();
          pendingBalance?.abort();
          pendingRegistration?.abort();
          utxoSend?.cancel(); utxoSend = undefined;
          return next;
        };
        let closed = false;
        let active: Promise<unknown> | null = null;
        const pendingSubmissions = new Set<Promise<unknown>>();
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
          if (dependencies.assertActive) { try { checkGuard(dependencies.assertActive); } catch { throw new KeyringRuntimeError('CANCELLED'); } }
          if (requiresReopen()) throw new KeyringRuntimeError('CLEANUP_FAILED');
        };
        const lock = (): Promise<void> => {
          generation++;
          // Invoke the SDK now: its secret buffers are retired synchronously.
          const pending = keyring.lockWallet();
          state.accounts = initialState().accounts;
          catalogueSnapshot = null;
          authenticatedPair = null; verifiedIdentity = null;
          retireCollectibleLifetime();
          noteBackups?.invalidate();
          pendingBalance?.abort();
          pendingRegistration?.abort();
          utxoSend?.cancel(); utxoSend = undefined;
          // Retire secrets synchronously, then report quarantine asynchronously.
          // storage.close() must still install its cleanup promise and drain work.
          return pending.then(() => {
            if (requiresReopen()) throw new KeyringRuntimeError('CLEANUP_FAILED');
          });
        };
        const closeRuntime = (capturePair: boolean, beforeClose?: () => Promise<void>): Promise<void> => {
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
          noteBackups?.dispose();
          void (async () => {
            const [, revoked] = await Promise.allSettled([work, revocation, ...pendingSubmissions]);
            let failed = false;
            try { await keyring.lockWallet(); } catch { failed = true; }
            if (capturePair && !failed) {
              try {
                const fingerprint = await storage.getWalletFingerprint();
                if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Invalid retirement');
                pairFingerprint = fingerprint;
              } catch { failed = true; }
            }
            if (beforeClose && !failed) {
              if (revoked?.status !== 'fulfilled' || requiresReopen()) failed = true;
              else { try { await beforeClose(); } catch { failed = true; } }
            }
            try { await storage.close(); } catch { failed = true; }
            if (failed) throw new KeyringRuntimeError('CLEANUP_FAILED');
          })().then(resolveClose, () => rejectClose(new KeyringRuntimeError('CLEANUP_FAILED')));
          return closing;
        };
        const run = <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          if (closed) return Promise.reject(new Error('CANCELLED'));
          if (requiresReopen()) {
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
        const checkedAccount = (account: IKeyringAccountState, index: number, networkId: string, utxos: readonly UtxoNetwork[]) => {
          if (!account || account.id !== index || account.isImported || account.isLedgerWallet ||
              account.isTrezorWallet || account.isSmartAccount) throw new Error('UNAVAILABLE');
          normalizePublicAddress(account.address, networkId, utxos);
          return account;
        };
        const checkedImported = (value: IKeyringAccountState, key: string, index: number) => {
          const expected = importedKeyIdentity(key, index);
          if (!value || value.isImported !== true || value.isLedgerWallet || value.isTrezorWallet || value.isSmartAccount ||
              !Number.isSafeInteger(value.id) || value.id < 0 ||
              normalizePublicAddress(value.address, 'ethereum') !== expected.address ||
              typeof value.xpub !== 'string' || !/^0x(?:(?:02|03)[0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/.test(value.xpub) || computeAddress(value.xpub) !== expected.address ||
              typeof value.xprv !== 'string' || value.xprv.length < 32 || value.xprv.length > 1024)
            throw new KeyringRuntimeError('OPERATION_FAILED');
          // Imported EVM scalars have no derivation path. The host owns their durable ordinal.
          return { ...value, id: index, address: expected.address };
        };
        const checkedUtxoImport = (account: IKeyringAccountState, network: UtxoNetwork, expectedKind?: UtxoPublicIdentifier['kind']) => {
          if (!account || account.isImported !== true || account.isLedgerWallet ||
              account.isTrezorWallet || account.isSmartAccount ||
              !Number.isSafeInteger(account.id) || account.id < 0 ||
              typeof account.xprv !== 'string' || account.xprv.length < 32 || account.xprv.length > 1024)
            throw new KeyringRuntimeError('OPERATION_FAILED');
          const publicKey = parseUtxoPublicIdentifier(account.xpub, network);
          if (publicKey.identifier !== account.xpub || publicKey.address !== account.address ||
              (publicKey.kind === 'account' && account.xpub.includes('(')) ||
              (expectedKind !== undefined && publicKey.kind !== expectedKind))
            throw new KeyringRuntimeError('OPERATION_FAILED');
          return account;
        };
        const stateFor = (records: typeof catalogue.privateRecords, networkId = records.active.networkId): State => {
          const next = initialState();
          const utxo = findUtxoNetwork(networkId, catalogueUtxoNetworks(records.networks));
          const group = catalogueAccountGroup(records, networkId);
          if (group) next.accounts = group.accounts as State['accounts'];
          const selection = networkId === records.active.networkId
            ? parseNativeAccountId(records.active.accountId)
            : group?.activeAccount;
          if (selection) next.activeAccount = {
            id: 'index' in selection ? selection.index : selection.id,
            type: selection.type === 'Imported' ? sdk.KeyringAccountType.Imported : sdk.KeyringAccountType.HDAccount,
          };
          if (utxo) next.activeNetwork = getUtxoSdkNetwork(utxo) as SdkNetwork;
          else next.activeNetwork = sdkEvmNetwork(getNativeNetwork(networkId, catalogueEvmNetworks(records)));
          return next;
        };
        const publishAccounts = (next: NativeWalletCatalogueSnapshot) => {
          const changed = catalogueSnapshot !== next;
          Object.assign(state, stateFor(catalogue.privateRecords));
          catalogueSnapshot = next;
          if (changed) retireCollectibleLifetime();
        };
        // Transfer only inside an admitted mutation. No await separates the
        // ownership move from publishing the private instance used by lock().
        const switchAccountGroup = async (networkId: string, guard: () => void): Promise<RecoveryAccountGroup | undefined> => {
          const records = catalogue.privateRecords;
          const next = stateFor(records, networkId);
          if (next.activeNetwork.slip44 === state.activeNetwork.slip44) return;
          const source = keyring;
          const target = openKeyring(next);
          try {
            guard();
            source.transferSessionTo(target);
            keyring = target;
            state = next;
            if (catalogueAccountGroup(records, networkId)) return;
            const created = await target.createFirstAccount();
            guard();
            const account = checkedAccount(created, 0, networkId, catalogueUtxoNetworks(records.networks));
            return {
              key: String(next.activeNetwork.slip44),
              activeNetwork: next.activeNetwork as RecoveryAccountGroup['activeNetwork'],
              activeAccount: next.activeAccount as RecoveryAccountGroup['activeAccount'],
              accounts: { ...next.accounts, HDAccount: { 0: account } } as RecoveryAccountGroup['accounts'],
            };
          } finally {
            await (keyring === target ? source : target).destroy();
          }
        };
        function captureSignedSubmission(context: EvmSubmissionContext, externalGuard: () => void,
          metadata?: Readonly<Record<string, unknown>>, replacement?: EvmVerifiedReplacementBinding) {
          const captured = generation;
          const check = () => {
            current(captured); checkGuard(externalGuard);
            const selected = selectedAccount();
            const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
            if (selected.index !== context.account.id || selected.type !== context.account.type ||
                selected.address.toLowerCase() !== context.account.address.toLowerCase() ||
                context.network.chainId !== Number(network.chainId) || context.network.url !== network.rpcUrl)
              throw new KeyringRuntimeError('CANCELLED');
          };
          check();
          const requiresReplacement = context.operation === 'cancel' || context.operation === 'speed-up';
          if (requiresReplacement !== (replacement !== undefined)) throw new NativeTransferError('EXPIRED');
          return createEvmSignedRecordLifecycle(signedRecords, { keyring, assertCurrent: check }, { metadata, replacement });
        }
        function snapshotReviewedTransfer(transaction: Parameters<NativeTransferRuntime['sign']>[0],
          intent: NativeAssetTransferIntent | undefined, replacement?: NativeReplacementApproval) {
          const selected = selectedAccount();
          const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
          if (intent?.kind === 'nft-transfer' && replacement) throw new KeyringRuntimeError('INVALID_INPUT');
          const prepared = replacement?.mode === 'cancel'
            ? snapshotCancellationTransfer(transaction, network, selected.address, replacement.feePlan)
            : intent?.kind === 'nft-transfer'
              ? snapshotNftQuoteEnvelope(transaction, network, intent)
              : snapshotUnsignedTransfer(transaction, network);
          assertTransferIntentEnvelope(prepared, intent);
          if (prepared.from.toLowerCase() !== selected.address.toLowerCase()) throw new KeyringRuntimeError('INVALID_INPUT');
          if (replacement) {
            const { original, mode } = replacement;
            if ((mode === 'cancel' && intent) || !/^0x[0-9a-f]{64}$/.test(original.hash) ||
                replacement.binding.originalHash !== original.hash ||
                original.from.toLowerCase() !== selected.address.toLowerCase() ||
                String(original.nonce) !== prepared.nonce || original.type !== prepared.type ||
                original.registrationHash !== network.registrationHash)
              throw new KeyringRuntimeError('INVALID_INPUT');
            if (mode === 'speed-up') assertSpeedUpEnvelope(original, prepared);
          }
          return prepared;
        }
        const signedView = (captured: number, externalGuard: () => void, walletBindingId: string, account = selectedAccount()) => {
          const check = () => { current(captured); checkGuard(externalGuard); };
          const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
          return createNativeSignedRecordView(signedRecords,{keyring,assertCurrent:check},walletBindingId,account,network);
        };
        const hydrate = async (captured: number) => {
          current(captured);
          verifiedIdentity = null;
          const identity = await readIdentity(); current(captured);
          const admitted = await storage.recovery!.readSnapshot(); current(captured);
          assertNativeRecordDomains(admitted.records);
          if (
            !identity.root ||
            (authenticatedPair !== null && authenticatedPair !== identity.pairFingerprint)
          )
            throw new KeyringRuntimeError('CANCELLED');
          const profileId = await keyring.getPrivateRecordProfileId(); current(captured);
            if (profileId !== identity.root.profileId) throw new KeyringRuntimeError('OPERATION_FAILED');
          const next = await catalogue.reconcile(
            {
              walletFingerprint: identity.walletBindingId,
              address: identity.root.address, publicKey: identity.root.publicKey,
            }, () => current(captured));
            current(captured);
          if (
            catalogue.privateRecords.recovery.some(
              (entry) => entry.envelope.profileId !== profileId
            )
          )
            throw new KeyringRuntimeError('OPERATION_FAILED');
          publishAccounts(next);
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          current(captured);
          await signedRecords.validate({keyring,assertCurrent:()=>current(captured)}); current(captured);
          if (admitted.records.some(({ key }) => key === UTXO_SIGNED_RECORD_KEY)) {
            if (!utxoRecords) throw new KeyringRuntimeError('OPERATION_FAILED');
            await utxoRecords.validate({ keyring, assertCurrent: () => current(captured) }); current(captured);
          }
          authenticatedPair = identity.pairFingerprint;
          verifiedIdentity = identity;
        };
        const createStoredWallet = async (
          phrase: string,
          password: string,
          captured: number
        ) => {
          const guard = () => current(captured);
              const before = await storage.readState();
          guard();
          if (
            before.presence !== 'empty' ||
            !storage.recovery?.fingerprintPair ||
            !storage.recovery.prepareCreation ||
            !storage.recovery.plannedSnapshot ||
            !storage.recovery.commitReplacement
          )
            throw new KeyringRuntimeError('NOT_READY');
          const admitted = await storage.recovery.readSnapshot();
          guard();
          assertNativeRecordDomains(admitted.records);
          if (
            admitted.records.some((row) => row.key !== 'utf8Error') ||
            admitted.notes.length ||
            admitted.signedRecords.length
          )
            throw new KeyringRuntimeError('NOT_READY');
          const staged = await stageInitialWallet(
            { key: String(initialEvmNetwork.slip44), network: sdkEvmNetwork(initialEvmNetwork), password, phrase },
            { assertCurrent: guard, loadSdk: dependencies.loadSdk }
          );
          guard();
          const fingerprint = await storage.recovery.fingerprintPair(
            staged.pair
          );
          guard();
          const records = createNativeAccountRecord(staged, fingerprint);
          const first = staged.groups[0]!.accounts.HDAccount[0]!;
          const plan = await storage.recovery.prepareCreation(
            admitted,
            { ...staged.pair, accountRecords: records },
            {
              address: first.address,
              publicKey: first.xpub.toLowerCase(),
              profileId: staged.profileId,
            }
          );
          guard();
          const expected = storage.recovery.plannedSnapshot(plan);
          await storage.recovery.commitReplacement(plan, guard); guard();
              const observed = await storage.recovery.readSnapshot(); guard();
          if (!sameRecoverySnapshot(observed, expected))
            throw new KeyringRuntimeError('CLEANUP_FAILED');
          Object.assign(state, stateFor(records));
          const unlocked = await keyring.unlock(password);
          guard();
          if (!unlocked.canLogin)
            throw new KeyringRuntimeError('CLEANUP_FAILED');
          await hydrate(captured);
          guard();
        };
        const selectedAccount = () => {
          if (!catalogueSnapshot || !keyring.isUnlocked()) throw new KeyringRuntimeError('NOT_READY');
          const catalogue = catalogueSnapshot;
          const selected = catalogue.accounts.find((a) => a.id === catalogue.active.accountId);
          if (!selected || selected.index !== state.activeAccount.id || selected.type !== state.activeAccount.type ||
              selected.slip44 !== state.activeNetwork.slip44)
            throw new KeyringRuntimeError('CANCELLED');
          const runtime = state.accounts[selected.type][selected.index];
          if (!runtime || runtime.address !== selected.address || (selected.type === 'Imported') !== runtime.isImported)
            throw new KeyringRuntimeError('CANCELLED');
          return selected;
        };
        const authenticate = async (password: string, captured: number, live?: {
          identity: WalletIdentityRead; assertCurrent(): void;
        }) => {
          const check = () => {
            current(captured);
            if (live) { checkGuard(live.assertCurrent); current(captured); }
          };
          validPassword(password, false);
          if (live) check();
          await storage.authGuard.checkAllowed();
          check();
          const identity = await readIdentity(); check();
          if (live) {
            // Reauthenticate the already verified owner without replacing its account state.
            if (JSON.stringify(identity) !== JSON.stringify(live.identity)) throw new KeyringRuntimeError('CANCELLED');
          } else {
            const records = recoveryVerificationRecords(
              await storage.keyringStorage.get(WALLET_CATALOGUE_KEY),
              identity.walletBindingId
            );
            check();
            Object.assign(state, stateFor(records));
          }
          const result = await keyring.unlock(password);
          if (!result || typeof result.canLogin !== 'boolean') throw new Error('UNAVAILABLE');
          if (!result.canLogin) {
            // A definitive rejected credential still counts when lock/background
            // revokes the session while its unabortable KDF is finishing.
            if (storage.recovery?.recordFailureForPair) await storage.recovery.recordFailureForPair(identity.pairFingerprint);
            else await storage.authGuard.recordFailure();
            check();
            return false;
          }
          check();
          if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity)) throw new KeyringRuntimeError('CANCELLED');
          check();
          await storage.authGuard.recordSuccess();
          check();
          if (!live) { authenticatedPair = identity.pairFingerprint; verifiedIdentity = null; }
          return true;
        };
        const dataBinding = async (captured: number, guard: () => void = () => undefined): Promise<string> => {
          current(captured); checkGuard(guard);
          const identity = await readIdentity(); current(captured); checkGuard(guard);
          if (!keyring.isUnlocked() || !verifiedIdentity || JSON.stringify(identity) !== JSON.stringify(verifiedIdentity))
            throw new KeyringRuntimeError('CANCELLED');
          return verifiedIdentity.walletBindingId;
        };
        const assertNoteAvailable = () => {
          current(generation);
          if (active || reserved || pendingSubmissions.size) throw new KeyringRuntimeError('BUSY');
        };
        const runNote = async <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          assertNoteAvailable();
          const captured = generation;
          let resolve!: (result: Promise<T>) => void, reject!: (error: unknown) => void;
          const task = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; }).finally(async () => {
            if (noteStorageFault === 'unreported') {
              // Let the service classify an ambiguous receipt before revoking its session.
              noteStorageFault = 'reopen';
              try { await lock(); } catch { /* The owner remains quarantined. */ }
            }
            if (active === task) active = null;
          });
          // Install admission before callbacks, while allowing the shared codec
          // to snapshot caller bytes in this same turn.
          active = task;
          try { resolve(operation(captured)); } catch (error) { reject(error); }
          return task;
        };
        const noteSession = (captured: number, assertOwner: () => void): IPrivateVaultSession => {
          const ring = keyring, identity = verifiedIdentity, revision = catalogueSnapshot?.revision;
          const assertCurrent = () => {
            current(captured); checkGuard(assertOwner); current(captured);
            if (!identity?.root || keyring !== ring || !ring.isUnlocked() ||
                authenticatedPair !== identity.pairFingerprint ||
                verifiedIdentity?.walletBindingId !== identity.walletBindingId ||
                verifiedIdentity.root?.profileId !== identity.root.profileId ||
                catalogueSnapshot?.revision !== revision || revision === undefined)
              throw new KeyringRuntimeError('CANCELLED');
          };
          assertCurrent();
          return Object.freeze({ generation: captured, keyring: ring, assertCurrent });
        };
        const authenticateVerifiedOwner = async (password: string, request: IPrivateVaultSession) => {
          request.assertCurrent();
          const owner = keyring, identity = verifiedIdentity;
          if (!identity || request.keyring !== owner) throw new KeyringRuntimeError('CANCELLED');
          try {
            const authenticated = await authenticate(password, request.generation, {
              identity, assertCurrent: request.assertCurrent,
            });
            request.assertCurrent();
            return authenticated;
          } catch (error) {
            if (request.generation !== generation && owner.isUnlocked()) await owner.lockWallet();
            if (error instanceof WalletStorageError && error.code === 'STORAGE_REOPEN_REQUIRED') requireNoteReopen();
            throw error;
          }
        };
        const openNotes = <T>(assertOwner: () => void, bind: (notes: NoteRuntime, session: IPrivateVaultSession) => T | Promise<T>) => runNote(async (captured): Promise<T> => {
          const session = noteSession(captured, assertOwner);
          if (!noteBackups) {
            const notes = storage.notes;
            if (!notes || !storage.recovery) throw new KeyringRuntimeError('NOT_READY');
            const { createNativeNoteBackupRuntime } = await import('./noteBackupRuntime.ts');
            session.assertCurrent();
            noteBackups = createNativeNoteBackupRuntime({
              notes,
              assertAvailable: assertNoteAvailable,
              run: runNote,
              requireReopen: requireNoteReopen,
              async binding() {
                const walletBindingId = await dataBinding(generation);
                const profileId = verifiedIdentity?.root?.profileId;
                if (!profileId) throw new KeyringRuntimeError('CANCELLED');
                return { walletBindingId, profileId };
              },
              async authenticate(password, request, reveal) {
                request.assertCurrent();
                if (!isNativePasswordInput(password)) throw new Error('BACKUP_AUTHENTICATION_FAILED');
                let authenticated: boolean;
                try {
                  authenticated = await authenticateVerifiedOwner(password, request);
                } catch (error) {
                  if (error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED')
                    throw new Error('BACKUP_AUTHENTICATION_FAILED');
                  throw error;
                }
                request.assertCurrent();
                if (!authenticated) throw new Error('BACKUP_AUTHENTICATION_FAILED');
                return reveal();
              },
            });
          }
          return bind(noteBackups, session);
        });
        const openNoteBackup: NonNullable<KeyringRuntime['openNoteBackup']> = (assertOwner) =>
          openNotes(assertOwner, (notes, session) => notes.bind(session));
        const openNoteCapacity: NonNullable<KeyringRuntime['openNoteCapacity']> = (assertOwner) =>
          openNotes(assertOwner, (notes, session) => notes.bindCapacity(session));
        const readNoteInventory: NonNullable<KeyringRuntime['readNoteInventory']> = (assertOwner) =>
          openNotes(assertOwner, (notes, session) => notes.readInventory(session));
        const authorizeWalletRemoval: NonNullable<KeyringRuntime['authorizeWalletRemoval']> = (password, assertOwner) => runNote(async (captured) => {
          const recovery = storage.recovery;
          if (!recovery || !storage.removal) throw new KeyringRuntimeError('NOT_READY');
          const session = noteSession(captured, assertOwner);
          const identity = verifiedIdentity;
          if (!(await authenticateVerifiedOwner(password, session))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
          const snapshot = await recovery.readSnapshot();
          session.assertCurrent();
          if (snapshot.state.presence !== 'existing' || !identity || JSON.stringify(snapshot.identity) !== JSON.stringify(identity))
            throw new KeyringRuntimeError('CANCELLED');
          return Object.freeze({ snapshot, assertCurrent() {
            try { session.assertCurrent(); }
            catch (error) {
              if (captured !== generation || closed) throw new KeyringRuntimeError('CANCELLED');
              throw error;
            }
          } });
        });
        type UtxoNetworkApproval = import('./accounts.ts').NativeUtxoNetworkApproval;
        const registrationApprovals = new WeakMap<UtxoNetworkApproval, Readonly<{
          network: UtxoNetwork; generation: number; snapshot: NativeWalletCatalogueSnapshot; signal: AbortSignal;
        }>>();
        const utxoSettingsContext = (expectedRevision: number, signal: AbortSignal, assertOwner: () => void) => {
          const captured = generation, snapshot = catalogueSnapshot;
          const fetch = dependencies.utxoFetch;
          if (!fetch || !dependencies.readUtxoAccount || !dependencies.readUtxoBalance || !utxoRecords ||
              !snapshot || snapshot.revision !== expectedRevision || !keyring.isUnlocked())
            throw new KeyringRuntimeError('NOT_READY');
          if (pendingRegistration || active || reserved) throw new KeyringRuntimeError('BUSY');
          const check = () => {
            current(captured); checkGuard(assertOwner);
            if (signal.aborted || snapshot !== catalogueSnapshot ||
                !keyring.isUnlocked() || active || reserved) throw new KeyringRuntimeError('CANCELLED');
          };
          check();
          return { captured, snapshot, fetch, check, records: utxoRecords };
        };
        const verifyUtxoSettings = async (
          draft: import('./accounts.ts').NativeUtxoNetworkDraft, previous: UtxoNetwork | undefined,
          owner: ReturnType<typeof utxoSettingsContext>, signal: AbortSignal
        ): Promise<UtxoNetwork> => {
          const controller = new AbortController();
          const abort = () => controller.abort();
          owner.check();
          pendingRegistration = controller;
          signal.addEventListener('abort', abort, { once: true });
          try {
            return await verifyUtxoRegistration(draft, previous, { fetch: exactUtxoResponseFetch(owner.fetch), timeoutMs: 10_000 }, controller.signal, owner.check);
          } finally {
            if (pendingRegistration === controller) pendingRegistration = null;
            signal.removeEventListener('abort', abort);
            controller.abort();
          }
        };
        const prepareUtxo: NonNullable<NativeNetworkRuntime['prepareUtxo']> = async (
          input, expectedRevision, signal, assertOwner
        ) => {
          const owner = utxoSettingsContext(expectedRevision, signal, assertOwner);
          const draft = decodeStorageValue(encodeStorageValue(input)) as typeof input;
          if (!draft || Object.keys(draft).sort().join(',') !== 'endpoint,explorer,name' ||
              typeof draft.endpoint !== 'string' || typeof draft.explorer !== 'string' || typeof draft.name !== 'string')
            throw new KeyringRuntimeError('INVALID_INPUT');
          const network = await verifyUtxoSettings(draft, undefined, owner, signal);
          owner.check();
          if (!supportsUtxoSoftwareCustody(network) ||
              owner.snapshot.utxoNetworks.some(({ chainId, slip44 }) => chainId === network.chainId || slip44 === network.slip44))
            throw new KeyringRuntimeError('INVALID_INPUT');
          const proof = Object.freeze({ kind: 'add-utxo-network' } as const);
          registrationApprovals.set(proof, { network, generation: owner.captured, snapshot: owner.snapshot, signal });
          return proof;
        };
        const withUtxoEditApproval: NonNullable<NativeNetworkRuntime['withUtxoEditApproval']> = async (
          id, input, expectedRevision, signal, assertOwner, commit
        ) => {
          const owner = utxoSettingsContext(expectedRevision, signal, assertOwner);
          const previous = findUtxoNetwork(id, owner.snapshot.utxoNetworks);
          if (!previous || !isCustomUtxoNetworkId(previous.id))
            throw new KeyringRuntimeError('INVALID_INPUT');
          const draft = decodeStorageValue(encodeStorageValue(input)) as typeof input;
          if (!draft || Object.keys(draft).sort().join(',') !== 'endpoint,name' ||
              typeof draft.endpoint !== 'string' || typeof draft.name !== 'string')
            throw new KeyringRuntimeError('INVALID_INPUT');
          const candidate = projectUtxoRegistration({
            ...utxoRegistrationData(previous), name: draft.name, endpoint: canonicalUtxoEndpoint(draft.endpoint),
          });
          const changed = candidate.endpoint !== previous.endpoint;
          const network = changed
            ? await verifyUtxoSettings({ endpoint: candidate.endpoint, name: candidate.name, explorer: previous.explorer }, previous, owner, signal)
            : candidate;
          const approve = async () => {
            owner.check();
            const proof = Object.freeze({ kind: 'edit-utxo-network' } as const);
            registrationApprovals.set(proof, { network, generation: owner.captured, snapshot: owner.snapshot, signal });
            try { await commit(proof); }
            finally { registrationApprovals.delete(proof); }
          };
          if (!changed) return approve();
          const { utxoSubmissionUrl } = await import('../../../../source/wallet/utxoSignedBinding.ts');
          owner.check();
          // Enter the same journal admission as extension before retiring the
          // current owner. An expected pending transfer leaves Settings usable.
          return owner.records.replaceEndpoint(
            { keyring, assertCurrent: owner.check }, previous, utxoSubmissionUrl(previous.endpoint), approve
          );
        };
        const reserveContext = (input:
            | NativeAccountRequest | import('./accounts.ts').NativeNetworkRequest, expectedRevision: number, networkSelection = false) => {
            if (closed || !keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            const request = decodeStorageValue(encodeStorageValue(input)) as NativeAccountRequest | import('./accounts.ts').NativeNetworkRequest;
            if (!request || typeof request !== 'object' || Array.isArray(request) || (!networkSelection && ['select-network', 'save-network', 'add-utxo-network', 'edit-utxo-network', 'remove-network'].includes(request.kind))) throw new KeyringRuntimeError('INVALID_INPUT');
            const accountTarget = 'id' in request && !['select-network', 'remove-network'].includes(request.kind);
            const utxoRegistration = request.kind === 'add-utxo-network' || request.kind === 'edit-utxo-network';
            const fields = request.kind === 'create' ? ['kind', 'label', 'password'] : request.kind === 'rename' ? ['kind', 'id', 'label']
              : request.kind === 'remove' ? ['kind', 'id', 'password'] : request.kind === 'save-network' ? ['kind', 'registration'] : utxoRegistration ? ['kind'] : request.kind === 'select' || request.kind === 'select-network' || request.kind === 'remove-network' ? ['kind', 'id'] : [];
            if (!fields.length || Object.keys(request).sort().join(',') !== fields.sort().join(',') ||
                (accountTarget && (typeof request.id !== 'string' || (() => { try { parseNativeAccountId(request.id); return false; } catch { return true; } })())) ||
                ('label' in request && (typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label || request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label))))
              throw new KeyringRuntimeError('INVALID_INPUT');
            if ('password' in request) validPassword(request.password, false);
            // Expected eligibility failures leave the current authority/reviews intact.
            if (request.kind === 'remove-network' ||
                (request.kind === 'select-network' && !findUtxoNetwork(request.id, catalogueSnapshot.utxoNetworks)))
              getNativeNetwork(request.id, catalogueSnapshot.networks);
            if (request.kind === 'save-network') snapshotNativeNetwork(request.registration);
            const approval = utxoRegistration ? registrationApprovals.get(input as UtxoNetworkApproval) : undefined;
            if (utxoRegistration) {
              registrationApprovals.delete(input as UtxoNetworkApproval);
              if (!approval || approval.signal.aborted || approval.generation !== generation || approval.snapshot !== catalogueSnapshot)
                throw new KeyringRuntimeError('CANCELLED');
            }
            if (accountTarget) {
              const target = catalogueSnapshot.accounts.find((account) => account.id === request.id);
              if (!target) throw new KeyringRuntimeError('INVALID_INPUT');
              if (request.kind === 'remove' && ((target.type === 'HDAccount' && target.index === 0) || target.id === catalogueSnapshot.active.accountId || catalogueSnapshot.accounts.length <= 1))
                throw new KeyringRuntimeError('ACCOUNT_NOT_REMOVABLE');
            }
            const token = {};
            reserved = token;
            const generationAtAdmission = revokeGeneration();
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
                    if (!(await authenticate(request.password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                    current(captured); checkGuard(assertCurrent);
                    await hydrate(captured);
                    current(captured); checkGuard(assertCurrent);
                  }
                  const before = catalogueSnapshot;
                  if (!before || before.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
                  let derived: IKeyringAccountState | undefined;
                  let mutation;
                  if (request.kind === 'create') {
                  const created = await keyring.addNewAccount(request.label);
                      current(captured); checkGuard(assertCurrent);
                      if (!created || !Number.isSafeInteger(created.id) || created.id < 1 ||
                          before.accounts.some((account) => account.type === 'HDAccount' && account.index === created.id))
                        throw new KeyringRuntimeError('CANCELLED');
                      derived = checkedAccount(created, created.id, before.active.networkId, before.utxoNetworks);
                  mutation = { kind: 'create', account: derived } as const;
                  } else if (request.kind === 'add-utxo-network' || request.kind === 'edit-utxo-network') {
                    if (!approval || approval.signal.aborted || approval.snapshot !== before)
                      throw new KeyringRuntimeError('CANCELLED');
                    mutation = { kind: request.kind, registration: utxoRegistrationData(approval.network) } as const;
                  } else {
                    mutation = request;
                    if (request.kind === 'select-network') {
                      const guard = () => { current(captured); checkGuard(assertCurrent); };
                      const utxo = findUtxoNetwork(request.id, before.utxoNetworks);
                      if (utxo && !supportsUtxoSoftwareCustody(utxo)) throw new KeyringRuntimeError('INVALID_INPUT');
                      if ((utxo?.slip44 ?? 60) !== state.activeNetwork.slip44) {
                        await dataBinding(captured, guard); guard();
                        const initialGroup = await switchAccountGroup(request.id, guard); guard();
                        if (initialGroup) mutation = { ...request, initialGroup };
                      }
                    } else if (request.kind === 'remove') {
                      const account = before.accounts.find((a) => a.id === request.id);
                      if (!account) throw new KeyringRuntimeError('CANCELLED');
                      if (account.slip44 === 60) {
                        await dataBinding(captured, assertCurrent);
                        current(captured); checkGuard(assertCurrent);
                        const retained = await signedRecords.listAddress({ keyring, assertCurrent: () => { current(captured); checkGuard(assertCurrent); } }, account.address);
                        const hasAlias = before.accounts.some((candidate) => candidate.id !== account.id && candidate.address.toLowerCase() === account.address.toLowerCase());
                        if (!hasAlias && retained.some((entry) => !['confirmed','reverted','nonce-consumed'].includes(entry.phase))) throw new TransferJournalError('PENDING_TRANSFER');
                        current(captured); checkGuard(assertCurrent);
                      } else {
                        const network = findUtxoNetwork(before.active.networkId, before.utxoNetworks);
                        const source = state.accounts[account.type][account.index];
                        if (!utxoRecords || !network || network.slip44 !== account.slip44 ||
                            !source?.xpub || source.address !== account.address)
                          throw new KeyringRuntimeError('NOT_READY');
                        const guard = () => { current(captured); checkGuard(assertCurrent); };
                        await dataBinding(captured, guard); guard();
                        const pending = await utxoRecords.hasUnresolvedForAccount(
                          { keyring, assertCurrent: guard },
                          account.slip44,
                          { type: account.type, id: account.index, xpub: source.xpub },
                        );
                        guard();
                        if (pending) throw new TransferJournalError('PENDING_TRANSFER');
                      }
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
          async previewUtxo(input, expectedRevision, assertCurrent) {
            const captured = generation, snapshot = catalogueSnapshot, ring = keyring;
            const network = snapshot && findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            const guard = () => {
              current(captured); checkGuard(assertCurrent); current(captured);
              if (active || reserved) throw new KeyringRuntimeError('BUSY');
              if (!ring.isUnlocked() || catalogueSnapshot !== snapshot || keyring !== ring ||
                  snapshot?.revision !== expectedRevision)
                throw new KeyringRuntimeError('CANCELLED');
            };
            guard();
            if (!network || network.decimals !== 8 || !utxoRecords || !dependencies.utxoFetch || !dependencies.readUtxoBalance)
              throw new KeyringRuntimeError('NOT_READY');
            try {
              const { privateKey, utxoAddressType } = normalizeUtxoImport(input);
              if (!supportsUtxoSoftwareCustody(network, utxoAddressType === 'p2tr' ? 1 : 0))
                throw new KeyringRuntimeError('INVALID_INPUT');
              guard();
              const account = await ring.importAccount(privateKey, undefined, utxoAddressType ? { utxoAddressType } : undefined);
              guard();
              return checkedUtxoImport(account, network, utxoAddressType ? 'address' : 'account').address;
            } catch (cause) {
              guard();
              // The SDK importer currently reports duplicates without a code.
              if (cause instanceof Error && cause.message === 'Account already exists, try again with another Private Key.')
                throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
              throw new KeyringRuntimeError('INVALID_INPUT');
            }
          },
          reserve(input, password, expectedRevision) {
            if (closed || !keyring.isUnlocked() || !catalogueSnapshot)
              throw new KeyringRuntimeError('NOT_READY');
            if (active || reserved) throw new KeyringRuntimeError('BUSY');
            if (catalogueSnapshot.revision !== expectedRevision) throw new KeyringRuntimeError('CANCELLED');
            const networkId = catalogueSnapshot.active.networkId;
            const utxo = findUtxoNetwork(networkId, catalogueSnapshot.utxoNetworks);
            if (utxo && (utxo.decimals !== 8 || !utxoRecords || !dependencies.utxoFetch || !dependencies.readUtxoBalance))
              throw new KeyringRuntimeError('NOT_READY');
            let request: typeof input;
            try {
              request = decodeStorageValue(encodeStorageValue(input)) as typeof input;
              const fields = request && Object.keys(request).sort().join(',');
              if (!request || typeof request !== 'object' || Array.isArray(request) ||
                  (fields !== 'expectedAddress,label,privateKey' &&
                    !(utxo && fields === 'expectedAddress,label,privateKey,utxoAddressType')) ||
                  typeof request.label !== 'string' || !request.label.isWellFormed() || !request.label || request.label.trim() !== request.label ||
                  request.label.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(request.label)) throw new Error('INVALID_INPUT');
              if (utxo && !supportsUtxoSoftwareCustody(utxo, request.utxoAddressType === 'p2tr' ? 1 : 0))
                throw new KeyringRuntimeError('INVALID_INPUT');
              const key = utxo
                ? normalizeUtxoImport({ privateKey: request.privateKey, utxoAddressType: request.utxoAddressType }).privateKey
                : normalizeImportedKey(request.privateKey);
              const address = utxo ? normalizeUtxoAddress(request.expectedAddress, utxo) : importedKeyIdentity(key, 0).address;
              if (request.expectedAddress !== address) throw new Error('INVALID_INPUT');
              request = Object.freeze({ ...request, privateKey: key });
              validPassword(password, false);
            } catch { throw new KeyringRuntimeError('INVALID_INPUT'); }
            if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
              throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
            const token = {}; reserved = token; const generationAtAdmission = revokeGeneration(); let used = false;
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
                  if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                  guard(); await hydrate(captured); guard();
                  if (!catalogueSnapshot || catalogueSnapshot.revision !== expectedRevision ||
                      catalogueSnapshot.active.networkId !== networkId) throw new KeyringRuntimeError('CANCELLED');
                  if (catalogueSnapshot.accounts.some((account) => account.address === request.expectedAddress))
                    throw new KeyringRuntimeError('DUPLICATE_ACCOUNT');
                  const prepared = await importAccountWithRecovery(keyring, { secret: request.privateKey, label: request.label,
                    network: utxo ? { kind: 'syscoin', slip44: utxo.slip44 } : { kind: 'ethereum', slip44: 60 },
                    ...(utxo && request.utxoAddressType && { options: { utxoAddressType: request.utxoAddressType } }) }, guard); guard();
                  const index = prepared.account.id;
                  const imported = utxo
                    ? checkedUtxoImport(prepared.account, utxo, request.utxoAddressType ? 'address' : 'account')
                    : checkedImported(prepared.account, request.privateKey, index);
                  if (imported.address !== request.expectedAddress) throw new KeyringRuntimeError('INVALID_INPUT');
                  const next = await catalogue.mutate(expectedRevision, { kind: 'import',
                      account: imported, recovery: prepared.recovery }, guard); guard();
                  state.accounts.Imported[index] = imported;
                  publishAccounts(next);
                });
              },
            };
          },
        };
        const accounts: NativeAccountRuntime = {
          supported: () => typeof keyring.addNewAccount === 'function',
          getSnapshot: () => closed || requiresReopen() || !keyring.isUnlocked() ? null : catalogueSnapshot,
          reserve: (input, expectedRevision) => reserveContext(input, expectedRevision),
        };
        const networks: NativeNetworkRuntime = {
          prepareUtxo,
          withUtxoEditApproval,
          getSelectedId: () => closed || requiresReopen() || !keyring.isUnlocked() ? null : catalogueSnapshot?.active.networkId ?? null,
          reserve: (input, expectedRevision) => {
            const request = typeof input === 'string' ? { kind: 'select-network' as const, id: input } : input;
            return reserveContext(request, expectedRevision, true);
          },
        };
        const canSign = () => !!catalogueSnapshot && nativeSigningEnabled(catalogueSnapshot.active.networkId, catalogueSnapshot.networks);
        const activityContext = async (assertCurrent: () => void): Promise<{ scope: ActivityScope; guard: () => void; index: number; type: NativeAccountType }> => {
          const captured = generation;
          const guard = () => { current(captured); checkGuard(assertCurrent); if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY'); };
          guard();
          const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
          const networkId = catalogueSnapshot!.active.networkId;
          const fingerprint = await dataBinding(captured, guard); guard();
          return { scope: createActivityScope(fingerprint, selected.id, selected.address, getNativeNetwork(networkId, catalogueSnapshot!.networks)), guard, index: selected.index, type: selected.type };
        };
        const checkActivityContext = async (scope: EvmActivityReadScope, assertCurrent: () => void) => {
          const context = await activityContext(assertCurrent);
          if (context.scope.key !== scope.key || context.scope.sourceId !== scope.sourceId) throw new KeyringRuntimeError('CANCELLED');
          return context;
        };
        const tokenOperation = <T>(
          assertCurrent: () => void,
          action: (scope: NativeTokenScope, guard: () => void) => Promise<T>,
          kind?: 'registry-write'
        ): Promise<T> => {
          if (active || reserved) return Promise.reject(new KeyringRuntimeError('BUSY'));
          const captured = generation;
          const check = () => {
            current(captured); checkGuard(assertCurrent);
            if (closed || captured !== generation) throw new KeyringRuntimeError('CANCELLED');
            if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
          };
          // Reserve through the synchronous caller guard. Nothing can enter
          // between successful admission, epoch retirement and task installation.
          reserved = {};
          try {
            check();
            // A write that later fails still retires earlier inventory proofs.
            if (kind === 'registry-write') retireCollectibleLifetime();
          } catch (error) {
            return Promise.reject(error);
          } finally {
            reserved = null;
          }
          const task = Promise.resolve().then(async () => {
            check();
            const selected = catalogueSnapshot!.accounts.find((account) => account.id === catalogueSnapshot!.active.accountId)!;
            const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
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
          ...(storage.notes && storage.recovery ? { openNoteBackup, openNoteCapacity, readNoteInventory } : {}),
          ...(storage.removal && storage.recovery ? { authorizeWalletRemoval } : {}),
          accounts,
          security: {
            reauthenticateIdlePolicy: (password, assertCurrent) => run(async (captured) => {
              current(captured); checkGuard(assertCurrent);
              if (!keyring.isUnlocked() || !catalogueSnapshot) throw new KeyringRuntimeError('NOT_READY');
              if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              current(captured); checkGuard(assertCurrent);
              await hydrate(captured); current(captured); checkGuard(assertCurrent);
            }),
          },
          imports,
          networks,
          tokens: {
            load: async (guard) => {
              // Connection replay may retire a read while its storage call is draining.
              // Wait for that reservation, then validate the new caller before reading.
              while (active) { await active.catch(() => undefined); checkGuard(guard); }
              return tokenOperation(guard, (scope, check) => tokens.load(scope, check));
            },
            add: (revision, metadata, guard) => tokenOperation(guard,
              (scope, check) => tokens.add(scope, revision, metadata, check), 'registry-write'),
            remove: (revision, contract, guard) => tokenOperation(guard,
              (scope, check) => tokens.remove(scope, revision, contract, check), 'registry-write'),
            async addCollectible(revision, collectible, guard) {
              const target = snapshotSavedCollectible(collectible);
              return tokenOperation(guard,
                (scope, check) => tokens.addCollectible(scope, revision, target, check), 'registry-write');
            },
            async removeCollectible(revision, collectible, guard) {
              const target = snapshotSavedCollectible(collectible);
              return tokenOperation(guard,
                (scope, check) => tokens.removeCollectible(scope, revision, target, check), 'registry-write');
            },
          },
          catalogue: { getSnapshot: () => closed || requiresReopen() || !keyring.isUnlocked() ? null : catalogueSnapshot },
          keyExport: {
            readSelected: (input, password, assertCurrent) => {
              if (closed || requiresReopen()) return run(async () => { throw new KeyringRuntimeError('NOT_READY'); });
              if (!catalogueSnapshot) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              let scope;
              try {
                scope = snapshotHdKeyExportScope(input, catalogueSnapshot.utxoNetworks);
                if (typeof assertCurrent !== 'function') throw new KeyringRuntimeError('INVALID_INPUT');
              } catch { return Promise.reject(new KeyringRuntimeError('INVALID_INPUT')); }
              return run(async (captured) => {
                const ring = keyring;
                const utxo = catalogueSnapshot && findUtxoNetwork(scope.networkId, catalogueSnapshot.utxoNetworks);
                const sdkNetwork = utxo && getUtxoSdkNetwork(utxo);
                const type = parseNativeAccountId(scope.accountId).type;
                const xpub = state.accounts[type][scope.index]?.xpub;
                const extended = type === 'HDAccount' || (xpub !== undefined && xpub !== scope.address);
                const script = utxo && !extended && findWifAddressType(scope.address, utxo);
                const check = () => {
                  current(captured); checkGuard(assertCurrent);
                  current(captured);
                  const catalogue = catalogueSnapshot;
                  const selected = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId);
                  if (ring !== keyring || !ring.isUnlocked() || !catalogue || !selected) throw new KeyringRuntimeError('NOT_READY');
                  if (catalogue.revision !== scope.catalogueRevision || selected.type !== type ||
                      selected.slip44 !== (utxo?.slip44 ?? 60) || selected.id !== scope.accountId || selected.index !== scope.index ||
                      selected.address !== scope.address || catalogue.active.networkId !== scope.networkId ||
                      keyExportRegistrationHash(catalogue.active.networkId, catalogue) !== scope.registrationHash ||
                      state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type)
                    throw new KeyringRuntimeError('CANCELLED');
                  if (utxo && sdkNetwork) {
                    const actual = state.activeNetwork, account = state.accounts[type][selected.index];
                    if (!account || account.id !== selected.index || account.address !== selected.address || account.xpub !== xpub ||
                        actual.kind !== sdkNetwork.kind || actual.chainId !== sdkNetwork.chainId ||
                        actual.slip44 !== sdkNetwork.slip44 || actual.currency !== sdkNetwork.currency ||
                        actual.utxoBackendChain !== sdkNetwork.utxoBackendChain || actual.url !== sdkNetwork.url)
                      throw new KeyringRuntimeError('CANCELLED');
                    if (type === 'HDAccount') checkedAccount(account, selected.index, utxo.id, catalogue.utxoNetworks);
                  }
                };
                check();
                if (utxo && type === 'Imported') {
                  if (!extended && !script) throw new KeyringRuntimeError('CANCELLED');
                  checkedUtxoImport(state.accounts.Imported[scope.index]!, utxo, extended ? 'account' : 'address');
                }
                const stored = await storage.readState(); check();
                if (stored.presence !== 'existing' || stored.backup !== 'confirmed') throw new KeyringRuntimeError('NOT_READY');
                if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
                check();
                await hydrate(captured); check();
                // The SDK selector is fixed here; no account type or alternate index comes from a screen.
                const privateKey = await ring.getPrivateKeyByAccountId(scope.index, type === 'HDAccount' ? sdk.KeyringAccountType.HDAccount : sdk.KeyringAccountType.Imported, password);
                check();
                if (utxo && sdkNetwork) {
                  if (extended) {
                    if (!isUtxoAccountPrivateKey(privateKey, utxo.testnet)) throw new KeyringRuntimeError('OPERATION_FAILED');
                    const result = ring.validateZprv(privateKey, sdkNetwork);
                    if (!result.isValid || !result.node || result.node.neutered().toBase58() !== xpub)
                      throw new KeyringRuntimeError('OPERATION_FAILED');
                    check();
                    return privateKey;
                  }
                  if (!script || !isUtxoWifText(privateKey)) throw new KeyringRuntimeError('OPERATION_FAILED');
                  const { ECPair, payments } = syscoinUtils.bitcoinjs;
                  const network = utxo.addressNetwork;
                  const pair = ECPair.fromWIF(privateKey, network);
                  const pubkey = pair.publicKey;
                  if (script !== 'p2pkh' && !pair.compressed) throw new KeyringRuntimeError('OPERATION_FAILED');
                  const payment = script === 'p2tr' ? payments.p2tr({ internalPubkey: pubkey.slice(1), network })
                    : payments[script]({ pubkey, network });
                  if (payment.address !== scope.address) throw new KeyringRuntimeError('OPERATION_FAILED');
                  check();
                  return privateKey;
                }
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
              await createStoredWallet(phrase, password, captured);
            }),
            importWallet: (phrase, password) => run(async (captured) => {
              validPassword(password, true);
              if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096) throw new KeyringRuntimeError('INVALID_INPUT');
              const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
              if (![12, 24].includes(normalized.split(' ').length) || !keyring.isSeedValid(normalized)) throw new KeyringRuntimeError('INVALID_INPUT');
              current(captured);
              await createStoredWallet(normalized, password, captured);
            }),
            unlock: (password) => run(async (captured) => {
              const authenticated = await authenticate(password, captured);
              if (authenticated) await hydrate(captured);
              return { authenticated };
            }),
            async readSelectedAddress() {
              if (closed || requiresReopen() || !keyring.isUnlocked()) throw new Error('NOT_READY');
              const selected = selectedAccount();
              return normalizePublicAddress(selected.address, catalogueSnapshot!.active.networkId, catalogueSnapshot!.utxoNetworks);
            },
            lock,
          },
          async withUtxoActivityRead(expected, signal, assertOwner, assertView, read) {
            const captured = generation, ring = keyring, snapshot = catalogueSnapshot;
            const { accountId, networkId, address } = expected;
            const network = snapshot && findUtxoNetwork(networkId, snapshot.utxoNetworks);
            if (!network || snapshot.active.networkId !== networkId || snapshot.active.accountId !== accountId)
              throw new KeyringRuntimeError('NOT_READY');
            const selected = selectedAccount(), account = state.accounts[selected.type][selected.index]!;
            const identifier = account.xpub;
            const assertScope = () => {
              current(captured); checkGuard(assertOwner); current(captured);
              if (ring !== keyring || snapshot !== catalogueSnapshot || selectedAccount() !== selected ||
                  state.accounts[selected.type][selected.index] !== account || account.xpub !== identifier || selected.address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            const check = () => {
              assertScope(); checkGuard(assertView);
              if (signal.aborted) throw new KeyringRuntimeError('CANCELLED');
            };
            check();
            await dataBinding(captured, check);
            const parsed = parseUtxoPublicIdentifier(identifier, network);
            if (parsed.identifier !== identifier || parsed.address !== address ||
                (selected.type === 'HDAccount' && parsed.kind !== 'account'))
              throw new KeyringRuntimeError('CANCELLED');
            check();
            const result = await read(Object.freeze({ context: expected, identifier: parsed.identifier,
              isAccount: parsed.kind === 'account', registration: network, assertCurrent: assertScope }), signal, check);
            await dataBinding(captured, check);
            return result;
          },
          ...(dependencies.readUtxoAccount ? { async readUtxoBalance(id: UtxoNetworkId, address: string, external: AbortSignal) {
            const captured = generation, snapshot = catalogueSnapshot;
            const network = snapshot && findUtxoNetwork(id, snapshot.utxoNetworks);
            if (!network) throw new KeyringRuntimeError('NOT_READY');
            const controller = new AbortController();
            const abort = () => controller.abort();
            const guard = () => {
              current(captured);
              if (controller.signal.aborted || external.aborted ||
                  catalogueSnapshot !== snapshot || snapshot.active.networkId !== id || selectedAccount().address !== address)
                throw new KeyringRuntimeError('CANCELLED');
            };
            guard();
            const previous = pendingBalance;
            pendingBalance = controller;
            external.addEventListener('abort', abort, { once: true });
            previous?.abort();
            try {
              await dataBinding(captured, guard); guard();
              const { type, index } = selectedAccount();
              const xpub = state.accounts[type][index]!.xpub;
              const result = await (xpub === address
                ? dependencies.readUtxoBalance?.(network, address, controller.signal, guard)
                : dependencies.readUtxoAccount!(network, xpub, controller.signal, guard));
              if (!result) throw new KeyringRuntimeError('NOT_READY');
              guard();
              return result;
            } finally {
              external.removeEventListener('abort', abort);
              if (pendingBalance === controller) pendingBalance = null;
              controller.abort();
            }
          } } : {}),
          ...(dependencies.utxoFetch && utxoRecords ? { async openUtxoSend(assertOwner: () => void) {
            const captured = generation, ring = keyring, snapshot = catalogueSnapshot;
            const selected = selectedAccount(), network = snapshot && findUtxoNetwork(snapshot.active.networkId, snapshot.utxoNetworks);
            if (!network || !supportsUtxoSoftwareCustody(network)) throw new KeyringRuntimeError('NOT_READY');
            const sdkNetwork = getUtxoSdkNetwork(network), account = state.accounts[selected.type][selected.index]!;
            const { xpub } = account;
            if (selected.type === 'Imported') checkedUtxoImport(account, network);
            const guard = () => {
              current(captured); checkGuard(assertOwner); current(captured);
              const actual = state.activeNetwork, live = state.accounts[selected.type][selected.index];
              if (ring !== keyring || !ring.isUnlocked() || catalogueSnapshot !== snapshot ||
                  live !== account || live.xpub !== xpub || live.address !== selected.address ||
                  state.activeAccount.id !== selected.index || state.activeAccount.type !== selected.type ||
                  actual.kind !== sdkNetwork.kind || actual.chainId !== sdkNetwork.chainId ||
                  actual.slip44 !== sdkNetwork.slip44 || actual.currency !== sdkNetwork.currency ||
                  actual.utxoBackendChain !== sdkNetwork.utxoBackendChain || actual.url !== sdkNetwork.url)
                throw new KeyringRuntimeError('CANCELLED');
              if (active || reserved) throw new KeyringRuntimeError('BUSY');
            };
            guard(); await dataBinding(captured, guard); guard();
            const profileId = await ring.getPrivateRecordProfileId(); guard();
            utxoSend?.cancel();
            const { createNativeUtxoSend } = await import('./utxoSend.ts'); guard();
            const opened = createNativeUtxoSend(network, {
              profileId,
              account: { address: selected.address, id: selected.index, type: selected.type, xpub },
              network: { kind: 'syscoin', currency: sdkNetwork.currency, chainId: sdkNetwork.chainId,
                genesisHash: network.genesisHash, slip44: sdkNetwork.slip44, url: sdkNetwork.url },
            }, { keyring: ring, assertCurrent: guard }, ring.syscoinTransaction, utxoRecords, dependencies.utxoFetch!, ring.getAddress);
            utxoSend = opened;
            return Object.freeze<NativeUtxoSend>({ ...opened, async confirm(view) {
              const pending = opened.confirm(view);
              pendingSubmissions.add(pending);
              try { return await pending; }
              finally {
                pendingSubmissions.delete(pending);
                if (utxoRecords.requiresReopen) void lock().catch(() => undefined);
              }
            } });
          } } : {}),
          activity: {
            async load(assertCurrent) {
              const { scope, guard, index, type } = await activityContext(assertCurrent);
              const journal = createNativeSignedRecordView(signedRecords,{keyring,assertCurrent:guard},scope.walletFingerprint,{index,type,address:scope.address},scope.network);
              const recent = await journal.activities(); guard();
              const saved = await activityHistory.load(scope, guard); guard();
              const inventory = await tokens.load({ walletFingerprint: scope.walletFingerprint, accountId: scope.accountId,
                address: scope.address, network: scope.network.id, chainId: scope.network.chainId,
                registrationHash: scope.network.registrationHash }, guard); guard();
              return { scope, locals: recent.records, assets: inventory.items,
                saved: { ...saved, truncated: saved.truncated || recent.truncated } };
            },
            async loadSavedPending(previousScope, beforeHash, assertCurrent) {
              const { scope, guard, index, type } = await checkActivityContext(previousScope, assertCurrent);
              const journal = createNativeSignedRecordView(signedRecords, { keyring, assertCurrent: guard }, scope.walletFingerprint,
                { index, type, address: scope.address }, scope.network);
              const page = await journal.pendingActivities(beforeHash); guard();
              return page;
            },
            async observeLocal(local, assertCurrent, signal) {
              const { hash, chainId, address, walletFingerprint } = local;
              const { scope, guard } = await activityContext(assertCurrent);
              if (chainId !== scope.network.chainId || address !== scope.address || walletFingerprint !== scope.walletFingerprint)
                throw new KeyringRuntimeError('CANCELLED');
              if (!dependencies.observeActivity) throw new KeyringRuntimeError('NOT_READY');
              const observe = dependencies.observeActivity;
              try {
                const result = await observeRetainedEvmTransaction(signedRecords, { keyring, assertCurrent: guard },
                  scope.network.chainId, scope.address, hash,
                  expected => observe(scope.network, expected, signal, guard), guard);
                guard(); return result.observation;
              } catch (error) {
                if (signedRecords.requiresReopen) {
                  try { await lock(); } catch { /* The poisoned storage owner must reopen. */ }
                  throw new KeyringRuntimeError('CLEANUP_FAILED');
                }
                throw error;
              }
            },
            async saveCache(scope, candidates, assertCurrent) {
              const { scope: checkedScope, guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveCache(checkedScope, candidates, guard);
            },
            async saveView(scope, view, assertCurrent) {
              const { scope: checkedScope, guard } = await checkActivityContext(scope, assertCurrent);
              await activityHistory.saveView(checkedScope, view, guard);
            },
          },
          transfers: {
            async replacementOriginal(hash, mode, assertCurrent, signal) {
              if (active || reserved || closed || !canSign()) return null;
              const captured = generation, selected = selectedAccount();
              const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
              const check = () => { current(captured); checkGuard(assertCurrent); };
              const session = { keyring, assertCurrent: check };
              const load = () => signedRecords.readReplacement(session, network.chainId, selected.address, hash, mode);
              let retained = await load();
              check();
              if (!retained) return null;
              if (!retained.binding) {
                const observe = dependencies.observeActivity;
                if (!observe) return null;
                try {
                  const result = await observeRetainedEvmTransaction(
                    signedRecords, session, network.chainId, selected.address, hash,
                    (expected) => observe(network, expected, signal, check), check
                  );
                  if (result.terminalPhase) return null;
                  retained = await load();
                  check();
                  if (!retained) return null;
                } catch (error) {
                  if (signedRecords.requiresReopen) throw new TransferJournalError('REOPEN_REQUIRED');
                  check();
                  if (signal.aborted) throw error;
                  return null;
                }
              }
              const { original, binding, rates } = retained;
              if (!binding) return null;
              const intent = mode === 'speed-up' && original.metadata?.intent !== undefined
                ? snapshotErc20TransferIntent(original.metadata.intent) : undefined;
              return Object.freeze({ rawTransaction: original.rawTransaction, binding, rates, ...(intent ? { intent } : {}) });
            },
            replay(assertCurrent, transport, options) {
              if (active || reserved || closed || !canSign()) throw new KeyringRuntimeError('NOT_READY');
              const captured = generation, selected = selectedAccount();
              const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
              const context: EvmSubmissionContext = { account: { id: selected.index, type: selected.type, address: selected.address },
                network: { kind: 'ethereum', chainId: Number(network.chainId), slip44: 60, url: network.rpcUrl }, operation: 'send' };
              const lifecycle = captureSignedSubmission(context, assertCurrent);
              const check = () => { current(captured); lifecycle.assertCurrent(); };
              const replay = new EvmSignedReplay(signedRecords, () => ({ context, recordSession: { keyring, assertCurrent: check }, assertCurrent: check, ...transport }), options.now, options.randomBytes);
              return { prepare: replay.prepare.bind(replay), cancel: replay.cancel.bind(replay), list: replay.list.bind(replay), confirm(id) {
                const work = replay.confirm(id);
                const pending = work.finally(() => pendingSubmissions.delete(pending));
                pendingSubmissions.add(pending); return pending;
              } };
            },
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
            async collectible(input, assertCurrent) {
              let target: SavedCollectible;
              try { target = snapshotSavedCollectible(input); }
              catch { throw new KeyringRuntimeError('INVALID_INPUT'); }
              if (pendingSubmissions.size) throw new KeyringRuntimeError('BUSY');
              if (!canSign()) throw new KeyringRuntimeError('NOT_READY');
              return tokenOperation(assertCurrent, async (scope, check) => {
                const captured = generation;
                const catalogue = catalogueSnapshot;
                const signal = (collectibleLifetime ??= new AbortController()).signal;
                // This proof outlives the lookup. The invocation guard is
                // used only for I/O and returning the result below.
                const assertSavedCurrent = () => {
                  current(captured);
                  if (collectibleLifetime?.signal !== signal || signal.aborted ||
                      catalogueSnapshot !== catalogue || !keyring.isUnlocked())
                    throw new KeyringRuntimeError('CANCELLED');
                };
                const checkRead = () => { check(); assertSavedCurrent(); };
                const inventory = await tokens.load(scope, checkRead);
                checkRead();
                const collectible = inventory.collectibles?.find((item) =>
                  item.contractAddress === target.contractAddress &&
                  item.tokenStandard === target.tokenStandard &&
                  (item.tokenStandard === 'ERC-721' ||
                    (target.tokenStandard === 'ERC-1155' && item.tokenId === target.tokenId))
                );
                if (!collectible) throw new KeyringRuntimeError('NOT_READY');
                return Object.freeze({ collectible, assertCurrent: assertSavedCurrent, signal });
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
              void address;
              return signedView(captured,assertCurrent,fingerprint,selected);
            },
            submit: (rawTransaction, hash, assertCurrent, broadcast, inputIntent, inputApproval, replacement) => {
              if (active || reserved || closed) return Promise.reject(new KeyringRuntimeError('BUSY'));
              const captured = generation;
              let review: {
                context: EvmSubmissionContext;
                intent: NativeAssetTransferIntent | undefined;
                expectedUnsigned: string;
              };
              const check = () => {
                current(captured);
                checkGuard(assertCurrent);
                if (!keyring.isUnlocked() || !canSign())
                  throw new KeyringRuntimeError('NOT_READY');
              };
              try {
                check();
                const selected = selectedAccount();
                const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
                const intent = inputIntent === undefined ? undefined : snapshotNativeAssetTransferIntent(inputIntent);
                const approved = snapshotReviewedTransfer(inputApproval, intent, replacement);
                const expectedUnsigned = unsignedTransferBytes(approved);
                const context: EvmSubmissionContext = {
                  account: { id: selected.index, type: selected.type, address: selected.address },
                  network: { kind: 'ethereum', chainId: Number(network.chainId), slip44: 60, url: network.rpcUrl },
                  operation: replacement?.mode ?? (intent?.kind === 'nft-transfer'
                    ? intent.tokenStandard === 'ERC-721' ? 'erc721' : 'erc1155'
                    : intent ? 'erc20' : 'send'),
                  ...(replacement ? { originalHash: replacement.original.hash } : {}),
                };
                review = { context, intent, expectedUnsigned };
              } catch (error) {
                return Promise.reject(error);
              }
              const work = Promise.resolve().then(async () => {
                check();
                const { context, intent, expectedUnsigned } = review;
                const boundary = sdk.captureEvmSubmission(
                  context,
                  check,
                  () => captureSignedSubmission(context, check, intent?.kind === 'erc20-transfer' ? { intent } : undefined, replacement?.binding)
                );
                const tx = Transaction.from(rawTransaction);
                if (tx.to === null || tx.hash !== hash)
                  throw new KeyringRuntimeError('INVALID_INPUT');
                assertTransferIntentEnvelope({
                  chainId: tx.chainId.toString(), from: tx.from ?? '', to: tx.to,
                  value: tx.value.toString(), data: tx.data,
                }, intent);
                try {
                  if (replacement?.mode === 'speed-up') {
                    const retained = await signedRecords.readExact({ keyring, assertCurrent: check }, tx.chainId.toString(), context.account.address, replacement.original.hash);
                    if (!retained) throw new NativeTransferError('EXPIRED');
                    const original = Transaction.from(retained.rawTransaction);
                    const savedIntent = retained.metadata?.intent === undefined ? undefined : snapshotErc20TransferIntent(retained.metadata.intent);
                    if (intent?.kind === 'nft-transfer' || !equalTransferIntent(savedIntent, intent) || original.accessList?.length || !tx.from || !tx.to)
                      throw new NativeTransferError('EXPIRED');
                    assertSpeedUpEnvelope({ ...replacement.original, from: original.from!, to: original.to,
                      valueUnits: original.value.toString(), data: original.data, nonce: original.nonce, type: original.type as 0 | 2 }, {
                      from: tx.from, to: tx.to, value: tx.value.toString(), data: tx.data, nonce: String(tx.nonce), type: tx.type!,
                    });
                  }
                  await sdk.submitSignedEvmTransaction(rawTransaction, broadcast, boundary, undefined, expectedUnsigned);
                } catch (error) {
                  if (signedRecords.requiresReopen || (error && typeof error === 'object' && 'code' in error && error.code === 'STORAGE_REOPEN_REQUIRED'))
                    throw Object.assign(new TransferJournalError('REOPEN_REQUIRED'), { transactionNotBroadcast: true });
                  if (error instanceof Error && error.message === 'EVM_SIGNED_RECORD_ORIGINAL_CHANGED')
                    throw new NativeTransferError('EXPIRED');
                  throw error;
                }
              });
              const pending = work.finally(() => { pendingSubmissions.delete(pending); });
              pendingSubmissions.add(pending);
              return pending;
            },
            assertUnlocked: (assertCurrent) => {
              const captured = generation;
              current(captured); checkGuard(assertCurrent); current(captured);
              if (active || reserved) throw new KeyringRuntimeError('BUSY');
              if (!keyring.isUnlocked() || !canSign()) throw new KeyringRuntimeError('NOT_READY');
            },
            sign: (transaction, assertCurrent, inputIntent, replacement) => {
              if (closed || !keyring.isUnlocked()) return Promise.reject(new KeyringRuntimeError('CANCELLED'));
              if (!canSign()) return Promise.reject(new KeyringRuntimeError('NOT_READY'));
              let intent;
              let prepared: typeof transaction;
              try {
                intent = inputIntent === undefined ? undefined : snapshotNativeAssetTransferIntent(inputIntent);
                prepared = snapshotReviewedTransfer(transaction, intent, replacement);
              } catch { return Promise.reject(new KeyringRuntimeError('INVALID_INPUT')); }
              return run(async (captured) => {
              if (!keyring.isUnlocked()) throw new KeyringRuntimeError('CANCELLED');
              checkGuard(assertCurrent);
              current(captured); checkGuard(assertCurrent);
              assertTransferIntentEnvelope(prepared, intent);
              const network = getNativeNetwork(catalogueSnapshot!.active.networkId, catalogueSnapshot!.networks);
              if (!nativeSigningEnabled(network.id, catalogueSnapshot!.networks) || prepared.chainId !== network.chainId)
                throw new KeyringRuntimeError('INVALID_INPUT');
              snapshotReviewedTransfer(prepared, intent, replacement);
              const signed = keyring.signPreparedEvmTransaction({
                account: { id: selectedAccount().index, type: selectedAccount().type, expectedAddress: prepared.from },
                network: { kind: 'ethereum', chainId: network.chainId, slip44: 60, url: network.rpcUrl },
                transaction: prepared,
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
            retireForRemoval(remove) {
              if (closing) return Promise.reject(new KeyringRuntimeError('CLEANUP_FAILED'));
              return closeRuntime(false, remove);
            },
            close: () => closeRuntime(false),
          },
          backup: {
            readPhrase: (password) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              if (!(await authenticate(password, captured))) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
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
