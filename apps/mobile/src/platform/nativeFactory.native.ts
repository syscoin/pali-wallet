import { createNativePasskeyCapability, isNativePasskeyPromptActive } from './nativePasskeys';
import { nativeActivityNotifications } from '../notifications/service';
import { parseNativeAccountId } from '../custody/accountIdentity';
import { nativeNotificationChoices } from '../notifications/choices';
import { bindNativePrivateAuthentication, bindNativePrivateAuthenticationChild, createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication.ts';
import type { NativeSmartModuleManagement } from '../smartAccount/moduleManagement.ts';
import { createNativePrivacyServiceSettings } from './privacyServiceSettings.native';
import type { NativePrivacyControls } from '../privacy/privacyControls';
import type { NativeNoteMaintenanceRuntime , NativeNoteBackupRuntime, NativeNoteCapacityRuntime, NativeNoteInventory } from '../custody/noteBackupRuntime';
import type { NativeSlhDsaManagement } from '../smartAccount/slhDsaManagement';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard';
import { NativeLedgerAccounts } from '../custody/ledgerAccounts.ts';
import { createNativeSentryPublicKeyDeriver } from '../crypto/sentryPublicKey.native';
import { createNativeSentryCryptoExecutor } from '../crypto/sentryCrypto.native';
import { createNativeSlhCapability } from '../crypto/native';
import type { NativeSentryApprovals } from '../custody/sentryApprovals';
import { AppState, Linking } from 'react-native';
import { createNativeNetworkView } from '../custody/networkView';
import { createNativeDappControlHost } from '../custody/dappControl';
import { createNativeDappRpcReadHost } from '../custody/dappRpcReads';
import { createNativeWalletReadHost, walletTokenScope } from '../custody/dappWalletReads';
import { projectWalletTokenBalanceUnits, projectWalletTokens, type DappWalletTokens } from '../../../../source/shared/dappWalletReads';
import { formatTokenUnits } from '../../../../source/shared/erc20';
import { sptBalanceTotalUnits } from '../../../../source/shared/sptInventory';
import type { NativeConnectionAccount } from '../connections/host';
import type { UtxoBalance } from '../core/utxoBalanceReader';
import { createNativeDappSentryHost } from '../custody/dappSentry';
import { createNativeDappSyscoinHost } from '../custody/dappSyscoin';
import { createNativeWatchAssetObserver, prepareNativeWatchAsset } from '../portfolio/nativeWatchAsset';
import { createNativeRecipientResolver } from '../portfolio/nativeRecipientResolver';
import { createNativeTrezorSessions } from '../hardware/trezorTransport.native';
import type { NativeTrezorSessions } from '../hardware/trezorSessions';
import type { NativeTrezorView, NativeTrezorSnapshot } from '../custody/trezorAccounts';
import { prepareWalletConnectRuntime } from './walletConnectRuntime';
import { isNonBackgroundNativePromptActive } from './credentialPort.ts';
import { createNativeCredentialPort, isNativeCredentialPromptActive, nativeCredentialAuthentication } from './credential.native';
import { NativeConnectionsController } from '../connections/controller.ts';
import { blacklistService } from '../../../../source/utils/security/blacklistService';
import { EvmTransferReadRpc } from '../custody/evmTransferReadRpc.ts';
import { custodyIdle, securityPreferences, publicViewLock } from './security';
import { CustodyOperationError, NativeCustodyAuthority } from '../custody/authority.ts';
import { createKeyringRuntimeFactory } from '../custody/keyringRuntime.ts';
import type { KeyringRuntime } from '../custody/keyringRuntime.ts';
import { SeedBackupFlow } from '../custody/seedBackup.ts';
import { HdKeyExportFlow, type NativeHdKeyExportRuntime } from '../custody/hdKeyExport.ts';
import { NativeTransfers } from '../custody/transfers.ts';
import { NativeTokens } from '../portfolio/nativeTokens.ts';
import { createScopedPortfolioAssetReader } from '../portfolio/scopedPortfolioAssets.ts';
import type { NativeNotificationScope } from '../notifications/types.ts';
import { NativeActivity } from '../activity/nativeActivity.ts';
import { ActivityExplorerReader } from '../activity/explorerReader.ts';
import { ActivityReceiptReader } from '../activity/receiptReader.ts';
import { createErc20Reader } from '../portfolio/erc20ReadRpc.ts';
import { createNftEnumerationReader, createNftOwnershipReader } from '../portfolio/nftOwnershipReadRpc.ts';
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

// Passkey browser handoffs do not inherit the OS credential Activity exception.
const isBoundNativePasskeyPromptActive = (owner?: AbortSignal) => isNonBackgroundNativePromptActive(AppState.currentState, () => isNativePasskeyPromptActive(owner));

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
function factory(onStorageOpened?: (storage: OpenWalletStorage) => void, assertActive = custodyGuard(), credentialPort = createNativeCredentialPort(), trezorSessions?: NativeTrezorSessions) {
  let crypto: Crypto | undefined;
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
    slhExecution: createNativeSlhCapability(bytes => {
      if (!crypto) throw new CustodyOperationError('NOT_READY');
      crypto.getRandomValues(bytes);
    }),
    passkeys: createNativePasskeyCapability(),
    assertActive,
    credentialPort,
    isAuthenticationActive: isNativeCredentialPromptActive,
    deriveSentryPublicKey: createNativeSentryPublicKeyDeriver(),
    runSentryCrypto: createNativeSentryCryptoExecutor(),
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
    ensureCryptoReady: async () => { crypto = await ensureNativeCryptoReady(); },
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
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); }, openStorage, assertActive: custodyGuard(), credentialPort: createNativeCredentialPort(), isAuthenticationActive: isNativeCredentialPromptActive });
}

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  return new NativeCustodyAuthority(factory(), { preferences: securityPreferences, assertActive: custodyGuard(), viewLock: publicViewLock });
}

export function createNativeWalletControllers() {
  let runtime: KeyringRuntime | undefined;
  const tokenObservations = new WeakMap<KeyringRuntime, Map<string, DappWalletTokens>>();
  const observations = (owner: KeyringRuntime) => {
    let values = tokenObservations.get(owner);
    if (!values) { values = new Map(); tokenObservations.set(owner, values); }
    return values;
  };
  const rememberTokens = (owner: KeyringRuntime, key: string, value: DappWalletTokens) => {
    const values = observations(owner);
    values.delete(key); values.set(key, projectWalletTokens(value, { kind: 'all' }) as DappWalletTokens);
    if (values.size > 128) values.delete(values.keys().next().value!);
  };
  const rememberUtxo = (owner: KeyringRuntime, account: Pick<NativeConnectionAccount, 'id' | 'address'>, network: UtxoNetwork, value: UtxoBalance) => {
    rememberTokens(owner, walletTokenScope(account.id, account.address, network), { ethereum: [], syscoin: (value.assets ?? []).map(asset => ({
      assetGuid: asset.assetGuid, chainId: network.chainId, decimals: asset.decimals, symbol: asset.symbol,
      balance: formatTokenUnits(sptBalanceTotalUnits(asset), asset.decimals),
    })) });
  };
  let ownedStorage: OpenWalletStorage | undefined;
  const assertActive = custodyGuard();
  const credentialPort = createNativeCredentialPort();
  const trezorSessions = createNativeTrezorSessions({
    randomBytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  });
  const trezorListeners = new Set<() => void>();
  let unsubscribeTrezor: (() => void) | undefined;
  const base = factory((storage) => { ownedStorage = storage; }, assertActive, credentialPort, trezorSessions);
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
  }, { preferences: securityPreferences, assertActive, viewLock: publicViewLock });
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
    async openNodes(...args) {
      const authentication = createNativePrivateAuthenticationScope();
      try {
        const nodes = await sentry.openNodes(...args, authentication);
        return Object.freeze({ ...nodes, dispose() { authentication.retire(); nodes.dispose(); } });
      } catch (error) { authentication.retire(); throw error; }
    },
  });
  const syscoin = createNativeDappSyscoinHost({ source: authority, fetch: walletFetch,
    readPublic(method, owner, isChange, signal, check) {
      if (!runtime) throw new CustodyOperationError('NOT_READY');
      return runtime.readConnectionUtxoPublic(method, owner, isChange, signal, check);
    } });
  const connections = new NativeConnectionsController({
    bindAuthentication(scope, check) {
      const captured = runtime;
      if (!captured) throw new CustodyOperationError('NOT_READY');
      return bindNativePrivateAuthentication(scope, {
        assertCurrent() {
          if (runtime !== captured || !captured.catalogue.getSnapshot()) throw new CustodyOperationError('CANCELLED');
          assertSynchronousEvmFeeGuard(check);
        },
        isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner),
      });
    },
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
      const walletReads = createNativeWalletReadHost({ fetch: walletFetch,
        network: () => {
          if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
          return connection.context().network.kind === 'syscoin' ? syscoin.registration() : readRegistration();
        },
        loadTokens: (accountId, networkId, check) => {
          if (runtime !== captured || !connection.readWalletTokenInventory) throw new CustodyOperationError('CANCELLED');
          return connection.readWalletTokenInventory(accountId, networkId, check);
        },
        cachedTokens: key => observations(captured).get(key),
        observeUtxo: (account, network, value) => { if (runtime === captured) rememberUtxo(captured, account, network, value); },
      });
      return Object.freeze({ ...connection, controls, reads, walletReads, syscoin, sentry: sentryRequests,
        allocateSmartAccount: (...args: Parameters<typeof connection.allocateSmartAccount>) => {
          if (runtime !== captured) return Promise.reject(new CustodyOperationError('CANCELLED'));
          const [input, signal, check, committed, authentication] = args;
          return authority.allocateConnectionSmartAccount(input, signal, () => {
            assertSynchronousEvmFeeGuard(check); if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
          }, committed, authentication);
        },
        psbt: { cancelHandoff: (job: object) => {
          return connection.cancelSigningHandoff(job);
        }, prepare: (request: NativePsbtRequest, signal: AbortSignal, check: () => void, handoff: import('../connections/signingHandoff.ts').NativeSigningHandoff, authentication: import('../custody/privateAuthentication.ts').NativePrivateAuthentication | null) => {
          if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
          return captured.prepareConnectionPsbt(request, signal, () => {
            check(); if (runtime !== captured) throw new CustodyOperationError('CANCELLED');
          }, handoff, authentication);
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
    phase: 'idle', operation: null, networkLabel: '', accountLabel: '', address: null, signer: null, error: null,
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
    background: () => { if (runtime) runtime.trezor.background(); },
    cancel: async () => { await requireTrezor().cancel(); },
  });
  const disposeConnections = async () => {
    unsubscribeTrezor?.(); unsubscribeTrezor = undefined;
    const results = await Promise.allSettled([connections.dispose(), ledger.dispose(), ledgerConnection.dispose(), trezorSessions.dispose()]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  };
  const removal = new NativeWalletRemoval({
    owner: authority,
    beforeSnapshot: async (guard) => {
      guard();
      await nativeActivityNotifications.replaceAccountTypes(['HDAccount', 'Imported', 'SmartAccount', 'Ledger', 'Trezor'], [], guard);
      guard(); await disposeConnections(); guard();
    },
    source: () => runtime && ownedStorage ? { runtime, storage: ownedStorage } : undefined,
    bindAuthentication: (scope, assertOwner) => bindNativePrivateAuthentication(scope, {
      assertCurrent: assertOwner,
      isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner),
    }),
    reopen: openStorage,
    async clearNativeSelection(check) {
      const { clearNativeAccountSelection } = await import('../platform.ts');
      await clearNativeAccountSelection(check);
    },
    assertActive,
  });
  const backup = new SeedBackupFlow(authority, () => runtime?.backup);
  const bindOperationAuthentication = (scope: NativePrivateAuthenticationScope, selected: KeyringRuntime) =>
    bindNativePrivateAuthentication(scope, {
      assertCurrent() { if (runtime !== selected || !selected.catalogue.getSnapshot()) throw new CustodyOperationError('CANCELLED'); },
      isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner),
    });
  const saveIdlePreference = (expected: import('../core/securityPreferences').SecurityPreferenceSnapshot, minutes: number,
    signal: AbortSignal, authentication: NativePrivateAuthenticationScope, assertCurrent: () => void) => {
    if (!runtime) return Promise.reject(new CustodyOperationError('NOT_READY'));
    return authority.saveIdlePreference(expected, minutes, signal, bindOperationAuthentication(authentication, runtime), assertCurrent);
  };
  const keyExportFacades = new WeakMap<KeyringRuntime, NativeHdKeyExportRuntime>();
  const keyExport = new HdKeyExportFlow(authority, () => {
    const selected = runtime;
    if (!selected?.keyExport) return undefined;
    let facade = keyExportFacades.get(selected);
    if (!facade) {
      const port = selected.keyExport;
      facade = Object.freeze<NativeHdKeyExportRuntime>({ isAuthenticationRefusal: port.isAuthenticationRefusal,
        readSelected: (scope, signal, guard, authentication) => port.readSelected(scope, signal, guard, bindOperationAuthentication(authentication, selected)) });
      keyExportFacades.set(selected, facade);
    }
    return facade;
  });
  const readRpc = { fetch: walletFetch, registrations: () => authority.getCatalogue()?.networks };
  const evmBalances = createBalanceReader(readRpc);
  const balanceReader: BalanceReader = {
    readBalance: evmBalances.readBalance,
    async readUtxoBalance(id, address, signal) {
      const snapshot = authority.getSnapshot();
      const captured = runtime, catalogue = authority.getCatalogue();
      if (snapshot.phase !== 'ready' || snapshot.account?.network !== id ||
          snapshot.account.address !== address || !runtime?.readUtxoBalance)
        return Promise.reject(new CustodyOperationError('NOT_READY'));
      const value = await runtime.readUtxoBalance(id, address, signal);
      const network = catalogue && findUtxoNetwork(id, catalogue.utxoNetworks);
      if (captured && captured === runtime && authority.getSnapshot() === snapshot && network)
        rememberUtxo(captured, { id: catalogue!.active.accountId, address }, network, value);
      return value;
    },
  };
  const transfers = new NativeTransfers(authority, () => runtime?.transfers, { fetch: walletFetch });
  const tokens = new NativeTokens(
    authority, () => runtime?.tokens, createErc20Reader(readRpc), Date.now,
    () => authority.lock(), createOwnedTokenReader(walletFetch), createNftOwnershipReader(readRpc), createNftEnumerationReader(readRpc)
  );
  const stopTokenObservation = tokens.view.subscribe(() => {
    const value = tokens.view.getSnapshot(), catalogue = authority.getCatalogue(), state = authority.getSnapshot(), owner = runtime;
    const network = catalogue?.networks.find(item => item.id === value.account?.network);
    if (!owner || !catalogue || !value.account || !network || state.revision !== value.account.revision ||
        state.account?.address !== value.account.address || catalogue.active.networkId !== value.account.network) return;
    if (!Number.isSafeInteger(Number(network.chainId))) return;
    rememberTokens(owner, walletTokenScope(catalogue.active.accountId, value.account.address, network), { syscoin: [],
      ethereum: value.items.map(item => ({ chainId: Number(network.chainId), contractAddress: item.metadata.contractAddress,
        decimals: item.metadata.decimals, isNft: false, name: item.metadata.name, tokenSymbol: item.metadata.symbol,
        ...(item.status === 'available' && item.units !== null ? { rawBalance: item.units, balance: projectWalletTokenBalanceUnits(item.units, item.metadata.decimals) } : {}) })) });
  });
  const activity = new NativeActivity(authority, () => runtime?.activity,
    new ActivityExplorerReader(walletFetch), new ActivityReceiptReader({ fetch: walletFetch }));
  const utxoActivity = createNativeUtxoActivity(authority, () => runtime,
    createUtxoActivityReader({ fetch: exactUtxoResponseFetch(walletFetch) }));
  const accounts: NativeAccountView = Object.freeze({
    getSnapshot: () => authority.getCatalogue(),
    getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener: () => void) => authority.subscribe(() => listener()),
    execute: async (...args: Parameters<NativeAccountView['execute']>) => {
      if (args[0].kind === 'remove') {
        const before = authority.getSnapshot(), catalogue = authority.getCatalogue();
        if (before.revision !== args[1] || catalogue?.revision !== args[2]) throw new CustodyOperationError('CANCELLED');
        await nativeActivityNotifications.disableOwner(parseNativeAccountId(args[0].id).type, args[0].id);
        if (authority.getSnapshot() !== before || authority.getCatalogue() !== catalogue) throw new CustodyOperationError('CANCELLED');
      }
      return authority.manageAccounts(...args);
    },
    supportsSmartAccounts: () => runtime?.accounts?.supportsSmartAccounts?.() === true,
    cancel: () => authority.cancelAccountOperation(),
  });
  const imports: NativeImportView = Object.freeze<NativeImportView>({
    previewUtxo: (...args: Parameters<NativeImportView['previewUtxo']>) => authority.previewUtxoImport(...args),
    submit: (input, revision, catalogueRevision, signal, authentication) => {
      if (!runtime) return Promise.reject(new CustodyOperationError('NOT_READY'));
      return authority.importAccount(input, revision, catalogueRevision, signal, bindOperationAuthentication(authentication, runtime));
    },
    cancel: () => authority.cancelAccountOperation(),
  });
  // Public counts from this owner's existing lease only; never retire or reopen it.
  const readRecoveryInventory = async (): Promise<RecoveryInventory> => {
    const storage = ownedStorage;
    if (!storage) throw new CustodyOperationError('CANCELLED');
    const revision = authority.getSnapshot().revision;
    const assertCurrent = () => {
      const snapshot = authority.getSnapshot();
      if (ownedStorage !== storage || !['locked', 'ready', 'backup-required'].includes(snapshot.phase) || snapshot.revision !== revision)
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
    const assertBindingCurrent = () => {
      const current = authority.getSnapshot();
      if (selected !== runtime || current.phase !== 'ready' || current.revision !== initial.revision)
        throw new CustodyOperationError('CANCELLED');
      if (current === initial && !catalogue.getSnapshot()) {
        authority.lock();
        throw new CustodyOperationError('CANCELLED');
      }
    };
    const assertCurrent = () => { assertBindingCurrent(); return assertOwner(); };
    async function observeFailure<T>(action: () => Promise<T>): Promise<T> {
      try { return await action(); }
      catch (cause) {
        if (selected === runtime && authority.getSnapshot() === initial && !catalogue.getSnapshot()) authority.lock();
        throw cause;
      }
    }
    return { selected, assertCurrent, assertBindingCurrent, observeFailure };
  };
  const sentry = Object.freeze({
    available: () => authority.getSnapshot().phase === 'ready' && !!runtime?.getSentryKeyNetwork?.(),
    signingAvailable: () => authority.getSnapshot().phase === 'ready' && !!runtime?.getSentryKeyNetwork?.() && !!runtime.openSentryApprovals,
    async openApprovals(lifetime: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeSentryApprovals> {
      const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
      const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
      const open = selected.openSentryApprovals;
      if (!open) throw new CustodyOperationError('NOT_READY');
      const manager = await observeFailure(() => open(lifetime, assertCurrent, binding));
      try { assertCurrent(); if (lifetime.aborted) throw new CustodyOperationError('CANCELLED'); }
      catch (cause) { manager.dispose(); throw cause; }
      return Object.freeze({ ...manager,
        votes: Object.freeze({ ...manager.votes, sign: (...args: Parameters<typeof manager.votes.sign>) => observeFailure(() => manager.votes.sign(...args)) }),
        operations: Object.freeze({ ...manager.operations, sign: (...args: Parameters<typeof manager.operations.sign>) => observeFailure(() => manager.operations.sign(...args)) }),
      });
    },
    async openKeys(lifetime: AbortSignal, assertOwner: () => void): Promise<NativeSentryKeyManagement> {
      const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
      const open = selected.openSentryKeyManagement;
      if (!open) throw new CustodyOperationError('NOT_READY');
      const authentication = createNativePrivateAuthenticationScope();
      const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent,
        isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
      let manager: NativeSentryKeyManagement;
      try { manager = await observeFailure(() => open(lifetime, assertCurrent, binding)); }
      catch (cause) { authentication.retire(); throw cause; }
      try { assertCurrent(); if (lifetime.aborted) throw new CustodyOperationError('CANCELLED'); }
      catch (cause) { authentication.retire(); manager.dispose(); throw cause; }
      return Object.freeze<NativeSentryKeyManagement>({
        ...manager,
        isAuthenticating: () => manager.isAuthenticating() && authentication.isAuthenticating(),
        dispose() { authentication.retire(); manager.dispose(); },
        confirmImport: (...args) => observeFailure(() => manager.confirmImport(...args)),
        confirmRemoval: (...args) => observeFailure(() => manager.confirmRemoval(...args)),
        saveSettings: (...args) => observeFailure(() => manager.saveSettings(...args)),
      });
    },
    async openNodes(lifetime: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeSentryNodeManagement> {
      const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
      const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
      const open = selected.openSentryNodeManagement;
      if (!open) throw new CustodyOperationError('NOT_READY');
      const manager = await observeFailure(() => open(lifetime, assertCurrent, binding));
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
  const openNoteBackup = async (assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteBackupRuntime> => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const open = selected.openNoteBackup;
    if (!open) throw new CustodyOperationError('NOT_READY');
    const notes = await observeFailure(() => open(assertCurrent, binding));
    return Object.freeze<NativeNoteBackupRuntime>({
      ...notes,
      prepareImport: (...args) => observeFailure(() => notes.prepareImport(...args)),
      exportEncrypted: (...args) => observeFailure(() => notes.exportEncrypted(...args)),
      verifyExport: (...args) => observeFailure(() => notes.verifyExport(...args)),
    });
  };
  const openSmartAccountDeployment = async (assertOwner: () => void, signal: AbortSignal, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (signal.aborted) throw Error('CANCELLED'); };
    return observeFailure(() => selected.openSmartAccountDeployment(check, binding));
  };
  const openResumedSmartAccountOperation = async (id: string, signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (signal.aborted) throw Error('CANCELLED'); };
    check();
    const operation = await observeFailure(() => selected.resumeSmartAccountOperation(id, signal, check, binding));
    try { check(); return operation; } catch (error) { await operation.dispose(); throw error; }
  };
  const openSmartInfrastructure = async (signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (signal.aborted) throw Error('CANCELLED'); };
    check();
    const value = await observeFailure(() => selected.openSmartInfrastructure(signal, check, binding));
    try { check(); return value; } catch (error) { value.dispose(); throw error; }
  };
  const openResumedSmartInfrastructure = async (id: string, signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (signal.aborted) throw Error('CANCELLED'); };
    check();
    const value = await observeFailure(() => selected.openResumedSmartInfrastructure(id, signal, check, binding));
    try { check(); return value; } catch (error) { value.dispose(); throw error; }
  };
  const openSmartAccountModules = async (signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeSmartModuleManagement> => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (signal.aborted) throw Error('CANCELLED'); };
    check();
    const snapshot = authority.getSnapshot(), catalogue = authority.getCatalogue();
    if (!snapshot.account || !catalogue || !selected.canUseWalletAuthenticator()) throw Error('CANCELLED');
    const network = catalogue.networks.find(network => network.id === catalogue.active.networkId);
    if (!network) throw Error('CANCELLED');
    return Object.freeze({
      accountAddress: snapshot.account.address, networkName: network.name,
      passkeysAvailable: selected.canUsePasskeys(),
      async openPasskey(recreate, operationSignal, assertView) {
        const guard = () => { check(); assertSynchronousEvmFeeGuard(assertView); if (operationSignal.aborted) throw Error('CANCELLED'); };
        guard();
        const operation = await observeFailure(() => selected.openPasskeyAuthenticator(recreate, operationSignal, guard, binding));
        try { guard(); return operation; } catch (error) { await operation.dispose(); throw error; }
      },
      read: () => observeFailure(() => selected.readSmartAccountModules(signal, check)),
      preflightCustom: address => observeFailure(() => selected.preflightSmartAccountModule(address, signal, check)),
      async openChange(draft, operationSignal, assertView) {
        const guard = () => { check(); assertSynchronousEvmFeeGuard(assertView); if (operationSignal.aborted) throw Error('CANCELLED'); };
        guard();
        const operation = await observeFailure(() => selected.openSmartAccountModuleChange(draft, operationSignal, guard, binding));
        try { guard(); return operation; } catch (error) { await operation.dispose(); throw error; }
      },
    });
  };
  const openSlhDsaManagement = async (signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeSlhDsaManagement> => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const check = () => { assertSynchronousEvmFeeGuard(assertCurrent); if (signal.aborted) throw Error('CANCELLED'); };
    check();
    const account = await selected.openSlhDsaAccount(check, signal, binding); check();
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
        const operation = await observeFailure(() => selected.openSlhDsaInstallation(keyId, operationSignal, guard, binding));
        try { guard(); return operation; } catch (error) { await operation.dispose(); throw error; }
      },
    });
  };
  const openWalletAuthenticator = async (signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    return observeFailure(() => selected.openWalletAuthenticator(signal, assertCurrent, binding));
  };
  const openSmartAccountSend = async (recipient: string, amount: Parameters<KeyringRuntime['openSmartAccountSend']>[1], assertOwner: () => void, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    return observeFailure(() => selected.openSmartAccountSend(recipient, amount, assertCurrent, binding));
  };
  const guardianRecovery = Object.freeze({
    supportsPasskeys: () => runtime?.canUsePasskeys() === true,
    hasIntent: () => authority.getSnapshot().phase === 'ready' && !!runtime?.getGuardianRecoveryIntent(),
    async open(draft: Parameters<KeyringRuntime['openGuardianRecovery']>[0], signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope) {
      const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
      const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
      return observeFailure(() => selected.openGuardianRecovery(draft, signal, assertCurrent, binding));
    },
  });
  const openGuardianPolicy = async (draft: Parameters<KeyringRuntime['openGuardianPolicy']>[0], signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    return observeFailure(() => selected.openGuardianPolicy(draft, signal, assertCurrent, binding));
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
    return Object.freeze<NativeUtxoSend>({ ...send, confirm: (view, credential) => observeFailure(() => send.confirm(view, credential)) });
  };
  const openNoteMaintenance = async (signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteMaintenanceRuntime> => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    if (!selected.openNoteMaintenance) throw new CustodyOperationError('NOT_READY');
    const value = await observeFailure(() => selected.openNoteMaintenance!(signal, assertCurrent, binding));
    return Object.freeze({
      dispose: value.dispose,
      getNotes: guard => observeFailure(() => value.getNotes(guard)),
      clearCompletedNote: (id, guard) => observeFailure(() => value.clearCompletedNote(id, guard)),
      recoverFailedWithdrawal: (id, guard) => observeFailure(() => value.recoverFailedWithdrawal(id, guard)),
    });
  };
  const openPrivacyControls = async (signal: AbortSignal, assertOwner: () => void): Promise<NativePrivacyControls> => {
    const { selected, assertCurrent, observeFailure } = noteRoute(assertOwner);
    if (!selected.openPrivacyControls) throw new CustodyOperationError('NOT_READY');
    return observeFailure(() => selected.openPrivacyControls!(signal, assertCurrent));
  };
  const openNoteCapacity = async (assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteCapacityRuntime> => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const open = selected.openNoteCapacity;
    if (!open) throw new CustodyOperationError('NOT_READY');
    const capacity = await observeFailure(() => open(assertCurrent, binding));
    return Object.freeze<NativeNoteCapacityRuntime>({
      getCapacity: () => observeFailure(capacity.getCapacity),
      setCapacity: (limit) => observeFailure(() => capacity.setCapacity(limit)),
    });
  };
  const readNoteInventory = async (assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteInventory> => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    const read = selected.readNoteInventory;
    if (!read) throw new CustodyOperationError('NOT_READY');
    const inventory = await observeFailure(() => read(assertCurrent, binding));
    assertCurrent();
    return Object.freeze<NativeNoteInventory>({
      notes: inventory.notes,
      ...(inventory.checkNote ? { checkNote: (...args: Parameters<NonNullable<NativeNoteInventory['checkNote']>>) => observeFailure(() => inventory.checkNote!(...args)) } : {}),
      ...(inventory.openWithdrawal ? {
        async openWithdrawal(...[note, signal, assertViewCurrent, scope]: Parameters<NonNullable<NativeNoteInventory['openWithdrawal']>>) {
          bindNativePrivateAuthenticationChild(binding, scope);
          const check = () => { assertCurrent(); return assertViewCurrent(); };
          check();
          const view = await observeFailure(() => inventory.openWithdrawal!(note, signal, check, scope));
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
  const openPrivateDeposit = async (signal: AbortSignal, assertOwner: () => void, authentication: NativePrivateAuthenticationScope) => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    if (!selected.openPrivateDeposit) throw new CustodyOperationError('NOT_READY');
    return observeFailure(() => selected.openPrivateDeposit!(signal, assertCurrent, binding));
  };
  const openNoteImport = async (assertOwner: () => void, authentication: NativePrivateAuthenticationScope): Promise<NativeNoteImportRuntime> => {
    const { selected, assertCurrent, assertBindingCurrent, observeFailure } = noteRoute(assertOwner);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: assertBindingCurrent, isPromptActive: owner => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner) });
    if (!selected.openNoteImport) throw new CustodyOperationError('NOT_READY');
    const importer = await observeFailure(() => selected.openNoteImport!(assertCurrent, binding));
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
  const getNotificationChoices = () => {
    const snapshot = authority.getSnapshot(), catalogue = authority.getCatalogue();
    const monitoring = runtime?.catalogue.getMonitoringSnapshot();
    if (!['ready', 'backup-required'].includes(snapshot.phase) || !catalogue || !monitoring || monitoring.revision !== catalogue.revision)
      throw new CustodyOperationError('NOT_READY');
    return nativeNotificationChoices(monitoring);
  };
  const readPortfolioAssets = (scope: NativeNotificationScope, signal: AbortSignal, assertCurrent: () => void) => {
    const selected = runtime, before = authority.getSnapshot(), catalogue = authority.getCatalogue();
    const check = () => {
      assertSynchronousEvmFeeGuard(assertCurrent);
      if (signal.aborted || runtime !== selected || authority.getSnapshot() !== before || authority.getCatalogue() !== catalogue ||
          !selected?.tokens?.loadScoped || !catalogue || catalogue.active.accountId !== scope.accountId || before.account?.address !== scope.accountAddress ||
          !getNotificationChoices().some(choice => JSON.stringify(choice.scope) === JSON.stringify(scope)))
        throw new CustodyOperationError('CANCELLED');
    };
    check();
    return createScopedPortfolioAssetReader({ fetch: walletFetch,
      load: (target, guard) => { check(); return selected!.tokens!.loadScoped!(target, guard); },
    })(scope, signal, check).then(value => {
      check();
      if ('kind' in scope.network && scope.network.kind === 'evm' && Number.isSafeInteger(Number(scope.network.chainId))) rememberTokens(selected!, walletTokenScope(scope.accountId, scope.accountAddress, scope.network), {
        syscoin: [], ethereum: [
          ...value.tokens.map(item => ({ chainId: Number(scope.network.chainId), contractAddress: item.metadata.contractAddress,
            decimals: item.metadata.decimals, isNft: false, name: item.metadata.name, tokenSymbol: item.metadata.symbol,
            ...(item.units !== null ? { rawBalance: item.units, balance: projectWalletTokenBalanceUnits(item.units, item.metadata.decimals) } : {}) })),
          ...value.collectibles.map(item => ({ chainId: Number(scope.network.chainId), ...item.collectible, decimals: 0, isNft: true, tokenSymbol: '',
            ...(item.units !== null ? { rawBalance: item.units, balance: projectWalletTokenBalanceUnits(item.units, 0) } : {}) })),
        ],
      });
      return value;
    });
  };
  const getScopedActivityRuntime = (scope: NativeNotificationScope, assertCurrent: () => void) => {
    const selected = runtime, before = authority.getSnapshot(), catalogue = authority.getCatalogue();
    const check = () => {
      assertSynchronousEvmFeeGuard(assertCurrent);
      if (runtime !== selected || authority.getSnapshot() !== before || authority.getCatalogue() !== catalogue || !selected?.activity?.forScope ||
          !catalogue || catalogue.active.accountId !== scope.accountId || before.account?.address !== scope.accountAddress ||
          !getNotificationChoices().some(choice => JSON.stringify(choice.scope) === JSON.stringify(scope)))
        throw new CustodyOperationError('CANCELLED');
    };
    check();
    return selected!.activity!.forScope!({ accountId: scope.accountId, address: scope.accountAddress,
      networkId: scope.network.id, registrationHash: 'registrationHash' in scope.network ? scope.network.registrationHash : '' }, check);
  };
  const activityReaders = Object.freeze({ explorer: new ActivityExplorerReader(walletFetch), receipts: new ActivityReceiptReader({ fetch: walletFetch }) });
  return { getNotificationChoices, readPortfolioAssets, getScopedActivityRuntime, activityReaders, authority, saveIdlePreference, sentry, recipientResolver, openSmartInfrastructure, openResumedSmartInfrastructure, openSmartAccountModules, canManageSmartAccountModules: () => runtime?.canUseWalletAuthenticator() === true, openSlhDsaManagement, canManageSlhDsa: () => runtime?.canManageSlhDsa() === true, canSignSmartAccount: () => runtime?.canSignSmartAccount() === true, guardianRecovery, authentication: { isActive: (owner: AbortSignal) => isNativeCredentialPromptActive(owner) || isBoundNativePasskeyPromptActive(owner), isAnyPromptActive: () => isNativeCredentialPromptActive() || isBoundNativePasskeyPromptActive(), cancel: () => nativeCredentialAuthentication.cancel(), run: nativeCredentialAuthentication.run }, ledger, ledgerConnection, trezor, connections: connections.view, disposeConnections, backup, keyExport, imports, accounts, activity, utxoActivity, balanceReader, readGuardianRecovery, openGuardianPolicy, inspectGuardianRemoval, canManageGuardianPolicy: () => runtime?.canManageGuardianPolicy() === true, canUseWalletAuthenticator: () => runtime?.canUseWalletAuthenticator() === true, openWalletAuthenticator, resetActivity, readRecoveryInventory, openSmartAccountDeployment, openResumedSmartAccountOperation, openSmartAccountSend, openUtxoSend, openNoteBackup, openNoteCapacity, openNoteMaintenance, openPrivacyControls, readNoteInventory, openNoteImport, openPrivateDeposit, captureNoteFileOwner, removal, transfers: transfers.view, tokens: tokens.view,
    disposeTokens: () => { stopTokenObservation(); tokens.dispose(); }, disposeTransfers: () => transfers.dispose() };
}
