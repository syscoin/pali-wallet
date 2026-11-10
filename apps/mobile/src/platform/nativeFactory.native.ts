import { createNativePrivacyServiceSettings } from './privacyServiceSettings.native';
import type { NativePrivacyControls } from '../privacy/privacyControls';
import type { NativeNoteMaintenanceRuntime , NativeNoteBackupRuntime, NativeNoteCapacityRuntime, NativeNoteInventory } from '../custody/noteBackupRuntime';
import type { NativeSlhDsaManagement } from '../smartAccount/slhDsaManagement';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard';
import { NativeLedgerAccounts } from '../custody/ledgerAccounts.ts';
import { createNativeSentryPublicKeyDeriver } from '../crypto/sentryPublicKey.native';
import { createNativeSentryCryptoExecutor } from '../crypto/sentryCrypto.native';
import type { NativeSentryApprovals } from '../custody/sentryApprovals';
import { Linking } from 'react-native';
import { createNativeNetworkView } from '../custody/networkView';
import { createNativeDappControlHost } from '../custody/dappControl';
import { createNativeDappRpcReadHost } from '../custody/dappRpcReads';
import { createNativeDappSentryHost } from '../custody/dappSentry';
import { createNativeDappSyscoinHost } from '../custody/dappSyscoin';
import { createNativeWatchAssetObserver, prepareNativeWatchAsset } from '../portfolio/nativeWatchAsset';
import { createNativeRecipientResolver } from '../portfolio/nativeRecipientResolver';
import { createNativeTrezorSessions } from '../hardware/trezorTransport.native';
import type { NativeTrezorSessions } from '../hardware/trezorSessions';
import type { NativeTrezorView, NativeTrezorSnapshot } from '../custody/trezorAccounts';
import { prepareWalletConnectRuntime } from './walletConnectRuntime';
import { createNativeDeviceUnlockCapability } from './deviceUnlockCredential.native';
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
import { findUtxoNetwork, isCustomUtxoNetworkId, type UtxoNetwork } from '../core/utxoNetworks.ts';
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
import type { NativeNoteImportRuntime } from '../custody/noteImport.ts';
import type { NativeUtxoSend } from '../custody/utxoSend.ts';
import type { NativeSentryKeyManagement } from '../custody/sentryKeyManagement.ts';
import type { NativeSentryNodeManagement } from '../custody/sentryNodeManagement.ts';
import type { NativePsbtRequest } from '../connections/psbtRequests.ts';

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
function factory(onStorageOpened?: (storage: OpenWalletStorage) => void, assertActive = custodyGuard(), deviceUnlock = createNativeDeviceUnlockCapability(), trezorSessions?: NativeTrezorSessions) {
  let privacySettings: ReturnType<typeof createNativePrivacyServiceSettings> | undefined;
  const getPrivacySettings = () => {
    if (!privacySettings) throw new CustodyOperationError('CANCELLED');
    return privacySettings;
  };
  const scopedUtxoReader = (network: UtxoNetwork) => createUtxoBalanceReader({
    fetch: isCustomUtxoNetworkId(network.id) ? exactUtxoResponseFetch(walletFetch) : walletFetch,
  });
  return createKeyringRuntimeFactory({
    privacyServiceSettings: {
      getOrigin: () => getPrivacySettings().getOrigin(),
      changeOrigin: (value, invalidate, expected, guard) => getPrivacySettings().changeOrigin(value, invalidate, expected, guard),
    },
    // Full native SLH primitive/cache qualification is required before activation.
    slhExecution: null,
    assertActive,
    deviceUnlock,
    deriveSentryPublicKey: createNativeSentryPublicKeyDeriver(),
    runSentryCrypto: createNativeSentryCryptoExecutor(null),
    trezorSessions,
    async createLedgerTransport(owner) {
      const { createNativeLedgerTransport } = await import('../hardware/ledgerTransport.native');
      owner.assertCurrent();
      return createNativeLedgerTransport(owner, {});
    },
    async openPrivacyPool(network, poolId, lifetime, assertCurrent) {
      const [{ createNativePrivacyPoolSync }, { createNativePublicSnapshotTransport },
        { createNativePublicMerkleExecutor }] = await Promise.all([
        import('../privacy/nativePrivacyPoolSync.ts'), import('../privacy/publicSnapshotNative.native.ts'),
        import('../crypto/native'),
      ]);
      assertCurrent();
      const settings = getPrivacySettings();
      const service = await settings.capture();
      assertCurrent();
      return createNativePrivacyPoolSync({ network, poolId, lifetime,
        service: { origin: service.origin, assertCurrent() { service.assertCurrent(); assertCurrent(); } },
        transport: createNativePublicSnapshotTransport(), executeMerkleBatch: createNativePublicMerkleExecutor() });
    },
    async openPrivacyWithdrawal(signal, assertCurrent) {
      const [{ provePrivacyWithdrawal }, { runNativePrivacyProof }, { createPrivacyRelayerClient }] = await Promise.all([
        import('../../../../source/utils/privacy/withdrawal.ts'),
        import('../../modules/pali-private-prover'),
        import('../../../../source/utils/privacy/relayers.ts'),
      ]);
      assertCurrent();
      if (signal.aborted) throw new CustodyOperationError('CANCELLED');
      const settings = getPrivacySettings();
      const service = await settings.capture();
      const check = () => {
        assertCurrent();
        service.assertCurrent();
        if (signal.aborted) throw new CustodyOperationError('CANCELLED');
      };
      check();
      return {
        fetcher: walletFetch as typeof fetch,
        prove: (request, options) => provePrivacyWithdrawal(request, {
          ...options,
          runProof: runNativePrivacyProof,
        }),
        relayers: createPrivacyRelayerClient({
          fetcher: walletFetch as typeof fetch,
          getDirectoryUrl: async () => { check(); return `${service.origin}/api/privacy/v1/relayers`; },
          getServiceRevision: settings.getRevision,
          assertServiceCurrent: (revision) => {
            settings.assertStable(revision);
            check();
          },
        }),
      };
    },
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
      privacySettings = createNativePrivacyServiceSettings(storage.keyringStorage);
      onStorageOpened?.(storage);
      return storage;
    },
  });
}

/** Backend capability only; the recovery UI must own its lifecycle guard/disposal. */
export function createNativeRecoveryCoordinator(controllers: ReturnType<typeof createNativeWalletControllers>) {
  return new NativeRecoveryCoordinator({ owner: controllers.authority,
    async retireControllers() { controllers.authentication.cancel(); controllers.disposeTokens(); controllers.disposeTransfers(); controllers.keyExport.dispose(); controllers.backup.dispose(); await controllers.disposeConnections(); },
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); }, openStorage, assertActive: custodyGuard() });
}

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  return new NativeCustodyAuthority(factory());
}

export function createNativeWalletControllers() {
  let runtime: KeyringRuntime | undefined;
  let ownedStorage: OpenWalletStorage | undefined;
  const assertActive = custodyGuard();
  const deviceUnlock = createNativeDeviceUnlockCapability();
  const trezorSessions = createNativeTrezorSessions({
    randomBytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  });
  const trezorListeners = new Set<() => void>();
  let unsubscribeTrezor: (() => void) | undefined;
  const base = factory((storage) => { ownedStorage = storage; }, assertActive, deviceUnlock, trezorSessions);
  const authority = new NativeCustodyAuthority({
    async open() {
      runtime = await base.open() as KeyringRuntime;
      unsubscribeTrezor?.();
      unsubscribeTrezor = runtime.trezor.subscribe(() => {
        for (const listener of trezorListeners) {
          try { listener(); } catch { /* UI observation cannot grant custody. */ }
        }
      });
      return runtime;
    },
  }, { preferences: securityPreferences, assertActive });
  const connectionNetworks = createNativeNetworkView(authority, { utxoSendAvailable: true, fetch: walletFetch });
  const recipientResolver = createNativeRecipientResolver({ source: authority, fetch: walletFetch });
  const observeWatchAsset = createNativeWatchAssetObserver({ fetch: walletFetch,
    registrations: () => authority.getCatalogue()?.networks ?? [] });
  const readRegistration = () => {
    const state = authority.getSnapshot(), catalogue = authority.getCatalogue();
    const network = catalogue?.networks.find(item => item.id === state.account?.network);
    if (state.phase !== 'ready' || !state.account || !network || catalogue?.active.networkId !== network.id)
      throw new CustodyOperationError('CANCELLED');
    return network;
  };
  const controls = createNativeDappControlHost({
    utxoNetworks: () => authority.getCatalogue()?.utxoNetworks ?? [],
    networks: connectionNetworks,
    fetch: walletFetch,
    context() {
      const state = authority.getSnapshot(), catalogue = authority.getCatalogue();
      const control = runtime?.catalogue.getControlSnapshot();
      if (state.phase !== 'ready' || !state.account || !catalogue || !control || catalogue.revision !== control.revision || catalogue.active.accountId !== control.active.accountId || catalogue.active.networkId !== state.account.network || control.active.networkId !== state.account.network)
        return null;
      const networkLabel = findUtxoNetwork(state.account.network, catalogue.utxoNetworks)?.name ??
        catalogue.networks.find(item => item.id === state.account!.network)?.name ?? 'Network';
      return { activeAccountId: control.active.accountId, networkId: control.active.networkId,
        revision: state.revision, catalogueRevision: control.revision, networkLabel, accounts: control.accounts };
    },
    previewNetworkSelection(id, expectedRevision) {
      if (!runtime) throw new CustodyOperationError('NOT_READY');
      return runtime.catalogue.previewNetworkSelection(id, expectedRevision);
    },
    prepareWatchAsset: (request, owner, signal, check) => prepareNativeWatchAsset(request, owner, signal, check, {
      source: authority, runtime: () => runtime?.tokens, observe: observeWatchAsset,
    }),
  });
  const sentryRequests = createNativeDappSentryHost({
    async openApprovals() {
      const captured = runtime;
      if (!captured || authority.getSnapshot().phase !== 'ready') throw new CustodyOperationError('NOT_READY');
      const manager = await captured.openConnectionSentryApprovals();
      if (runtime !== captured || authority.getSnapshot().phase !== 'ready') throw new CustodyOperationError('CANCELLED');
      return manager;
    },
    openNodes: (...args) => sentry.openNodes(...args),
  });
  const syscoin = createNativeDappSyscoinHost({ source: authority, fetch: walletFetch,
    readPublic(method, owner, isChange, signal, check) {
      if (!runtime) throw new CustodyOperationError('NOT_READY');
      return runtime.readConnectionUtxoPublic(method, owner, isChange, signal, check);
    } });
  const connections = new NativeConnectionsController({
    source: authority,
    activateAccount: (accountId, revision, guard) => authority.selectConnectionAccount(accountId, revision, guard),
    preparePlatform: prepareWalletConnectRuntime,
    async openHost() {
      if (!runtime) throw new CustodyOperationError('NOT_READY');
      const captured = runtime, connection = await captured.openConnectionHost();
      if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
      const reads = createNativeDappRpcReadHost({ fetch: walletFetch, registration: readRegistration,
        verifyPersonalMessage(message, signature) {
          if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
          return connection.verifyPersonalMessage(message, signature);
        } });
      return Object.freeze({ ...connection, controls, reads, syscoin, sentry: sentryRequests,
        psbt: { cancelHandoff: (job: object) => {
          return connection.cancelSigningHandoff(job);
        }, prepare: (request: NativePsbtRequest, signal: AbortSignal, check: () => void, handoff: import('../connections/signingHandoff.ts').NativeSigningHandoff) => {
          if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
          return captured.prepareConnectionPsbt(request, signal, () => {
            check(); if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
          }, handoff);
        } } });
    },
    openExternalUrl: (url) => Linking.openURL(url),
    projectId: process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '2385bd7fee9c23847638bb997c6f8409',
    checkSite: (origin) => blacklistService.checkUrl(origin),
    checkAddress: (address) => blacklistService.checkAddress(address),
    metadata: { name: 'Pali Wallet', description: 'Pali Wallet', url: 'https://paliwallet.com', icons: [] },
  });
  const ledger = new NativeLedgerAccounts(authority, () => runtime?.ledger, 'import');
  const ledgerConnection = new NativeLedgerAccounts(authority, () => runtime?.ledger, 'connect');
  const emptyTrezor: NativeTrezorSnapshot = Object.freeze({
    phase: 'idle', operation: null, networkLabel: '', accountLabel: '', address: null, error: null,
  });
  const requireTrezor = () => {
    if (!runtime) throw new CustodyOperationError('NOT_READY');
    return runtime.trezor;
  };
  const importTrezor = async (label: string, resume: boolean) => {
    const before = authority.getSnapshot();
    const catalogue = authority.getCatalogue();
    if (before.phase !== 'ready' || !catalogue)
      throw new CustodyOperationError('NOT_READY');
    const control = requireTrezor();
    if (resume) await control.resumeImport();
    else await control.startImport(label);
    await authority.manageAccounts(
      { kind: 'import-trezor', label }, before.revision, catalogue.revision
    );
  };
  const trezor: NativeTrezorView = Object.freeze({
    getSnapshot: () => runtime?.trezor.getSnapshot() ?? emptyTrezor,
    subscribe(listener: () => void) {
      trezorListeners.add(listener);
      return () => { trezorListeners.delete(listener); };
    },
    startImport: (label: string) => importTrezor(label, false),
    resumeImport: () => importTrezor(requireTrezor().getSnapshot().accountLabel, true),
    resumeSend: () => requireTrezor().resumeSend(),
    cancel: () => requireTrezor().cancel(),
  });
  const disposeConnections = async () => {
    unsubscribeTrezor?.(); unsubscribeTrezor = undefined;
    const results = await Promise.allSettled([connections.dispose(), ledger.dispose(), ledgerConnection.dispose(), trezorSessions.dispose()]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  };
  const removal = new NativeWalletRemoval({
    owner: authority,
    beforeSnapshot: async (guard) => { guard(); await disposeConnections(); guard(); },
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
      if (current === initial && !catalogue.getSnapshot()) {
        authority.lock();
        throw new CustodyOperationError('CANCELLED');
      }
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
  const sentry = Object.freeze({
    available: () => authority.getSnapshot().phase === 'ready' && !!runtime?.getSentryKeyNetwork?.(),
    signingAvailable: () => authority.getSnapshot().phase === 'ready' && !!runtime?.getSentryKeyNetwork?.() && !!runtime.openSentryApprovals,
    async openApprovals(lifetime: AbortSignal, assertOwner: () => void): Promise<NativeSentryApprovals> {
      const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
      const open = selected.openSentryApprovals;
      if (!open) throw new CustodyOperationError('NOT_READY');
      const manager = await observeFailure(() => open(lifetime, assertCurrent));
      try { assertCurrent(); if (lifetime.aborted) throw new CustodyOperationError('CANCELLED'); }
      catch (cause) { manager.dispose(); throw cause; }
      return Object.freeze({ ...manager,
        votes: Object.freeze({ ...manager.votes, sign: (...args: Parameters<typeof manager.votes.sign>) => observeFailure(() => manager.votes.sign(...args)) }),
        operations: Object.freeze({ ...manager.operations, sign: (...args: Parameters<typeof manager.operations.sign>) => observeFailure(() => manager.operations.sign(...args)) }),
      });
    },
    async openKeys(lifetime: AbortSignal, assertOwner: () => void): Promise<NativeSentryKeyManagement> {
      const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
      const open = selected.openSentryKeyManagement;
      if (!open) throw new CustodyOperationError('NOT_READY');
      const manager = await observeFailure(() => open(lifetime, assertCurrent));
      try { assertCurrent(); if (lifetime.aborted) throw new CustodyOperationError('CANCELLED'); }
      catch (cause) { manager.dispose(); throw cause; }
      return Object.freeze<NativeSentryKeyManagement>({
        ...manager,
        confirmImport: (...args) => observeFailure(() => manager.confirmImport(...args)),
        confirmRemoval: (...args) => observeFailure(() => manager.confirmRemoval(...args)),
        saveSettings: (...args) => observeFailure(() => manager.saveSettings(...args)),
      });
    },
    async openNodes(lifetime: AbortSignal, assertOwner: () => void): Promise<NativeSentryNodeManagement> {
      const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
      const open = selected.openSentryNodeManagement;
      if (!open) throw new CustodyOperationError('NOT_READY');
      const manager = await observeFailure(() => open(lifetime, assertCurrent));
      try { assertCurrent(); if (lifetime.aborted) throw new CustodyOperationError('CANCELLED'); }
      catch (cause) { manager.dispose(); throw cause; }
      return Object.freeze<NativeSentryNodeManagement>({
        ...manager,
        confirmLink: (...args) => observeFailure(() => manager.confirmLink(...args)),
        releaseCollateral: (...args) => observeFailure(() => manager.releaseCollateral(...args)),
      });
    },
  });
  const readGuardianRecovery = async (signal: AbortSignal, assertOwner: () => void) => {
    const { assertCurrent, observeFailure } = noteRoute(assertOwner);
    const snapshot = authority.getSnapshot();
    const catalogue = authority.getCatalogue();
    const account = catalogue?.accounts.find(entry => entry.id === catalogue.active.accountId);
    const network = catalogue?.networks.find(entry => entry.id === snapshot.account?.network);
    if (
      !network || !account || account.type !== 'SmartAccount' ||
      account.smartAccount?.chainId !== Number(network.chainId) ||
      catalogue?.active.networkId !== network.id ||
      account.address.toLowerCase() !== snapshot.account?.address.toLowerCase()
    ) throw new CustodyOperationError('NOT_READY');
    const owner = new AbortController();
    const abort = () => owner.abort();
    const check = () => {
      assertActive();
      assertCurrent();
      if (signal.aborted || owner.signal.aborted || authority.getCatalogue() !== catalogue)
        throw new CustodyOperationError('CANCELLED');
    };
    signal.addEventListener('abort', abort, { once: true });
    const unsubscribe = authority.subscribe(() => {
      try { check(); } catch { abort(); }
    });
    try {
      check();
      const result = await observeFailure(() =>
        new EvmTransferReadRpc(network, { fetch: walletFetch })
          .readGuardianRecoveryStatus(account.address, owner.signal, check));
      check();
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      unsubscribe();
      owner.abort();
    }
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
  const openSmartAccountDeployment = async (assertOwner: () => void) => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    return observeFailure(() => selected.openSmartAccountDeployment(assertCurrent));
  };
  const openSlhDsaManagement = async (signal: AbortSignal, assertOwner: () => void): Promise<NativeSlhDsaManagement> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (signal.aborted) throw Error('CANCELLED'); };
    check();
    const account = await selected.openSlhDsaAccount(check); check();
    const catalogue = authority.getCatalogue(), snapshot = authority.getSnapshot();
    if (!catalogue || !snapshot.account) throw Error('CANCELLED');
    const network = catalogue.networks.find(network => network.id === catalogue.active.networkId);
    if (!network) throw Error('CANCELLED');
    return Object.freeze({
      accountAddress: snapshot.account.address, networkName: network.name,
      isDeployed: catalogue.accounts.find(account => account.id === catalogue.active.accountId)?.smartAccount?.isDeployed === true,
      installedKeys: account.installedKeys,
      readPrepared: () => observeFailure(() => account.readPrepared()),
      prepareFresh: progress => observeFailure(() => account.prepareFresh(progress)),
      hydrateInstalled: keyId => observeFailure(() => account.hydrateInstalled(keyId)),
      rebuildInstalled: (keyId, progress) => observeFailure(() => account.rebuildInstalled(keyId, progress)),
      rebuildPrepared: (keyId, progress) => observeFailure(() => account.rebuildPrepared(keyId, progress)),
      async openInstall(keyId, operationSignal, assertView) {
        const guard = () => { assertSynchronousEvmFeeGuard(check); assertSynchronousEvmFeeGuard(assertView); if (operationSignal.aborted) throw Error('CANCELLED'); };
        guard();
        const operation = await observeFailure(() => selected.openSlhDsaInstallation(keyId, operationSignal, guard));
        try { guard(); return operation; } catch (error) { await operation.dispose(); throw error; }
      },
    });
  };
  const openWalletAuthenticator = async (signal: AbortSignal, assertOwner: () => void) => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    return observeFailure(() => selected.openWalletAuthenticator(signal, assertCurrent));
  };
  const openSmartAccountSend = async (recipient: string, amount: Parameters<KeyringRuntime['openSmartAccountSend']>[1], assertOwner: () => void) => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    return observeFailure(() => selected.openSmartAccountSend(recipient, amount, assertCurrent));
  };
  const guardianRecovery = Object.freeze({
    hasIntent: () => authority.getSnapshot().phase === 'ready' && !!runtime?.getGuardianRecoveryIntent(),
    async open(draft: Parameters<KeyringRuntime['openGuardianRecovery']>[0], signal: AbortSignal, assertOwner: () => void) {
      const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
      return observeFailure(() => selected.openGuardianRecovery(draft, signal, assertCurrent));
    },
  });
  const openGuardianPolicy = async (draft: Parameters<KeyringRuntime['openGuardianPolicy']>[0], signal: AbortSignal, assertOwner: () => void) => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    return observeFailure(() => selected.openGuardianPolicy(draft, signal, assertCurrent));
  };
  const inspectGuardianRemoval = async (signal: AbortSignal, assertOwner: () => void) => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    return observeFailure(() => selected.inspectGuardianRemoval(signal, assertCurrent));
  };
  const openUtxoSend = async (assertOwner: () => void): Promise<NativeUtxoSend> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    const open = selected.openUtxoSend;
    if (!open) throw new CustodyOperationError('NOT_READY');
    const send = await observeFailure(() => open(assertCurrent));
    return Object.freeze<NativeUtxoSend>({ ...send, confirm: (view) => observeFailure(() => send.confirm(view)) });
  };
  const openNoteMaintenance = async (signal: AbortSignal, assertOwner: () => void): Promise<NativeNoteMaintenanceRuntime> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    if (!selected.openNoteMaintenance) throw new CustodyOperationError('NOT_READY');
    const value = await observeFailure(() => selected.openNoteMaintenance!(signal, assertCurrent));
    return Object.freeze({
      dispose: value.dispose,
      getNotes: guard => observeFailure(() => value.getNotes(guard)),
      clearCompletedNote: (id, guard) => observeFailure(() => value.clearCompletedNote(id, guard)),
      recoverFailedWithdrawal: (id, password, guard) => observeFailure(() => value.recoverFailedWithdrawal(id, password, guard)),
    });
  };
  const openPrivacyControls = async (signal: AbortSignal, assertOwner: () => void): Promise<NativePrivacyControls> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    if (!selected.openPrivacyControls) throw new CustodyOperationError('NOT_READY');
    return observeFailure(() => selected.openPrivacyControls!(signal, assertCurrent));
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
      ...(inventory.checkNote ? { checkNote: (...args: Parameters<NonNullable<NativeNoteInventory['checkNote']>>) => observeFailure(() => inventory.checkNote!(...args)) } : {}),
      ...(inventory.openWithdrawal ? {
        async openWithdrawal(...[note, signal, assertViewCurrent]: Parameters<NonNullable<NativeNoteInventory['openWithdrawal']>>) {
          const check = () => { assertCurrent(); return assertViewCurrent(); };
          check();
          const view = await observeFailure(() => inventory.openWithdrawal!(note, signal, check));
          try { check(); return view; }
          catch (error) { await view.dispose(); throw error; }
        },
      } : {}),
      async revealNote(...args) {
        assertCurrent();
        const secret = await observeFailure(() => inventory.revealNote(...args));
        assertCurrent();
        return secret;
      },
    });
  };
  const openPrivateDeposit = async (signal: AbortSignal, assertOwner: () => void) => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    if (!selected.openPrivateDeposit) throw new CustodyOperationError('NOT_READY');
    return observeFailure(() => selected.openPrivateDeposit!(signal, assertCurrent));
  };
  const openNoteImport = async (assertOwner: () => void): Promise<NativeNoteImportRuntime> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    if (!selected.openNoteImport) throw new CustodyOperationError('NOT_READY');
    const importer = await observeFailure(() => selected.openNoteImport!(assertCurrent));
    return Object.freeze({
      importNote: (note) => observeFailure(() => importer.importNote(note)),
      dispose: importer.dispose,
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
  return { authority, sentry, recipientResolver, openSlhDsaManagement, canManageSlhDsa: () => runtime?.canManageSlhDsa() === true, canSignSmartAccount: () => runtime?.canSignSmartAccount() === true, guardianRecovery, authentication: deviceUnlock.prompt, ledger, ledgerConnection, trezor, connections: connections.view, disposeConnections, backup, keyExport, imports, accounts, activity, utxoActivity, balanceReader, readGuardianRecovery, openGuardianPolicy, inspectGuardianRemoval, canManageGuardianPolicy: () => runtime?.canManageGuardianPolicy() === true, canUseWalletAuthenticator: () => runtime?.canUseWalletAuthenticator() === true, openWalletAuthenticator, resetActivity, readRecoveryInventory, openSmartAccountDeployment, openSmartAccountSend, openUtxoSend, openNoteBackup, openNoteCapacity, openNoteMaintenance, openPrivacyControls, readNoteInventory, openNoteImport, openPrivateDeposit, captureNoteFileOwner, removal, transfers: transfers.view, tokens: tokens.view,
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose() };
}
