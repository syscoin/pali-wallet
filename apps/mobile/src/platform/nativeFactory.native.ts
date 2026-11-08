import { prepareWalletConnectRuntime } from './walletConnectRuntime';
import { NativeConnectionsController } from '../connections/controller.ts';
import { blacklistService } from '../../../../source/utils/security/blacklistService';
import { EvmTransferReadRpc } from '../custody/evmTransferReadRpc.ts';
import { custodyIdle, securityPreferences } from './security';
import { CustodyOperationError, NativeCustodyAuthority } from '../custody/authority.ts';
import { createKeyringRuntimeFactory } from '../custody/keyringRuntime.ts';
import type { KeyringRuntime } from '../custody/keyringRuntime.ts';
import { SeedBackupFlow } from '../custody/seedBackup.ts';
import { HdKeyExportFlow } from '../custody/hdKeyExport.ts';
import { NativeTransfers } from '../custody/transfers.ts';
import { NativeTokens } from '../portfolio/nativeTokens.ts';
import { NativeActivity } from '../activity/nativeActivity.ts';
import { ActivityExplorerReader } from '../activity/explorerReader.ts';
import { ActivityReceiptReader } from '../activity/receiptReader.ts';
import { createErc20Reader } from '../portfolio/erc20ReadRpc.ts';
import { createNftOwnershipReader } from '../portfolio/nftOwnershipReadRpc.ts';
import { createOwnedTokenReader } from '../portfolio/ownedTokenReader.ts';
import { isCustomUtxoNetworkId, type UtxoNetwork } from '../core/utxoNetworks.ts';
import { exactUtxoResponseFetch } from '../core/utxoReadSession.ts';
import { createNativeUtxoActivity } from '../custody/utxoActivity.ts';
import { createUtxoActivityReader } from '../core/utxoActivity.ts';
import { createUtxoBalanceReader } from '../core/utxoBalanceReader.ts';
import type { BalanceReader } from '../core/watchOnlyAuthority.ts';
import { createBalanceReader } from '../platformRpc.ts';
import { walletFetch } from './http';
import type { NativeImportView } from '../custody/importedAccounts.ts';
import type { NativeAccountView } from '../custody/accounts.ts';
import { openNativeWalletStorage } from '../storage/native';
import { ensureNativeCryptoReady } from './cryptoBootstrap';
import { NativeRecoveryCoordinator } from '../custody/recovery.ts';
import { NativeWalletRemoval } from '../custody/walletRemoval.ts';
import { readRecoveryInventory as readStoredRecoveryInventory, type RecoveryInventory } from '../custody/recoveryInventory.ts';
import type { OpenWalletStorage } from '../storage/types.ts';
import type { NativeNoteBackupRuntime, NativeNoteCapacityRuntime, NativeNoteInventory } from '../custody/noteBackupRuntime.ts';
import type { NativeUtxoSend } from '../custody/utxoSend.ts';

async function openStorage(expectedInstallationId?: string) {
  const crypto = await ensureNativeCryptoReady();
  return openNativeWalletStorage({
    randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); },
    async digest(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); },
  }, undefined, expectedInstallationId);
}

function custodyGuard() {
  const guard = custodyIdle.captureGuard();
  return () => { if (securityPreferences.getSnapshot().status !== 'ready') throw new Error('CANCELLED'); guard(); };
}
function factory(onStorageOpened?: (storage: OpenWalletStorage) => void, assertActive = custodyGuard()) {
  const scopedUtxoReader = (network: UtxoNetwork) => createUtxoBalanceReader({
    fetch: isCustomUtxoNetworkId(network.id) ? exactUtxoResponseFetch(walletFetch) : walletFetch,
  });
  return createKeyringRuntimeFactory({
    assertActive,
    prepareSmartAccount(network, accountIndex, managementAddress, signal, guard) {
      return new EvmTransferReadRpc(network, { fetch: walletFetch }).prepareSmartAccount(accountIndex, managementAddress, signal, guard);
    },
    readEvmRetirement(network, method, params, signal, guard) {
      return new EvmTransferReadRpc(network, { fetch: walletFetch }).retirementRead(method, params, signal, guard);
    },
    observeActivity(network, expected, signal, guard) {
      return new EvmTransferReadRpc(network, { fetch: walletFetch }).observation({ hash: expected.hash, from: expected.from, to: expected.to, nonce: expected.nonce }, signal, guard);
    },
    readUtxoAccount(id, xpub, signal, guard) {
      return scopedUtxoReader(id).readAccount(id, xpub, signal, guard);
    },
    readUtxoBalance(id, address, signal, guard) {
      return scopedUtxoReader(id).readBalance(id, address, signal, guard);
    },
    utxoFetch(input, init) {
      if (typeof input !== 'string' || !init) throw new Error('Invalid native Blockbook request');
      return walletFetch(input, init);
    },
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); },
    openStorage: async () => {
      const storage = await openStorage();
      onStorageOpened?.(storage);
      return storage;
    },
  });
}

/** Backend capability only; the recovery UI must own its lifecycle guard/disposal. */
export function createNativeRecoveryCoordinator(controllers: ReturnType<typeof createNativeWalletControllers>) {
  return new NativeRecoveryCoordinator({ owner: controllers.authority,
    async retireControllers() { controllers.disposeTokens(); controllers.disposeTransfers(); controllers.keyExport.dispose(); controllers.backup.dispose(); await controllers.disposeConnections(); },
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); }, openStorage, assertActive: custodyGuard() });
}

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  return new NativeCustodyAuthority(factory());
}

export function createNativeWalletControllers() {
  let runtime: KeyringRuntime | undefined;
  let ownedStorage: OpenWalletStorage | undefined;
  const assertActive = custodyGuard();
  const base = factory((storage) => { ownedStorage = storage; }, assertActive);
  const authority = new NativeCustodyAuthority({
    async open() { runtime = await base.open() as KeyringRuntime; return runtime; },
  }, { preferences: securityPreferences, assertActive });
  const connections = new NativeConnectionsController({
    source: authority,
    preparePlatform: prepareWalletConnectRuntime,
    async openHost() {
      if (!runtime) throw new CustodyOperationError('NOT_READY');
      return runtime.openConnectionHost();
    },
    projectId: process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '2385bd7fee9c23847638bb997c6f8409',
    checkSite: (origin) => blacklistService.checkUrl(origin),
    checkAddress: (address) => blacklistService.checkAddress(address),
    metadata: { name: 'Pali Wallet', description: 'Pali Wallet', url: 'https://paliwallet.com', icons: [] },
  });
  const removal = new NativeWalletRemoval({
    owner: authority,
    beforeSnapshot: async (guard) => { guard(); await connections.dispose(); guard(); },
    source: () => runtime && ownedStorage ? { runtime, storage: ownedStorage } : undefined,
    reopen: openStorage,
    async clearNativeSelection(check) {
      const { clearNativeAccountSelection } = await import('../platform.ts');
      await clearNativeAccountSelection(check);
    },
    assertActive,
  });
  const backup = new SeedBackupFlow(authority, () => runtime?.backup);
  const keyExport = new HdKeyExportFlow(authority, () => runtime?.keyExport);
  const readRpc = { fetch: walletFetch, registrations: () => authority.getCatalogue()?.networks };
  const evmBalances = createBalanceReader(readRpc);
  const balanceReader: BalanceReader = {
    readBalance: evmBalances.readBalance,
    readUtxoBalance(id, address, signal) {
      const snapshot = authority.getSnapshot();
      if (snapshot.phase !== 'ready' || snapshot.account?.network !== id ||
          snapshot.account.address !== address || !runtime?.readUtxoBalance)
        return Promise.reject(new CustodyOperationError('NOT_READY'));
      return runtime.readUtxoBalance(id, address, signal);
    },
  };
  const transfers = new NativeTransfers(authority, () => runtime?.transfers, { fetch: walletFetch });
  const tokens = new NativeTokens(
    authority, () => runtime?.tokens, createErc20Reader(readRpc), Date.now,
    () => authority.lock(), createOwnedTokenReader(walletFetch), createNftOwnershipReader(readRpc)
  );
  const activity = new NativeActivity(authority, () => runtime?.activity,
    new ActivityExplorerReader(walletFetch), new ActivityReceiptReader({ fetch: walletFetch }));
  const utxoActivity = createNativeUtxoActivity(authority, () => runtime,
    createUtxoActivityReader({ fetch: exactUtxoResponseFetch(walletFetch) }));
  const accounts: NativeAccountView = Object.freeze({
    getSnapshot: () => authority.getCatalogue(),
    getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener: () => void) => authority.subscribe(() => listener()),
    execute: (...args: Parameters<NativeAccountView['execute']>) => authority.manageAccounts(...args),
    supportsSmartAccounts: () => runtime?.accounts?.supportsSmartAccounts?.() === true,
    cancel: () => authority.cancelAccountOperation(),
  });
  const imports: NativeImportView = Object.freeze({
    previewUtxo: (...args: Parameters<NativeImportView['previewUtxo']>) => authority.previewUtxoImport(...args),
    submit: (...args: Parameters<NativeImportView['submit']>) => authority.importAccount(...args),
    cancel: () => authority.cancelAccountOperation(),
  });
  // Public counts from this owner's existing lease only; never retire or reopen it.
  const readRecoveryInventory = async (): Promise<RecoveryInventory> => {
    const storage = ownedStorage;
    if (!storage) throw new CustodyOperationError('CANCELLED');
    const revision = authority.getSnapshot().revision;
    const assertCurrent = () => {
      const snapshot = authority.getSnapshot();
      if (ownedStorage !== storage || snapshot.phase !== 'locked' || snapshot.revision !== revision)
        throw new CustodyOperationError('CANCELLED');
    };
    assertCurrent();
    const inventory = await readStoredRecoveryInventory(storage);
    assertCurrent();
    return inventory;
  };
  const noteRoute = (assertOwner: () => void) => {
    const selected = runtime;
    const initial = authority.getSnapshot();
    if (initial.phase !== 'ready' || !selected)
      throw new CustodyOperationError('NOT_READY');
    const catalogue = selected.catalogue;
    const assertCurrent = () => {
      const current = authority.getSnapshot();
      if (selected !== runtime || current.phase !== 'ready' || current.revision !== initial.revision)
        throw new CustodyOperationError('CANCELLED');
      return assertOwner();
    };
    async function observeFailure<T>(action: () => Promise<T>): Promise<T> {
      try { return await action(); }
      catch (cause) {
        if (selected === runtime && authority.getSnapshot() === initial && !catalogue.getSnapshot()) authority.lock();
        throw cause;
      }
    }
    return { selected, assertCurrent, observeFailure };
  };
  const resetActivity = async (assertOwner: () => void): Promise<void> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    await observeFailure(() => selected.resetActivity(assertCurrent, () => {
      transfers.cancelForActivityReset();
      activity.invalidate();
    }));
    assertCurrent();
    await activity.refresh();
    assertCurrent();
  };
  const openNoteBackup = async (assertOwner: () => void): Promise<NativeNoteBackupRuntime> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    const open = selected.openNoteBackup;
    if (!open) throw new CustodyOperationError('NOT_READY');
    const notes = await observeFailure(() => open(assertCurrent));
    return Object.freeze<NativeNoteBackupRuntime>({
      ...notes,
      prepareImport: (...args) => observeFailure(() => notes.prepareImport(...args)),
      exportEncrypted: (...args) => observeFailure(() => notes.exportEncrypted(...args)),
      verifyExport: (...args) => observeFailure(() => notes.verifyExport(...args)),
    });
  };
  const openUtxoSend = async (assertOwner: () => void): Promise<NativeUtxoSend> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    const open = selected.openUtxoSend;
    if (!open) throw new CustodyOperationError('NOT_READY');
    const send = await observeFailure(() => open(assertCurrent));
    return Object.freeze<NativeUtxoSend>({ ...send, confirm: (view) => observeFailure(() => send.confirm(view)) });
  };
  const openNoteCapacity = async (assertOwner: () => void): Promise<NativeNoteCapacityRuntime> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    const open = selected.openNoteCapacity;
    if (!open) throw new CustodyOperationError('NOT_READY');
    const capacity = await observeFailure(() => open(assertCurrent));
    return Object.freeze<NativeNoteCapacityRuntime>({
      getCapacity: () => observeFailure(capacity.getCapacity),
      setCapacity: (limit) => observeFailure(() => capacity.setCapacity(limit)),
    });
  };
  const readNoteInventory = async (assertOwner: () => void): Promise<NativeNoteInventory> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    const read = selected.readNoteInventory;
    if (!read) throw new CustodyOperationError('NOT_READY');
    const inventory = await observeFailure(() => read(assertCurrent));
    assertCurrent();
    return Object.freeze<NativeNoteInventory>({
      notes: inventory.notes,
      async revealNote(...args) {
        assertCurrent();
        const secret = await observeFailure(() => inventory.revealNote(...args));
        assertCurrent();
        return secret;
      },
    });
  };
  // Bound to the exact durable vault without handing its fingerprint to a view.
  const captureNoteFileOwner = async (assertOwner: () => void) => {
    const storage = ownedStorage;
    const selected = runtime;
    const readPair = async () => {
      const before = authority.getSnapshot();
      if (!storage || selected !== runtime || storage !== ownedStorage ||
          before.phase !== 'ready' || !selected?.openNoteBackup)
        throw new CustodyOperationError('NOT_READY');
      assertOwner();
      const pair = await storage.getWalletFingerprint();
      assertOwner();
      if (before !== authority.getSnapshot() || selected !== runtime || storage !== ownedStorage)
        throw new CustodyOperationError('CANCELLED');
      return pair;
    };
    const expected = await readPair();
    return async () => {
      if (await readPair() !== expected) throw new CustodyOperationError('CANCELLED');
    };
  };
  return { authority, connections: connections.view, disposeConnections: () => connections.dispose(), backup, keyExport, imports, accounts, activity, utxoActivity, balanceReader, resetActivity, readRecoveryInventory, openUtxoSend, openNoteBackup, openNoteCapacity, readNoteInventory, captureNoteFileOwner, removal, transfers: transfers.view, tokens: tokens.view,
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose() };
}
