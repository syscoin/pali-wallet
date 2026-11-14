import { walletUiFixture } from './walletUiFixture.ts';
import { NotificationPermissionReturn } from '../src/notifications/permissionReturn.ts';
import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { PALI_RECOVERY_ALERTS_URL } from '../../../source/shared/smartAccountLinks.ts';
import { getNativeGuardianRecoveryChoices } from '../src/smartAccount/guardianRecovery.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as networks from '../src/custody/networkContext.ts';
import * as publicSendDraft from '../src/screens/publicSendDraft.ts';
import * as utxoNetworks from '../src/core/utxoNetworks.ts';
import type { NativePairingEntry } from '../src/connections/pairingLinks.ts';
import type { NativeConnectionsView } from '../src/connections/types.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { quietActivityNotifications } from './notificationFixture.ts';
import { createTestPublicViewLock } from './publicViewLockFixture.ts';
import { IdleLock } from '../src/core/idleLock.ts';
import { createPermissionPresentation } from '../src/platform/permissionPresentation.ts';
import { TabDeparture } from '../src/navigation/tabDeparture.ts';
import { screenFixture, screenElements } from './screenFixture.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { nativeAccountSelection } from '../src/core/accountDirectory.ts';

type Element = {
  type: unknown;
  props: Record<string, any>;
  children: unknown[];
};
type Cell = {
  value?: any;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
};
const URI = `wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(
  32
)}`;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const code = ts.transpileModule(
  readFileSync(
    new URL('../src/screens/NativeWallet.native.tsx', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }
).outputText;
const cameraCode = ts.transpileModule(readFileSync(new URL('../src/platform/cameraPermission.native.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(ready = false, smartAccount = false, withPairing = true, canManage = true, handoff = false, slh = false, infrastructure = false, realNavigation = false, withAccounts = false) {
  let now = 1000,
    cursor = 0,
    selectionCalls = 0;
  let hardwareBack: (() => boolean) | undefined;
  let exits = 0;
  let shellTab = 'wallet';
  let liveShell: any;
  let acquisitions = 0, releases = 0, lifecycleActive = true;
  let releaseGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let selectionGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let externalResume: (() => Promise<void>) | undefined;
  const externalResumes: string[] = [];
  const metadataReads: { signal: AbortSignal; check(): void }[] = [];
  let metadataGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let observedDeployment: boolean | undefined;
  let metadataPublished: (() => void) | undefined;
  let metadataPublishing: (() => void) | undefined;
  const viewPrivacy = createTestPublicViewLock();
  const custodyIdle = new IdleLock(() => ({ monotonic: now, wall: now }));
  let viewAuthorizations = 0, rejectViewAuthorization = false;
  let duringLock: (() => void) | undefined;
  let guardianReads = 0;
  let guardianOpens = 0;
  let recoveryOpens = 0;
  const openedLinks: string[] = [];
  const lifecycleEvents: string[] = [];
  const resumedSmart: {id: string; signal: AbortSignal; check: () => void}[] = [];
  const resumedInfrastructure: {id: string; signal: AbortSignal; check: () => void}[] = [];
  const psbtLifecycle = {
    backgroundSigning() { lifecycleEvents.push('psbt-background'); },
    async cancelSigningHandoff() { lifecycleEvents.push('psbt-cancel'); },
    async resumeSigning(id: string) {
      if (!externalResume) throw Error('PSBT resume is outside this fixture');
      externalResumes.push(id); await externalResume();
    },
  } satisfies Pick<NativeConnectionsView, 'backgroundSigning' | 'cancelSigningHandoff' | 'resumeSigning'>;
  const authenticatorGuards: (() => void)[] = [];
  let promptActive = false;
  let cameraPromptActive = false;
  let incoming: NativePairingEntry | null = smartAccount || !withPairing
    ? null
    : {
        id: 'pairing-1',
        uri: URI,
        expiresAt: now + 300000,
      };
  let snapshot: any = {
    phase: ready ? 'ready' : 'locked',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: ready
      ? { address: '0x' + '11'.repeat(20), network: 'ethereum' }
      : null,
    error: null,
  };
  let connectionSnapshot: any = {
    status: 'ready',
    signingReview: null,
    proposals: [],
  };
  const cells: Cell[] = [],
    effects: (() => void)[] = [];
  const authorityListeners = new Set<(value: unknown) => void>(),
    connectionListeners = new Set<() => void>();
  const appListeners = new Map<string, Set<(value: string) => void>>();
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const effect = (
    callback: () => void | (() => void),
    dependencies?: readonly unknown[]
  ) => {
    const entry = cell();
    if (
      dependencies &&
      entry.dependencies &&
      dependencies.length === entry.dependencies.length &&
      dependencies.every((value, index) =>
        Object.is(value, entry.dependencies![index])
      )
    )
      return;
    entry.dependencies = dependencies;
    effects.push(() => {
      entry.cleanup?.();
      entry.cleanup = callback() || undefined;
    });
  };
  const react = {
    Fragment: 'Fragment',
    createElement: (
      type: unknown,
      props: Record<string, any> | null,
      ...children: unknown[]
    ) => ({ type, props: props ?? {}, children }),
    useState(initial: any) {
      const entry = cell();
      if (!Object.hasOwn(entry, 'value'))
        entry.value = typeof initial === 'function' ? initial() : initial;
      return [
        entry.value,
        (next: any) => {
          entry.value = typeof next === 'function' ? next(entry.value) : next;
        },
      ];
    },
    useRef(initial: any) {
      const entry = cell();
      entry.value ??= { current: initial };
      return entry.value;
    },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) { return getSnapshot(); },
    useEffect: effect,
    useLayoutEffect: effect,
    useMemo(create: () => unknown, dependencies: readonly unknown[] = []) {
      const entry = cell();
      if (!entry.dependencies || dependencies.length !== entry.dependencies.length ||
          dependencies.some((value, index) => !Object.is(value, entry.dependencies![index]))) {
        entry.value = create(); entry.dependencies = dependencies;
      }
      return entry.value;
    },
    useCallback(callback: unknown, dependencies: readonly unknown[] = []) {
      const entry = cell();
      if (
        !entry.dependencies ||
        dependencies.some(
          (value, index) => value !== entry.dependencies![index]
        )
      ) {
        entry.value = callback;
        entry.dependencies = dependencies;
      }
      return entry.value;
    },
  };
  let catalogue = {
    revision: 1,
    active: {
      accountId: infrastructure ? 'trezor:60:0' : smartAccount ? 'smart:60:0' : 'hd:60:0',
      networkId: 'ethereum',
    },
    networks: networks.NATIVE_NETWORKS,
    utxoNetworks: [],
    accounts: [
      {
        id: infrastructure ? 'trezor:60:0' : smartAccount ? 'smart:60:0' : 'hd:60:0',
        index: 0,
        slip44: 60,
        type: infrastructure ? 'Trezor' : smartAccount ? 'SmartAccount' : 'HDAccount',
        ...(smartAccount ? { smartAccount: { isDeployed: false, localEcdsa: true, chainId: 1 } } : {}),
        address: '0x' + '11'.repeat(20),
        label: 'Account 1',
      },
      ...(handoff || withAccounts ? [{ id: 'hd:60:1', index: 1, slip44: 60, type: 'HDAccount', address: '0x' + '22'.repeat(20), label: 'Guardian' }] : []),
    ],
  };
  const change = (phase: string) => {
    snapshot = {
      ...snapshot,
      phase,
      revision: snapshot.revision + 1,
      account:
        phase === 'ready'
          ? { address: '0x' + '11'.repeat(20), network: 'ethereum' }
          : null,
    };
    for (const listener of authorityListeners) listener(snapshot);
  };
  const controllers = {
    getNotificationChoices: () => [{ label: 'Account 1', networkName: 'Ethereum', symbol: 'ETH', scope: {
      id: `native:${catalogue.active.accountId}:ethereum`, accountId: catalogue.active.accountId,
      accountType: smartAccount ? 'SmartAccount' : 'HDAccount', accountAddress: snapshot.account.address,
      network: networks.getNativeNetwork('ethereum'), guardian: false,
    } }],
    authentication: { isAnyPromptActive: () => promptActive, isActive: () => promptActive, cancel() { promptActive = false; } },
    authority: {
      getSnapshot: () => snapshot,
      getCatalogue: () => (snapshot.phase === 'ready' ? catalogue : null),
      subscribe(listener: (value: unknown) => void) {
        authorityListeners.add(listener);
        return () => {
          authorityListeners.delete(listener);
        };
      },
      supportsAccountManagement: () => withAccounts,
      lock() {
        lifecycleEvents.push('lock');
        change('locked');
        duringLock?.();
      },
      async getAuthenticationStatus() { return { deviceAuth: 'ready', credentialPresent: true }; },
      async unlock() {
        change('ready');
      },
    },
    accounts: {
      getContextRevision: () => snapshot.revision,
      async execute(request: { id: string }) {
        selectionCalls++;
        if (selectionGate) await selectionGate.promise;
        if (handoff || withAccounts) {
          const selected = catalogue.accounts.find(account => account.id === request.id)!;
          catalogue = { ...catalogue, revision: catalogue.revision + 1, active: { ...catalogue.active, accountId: request.id } };
          snapshot = { ...snapshot, revision: snapshot.revision + 1, account: { address: selected.address, network: 'ethereum' } };
          for (const listener of authorityListeners) listener(snapshot);
        }
      },
    },
    connections: {
      ...psbtLifecycle,
      getSnapshot: () => connectionSnapshot,
      subscribe(listener: () => void) {
        connectionListeners.add(listener);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      cancel() {},
    },
    trezor: {
      getSnapshot: () => ({phase: 'idle', operation: null, networkLabel: '', accountLabel: '', address: null, signer: null, error: null}),
      subscribe: () => () => undefined,
      background() {lifecycleEvents.push('trezor-background');},
      async cancel() {lifecycleEvents.push('trezor-cancel');},
    },
    keyExport: { cancel() {} },
    backup: { cancel() {}, onClear: () => () => {} },
    removal: { requiresControllerReopen: () => false },
    openSmartAccountSend() { throw new Error('Route mocked in parent navigation test'); },
    openSmartAccountDeployment() {
      throw new Error('Route mocked in parent navigation test');
    },
    async openResumedSmartAccountOperation(id: string, signal: AbortSignal, check: () => void) {
      check(); resumedSmart.push({id, signal, check}); return {async dispose() {}};
    },
    async openSmartInfrastructure() { throw Error('New infrastructure deployment is outside this fixture'); },
    async openResumedSmartInfrastructure(id: string, signal: AbortSignal, check: () => void) {
      check(); resumedInfrastructure.push({id, signal, check}); return {dispose() {}};
    },
    canManageGuardianPolicy: () => smartAccount && canManage,
    canSignSmartAccount: () => smartAccount && (canManage || slh), canManageSlhDsa: () => smartAccount && slh,
    canManageSmartAccountModules: () => smartAccount && canManage && catalogue.accounts[0]?.smartAccount?.isDeployed === true,
    async openSmartAccountModules() { throw Error('Modules are outside this fixture'); },
    async openSlhDsaManagement(_signal: AbortSignal, check: () => void) { check(); authenticatorGuards.push(check); return { installedKeys: [] }; },
    canUseWalletAuthenticator: () => smartAccount && canManage && catalogue.accounts[0]?.smartAccount?.isDeployed === true,
    async refreshSmartAccountMetadata(signal: AbortSignal, check: () => void, onPublished: () => void) {
      const before = snapshot, saved = catalogue, gate = metadataGate;
      check(); metadataReads.push({ signal, check });
      await gate?.promise;
      check();
      if (signal.aborted || snapshot !== before || catalogue !== saved) throw Error('CANCELLED');
      const isDeployed = observedDeployment;
      if (isDeployed === undefined) return;
      catalogue = { ...catalogue, revision: catalogue.revision + 1,
        accounts: catalogue.accounts.map(account => account.id === catalogue.active.accountId
          ? { ...account, smartAccount: { ...account.smartAccount!, isDeployed } } : account) };
      // Runtime metadata publication changes its catalogue, not the custody authority snapshot.
      metadataPublishing?.();
      try { onPublished(); } catch { /* Match committed runtime publication. */ }
      metadataPublished?.();
    },
    async openWalletAuthenticator(_signal: AbortSignal, check: () => void) {
      check();
      authenticatorGuards.push(check);
      return { dispose() {} };
    },
    guardianRecovery: { supportsPasskeys: () => false, hasIntent: () => true, async open(_draft: unknown, _signal: AbortSignal, check: () => void) { check(); recoveryOpens++; return { dispose() {} }; } },
    inspectGuardianRemoval: async (_signal: AbortSignal, check: () => void) => { check(); return { status: 'retry-ready', transactions: [], totalPending: 0 }; },
    openGuardianPolicy: async (_draft: unknown, _signal: AbortSignal, check: () => void) => { check(); guardianOpens++; return { dispose() {} }; },
    readGuardianRecovery: async (_signal: AbortSignal, check: () => void) => { check(); guardianReads++; return { status: 'no-compatible-policy' }; },
    balanceReader: {},
    transfers: {},
    tokens: {},
    activity: {},
  };
  const native: any = {
    Linking: { async openURL(url: string) { openedLinks.push(url); } },
    Platform: { OS: 'android' },
    StyleSheet: { create: (value: unknown) => value },
    Keyboard: { dismiss() {} },
    AppState: {
      currentState: 'active',
      addEventListener(name: string, listener: (value: string) => void) {
        const values = appListeners.get(name) ?? new Set();
        values.add(listener);
        appListeners.set(name, values);
        return {
          remove() {
            values.delete(listener);
          },
        };
      },
    },
    BackHandler: {
      addEventListener(_name: string, listener: () => boolean) {
        hardwareBack = listener;
        return {
          remove() {
            if (hardwareBack === listener) hardwareBack = undefined;
          },
        };
      },
    },
  };
  let cameraOwnerAlive = true;
  const cameraReply = Promise.withResolvers<{ granted: boolean; canAskAgain: boolean }>();
  const cameraModule = { exports: {} as {
    isCameraPermissionPromptActive(): boolean;
    requestNativeCameraPermission(isCurrent: () => boolean): Promise<{ granted: boolean }>;
  } };
  runInNewContext(cameraCode, { module: cameraModule, exports: cameraModule.exports, require(name: string) {
    if (name === 'react-native') return native;
    if (name === './permissionPresentation') return { createPermissionPresentation };
    assert.equal(name, 'expo-camera');
    return { Camera: { getCameraPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
      requestCameraPermissionsAsync: () => cameraReply.promise } };
  } });
  const lifecycle = class {
    async acquire() {
      acquisitions++; lifecycleActive = true;
      return controllers;
    }
    current() {
      return lifecycleActive ? controllers : null;
    }
    hasRecovery() {
      return false;
    }
    async release() { releases++; lifecycleActive = false; await releaseGate?.promise; }
  };
  const noteRestore = {
    cancel() {},
    lock() {},
    resume: () => false,
    step: { phase: 'select' },
  };
  const source = readFileSync(
    new URL('../src/screens/NativeWallet.native.tsx', import.meta.url),
    'utf8'
  );
  const dependencies: Record<string, unknown> = Object.fromEntries(
    [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => [
      match[1]!,
      {},
    ])
  );
  Object.assign(dependencies, {
    './publicSendDraft': publicSendDraft,
    './NativeAccountOverview': { NativePortfolioRoute: 'NativePortfolio' },
    '../notifications/permissionReturn': { NotificationPermissionReturn },
    '../notifications/service': { nativeActivityNotifications: quietActivityNotifications, isNotificationPermissionPromptActive: () => false },
    '../platform/cameraPermission': { isCameraPermissionPromptActive: () => cameraPromptActive || cameraModule.exports.isCameraPermissionPromptActive() },
    '../activity/accountActivity': { AccountActivityController: class {} },
    './BackupIntroduction': { BackupIntroduction: 'BackupIntroduction' },
    './TransactionAuthentication': { TransactionAuthentication: 'TransactionAuthentication' },
    './NativeImportWallet': { NativeImportWallet: 'NativeImportWallet' },
    './OrphanedStorageRecovery': { OrphanedStorageRecovery: 'OrphanedStorageRecovery' },
    './NativeOperationAuthentication': { NativeOperationAuthentication: 'NativeOperationAuthentication' },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    '../platform/localization': nativeTranslationFixture,
    '../portfolio/nativePortfolio': { NativePortfolioController: class { getSnapshot = () => null; subscribe = () => () => {}; connect() { return () => {}; } }, sameNativePortfolioAccount: () => false },
    '../../../../source/shared/smartAccountLinks.ts': { PALI_RECOVERY_ALERTS_URL },
    '../smartAccount/guardianRecovery': { getNativeGuardianRecoveryChoices },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react,
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': {
      Header: 'Header',
      Text: 'Text',
      Button: 'Button',
      Screen: 'Screen',
      Notice: 'Notice',
      styles: {},
      colors: {},
    },
    '../core/utxoNetworks': utxoNetworks,
    '../core/accountDirectory': { nativeAccountSelection },
    '../custody/networkContext': networks,
    '../../../../source/shared/evmNetworks': { EVM_NETWORK_DEFINITIONS: networks.NATIVE_NETWORKS.map(network => ({ id: network.id, name: network.name })) },
    '../platform/security': {
      publicViewLock: viewPrivacy.viewLock,
      custodyIdle,
      securityPreferences: { getSnapshot: () => ({ status: 'ready' }) },
    },
    '../platform/credential': {
      async authorizePublicView(_signal: AbortSignal, check: () => void) {
        check(); viewAuthorizations++;
        if (rejectViewAuthorization) throw Error('CANCELLED');
      },
      isNativeCredentialPromptActive: () => promptActive,
    },
    '../platform/privacyShield.native': { async ensurePrivacyShield() {} },
    '../platform/nativeFactory': {
      createNativeWalletControllers: () => controllers,
    },
    '../custody/nativeControllerLifecycle': {
      NativeControllerLifecycle: lifecycle,
    },
    '../custody/networkView': { createNativeNetworkView: () => ({}) },
    './useNativeNoteBackup': { useNativeNoteBackup: () => noteRestore },
    './useRealShell': {
      useRealShell: () => ({
        tab: shellTab,
        immersive: false,
        navigation: {},
        restoreRoot(next: string) { shellTab = next; },
        select(next: string) { shellTab = next; },
        goBack() {},
      }),
    },
    './NativeSlhDsaManagement': { NativeSlhDsaManagementScreen: 'NativeSlhDsaManagementScreen' },
    './NativeSmartAccountAuthenticator': { NativeSmartAccountAuthenticator: 'NativeSmartAccountAuthenticator' },
    './NativeSmartAccountSend': { NativeSmartAccountSend: 'NativeSmartAccountSend' },
    './NativePortfolio': { NativePortfolio: 'NativePortfolio' },
    './RealAppShell': { RealAppShell: 'RealAppShell' },
    './WalletUpdatePanel': { LockedWalletUpdate: 'LockedWalletUpdate', WalletUpdateScreen: 'WalletUpdateScreen' },
    './RealSettings': { RealSettings: 'RealSettings' },
    './NativeSmartAccountOperation': {
      NativeSmartAccountOperationRoute: 'NativeSmartAccountOperationRoute',
    },
    './NativeTrezor': {NativeTrezor: 'NativeTrezor', NativeTrezorResumeNotice: 'NativeTrezorResumeNotice'},
    './NativeInfrastructure': {NativeInfrastructure: 'NativeInfrastructure'},
    './NativeConnections': { NativeConnections: 'NativeConnections' },
    './NativeEncryptionReview': { NativeEncryptionReviewScreen: 'NativeEncryptionReviewScreen' },
    './NativeMessageReview': {
      NativeMessageReviewScreen: 'NativeMessageReviewScreen',
    },
    './NativeTransactionReview': {
      NativeTransactionReviewScreen: 'NativeTransactionReviewScreen',
    },
    './NativeSend': { NativeSend: 'NativeSend' },
    './NativeActivity': { NativeActivityScreen: 'NativeActivityScreen' },
    './AllNetworksActivity': { AllNetworksActivity: 'AllNetworksActivity' },
    './RealTools': { RealTools: 'RealTools' },
    './WalletAccounts': { WalletAccounts: 'WalletAccounts' },
    './NativeAccounts': { NativeAccounts: 'NativeAccounts' },
  });
  const module = {
    exports: {} as { NativeWalletScreen(props: object): Element; NativeWalletContent(props: object): Element },
  };
  if (realNavigation) {
    const shellModule = { exports: {} as { useRealShell: (...args: any[]) => any } };
    runInNewContext(ts.transpileModule(readFileSync(new URL('../src/screens/useRealShell.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { module: shellModule, exports: shellModule.exports, require(name: string) { const walletUi = walletUiFixture(name, dependencies); if (walletUi) return walletUi;
      if (name === 'react') return react;
      if (name === 'react-native') return native;
      assert.equal(name, '../navigation/tabDeparture'); return { TabDeparture };
    } });
    dependencies['./useRealShell'] = { useRealShell: (...args: any[]) => liveShell = shellModule.exports.useRealShell(...args) };
  }
  runInNewContext(code, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    AbortController,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    require(name: string) {
      const walletUi = walletUiFixture(name, dependencies); if (walletUi) return walletUi;
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
  });
  const controllerRef = { current: null };
  const accountBridge = { onNativeCatalogue() {}, onSelectWatch() {} };
  const render = () => {
    cursor = 0;
    const tree = module.exports.NativeWalletContent({
      controllerRef,
      onExit() {
        exits++;
      },
      initialAccountId: 'hd:60:9',
      ...(withAccounts ? { accounts: accountBridge } : {}),
      incomingPairing: incoming,
      onPairingHandled(id: string) {
        if (incoming?.id === id) incoming = null;
      },
    });
    effects.splice(0).forEach((run) => run());
    return tree;
  };
  return {
    render,
    wrapper: () => module.exports.NativeWalletScreen({ onExit() {} }),
    content: module.exports.NativeWalletContent,
    lifecycle: () => lifecycleEvents,
    resumedSmart: () => resumedSmart,
    resumedInfrastructure: () => resumedInfrastructure,
    showTools() { if (realNavigation) liveShell.select('tools'); else shellTab = 'tools'; },
    showWallet() { if (realNavigation) liveShell.select('wallet'); else shellTab = 'wallet'; },
    showSettings() { if (realNavigation) liveShell.select('settings'); else shellTab = 'settings'; },
    showActivity() { shellTab = 'activity'; },
    activityChoice() { return controllers.getNotificationChoices()[0]!; },
    holdRelease() { return releaseGate = Promise.withResolvers<void>(); },
    holdSelection() { return selectionGate = Promise.withResolvers<void>(); },
    resumeExternal(work: () => Promise<void>) { externalResume = work; },
    externalResumes: () => externalResumes,
    observeDeployment(value: boolean) { observedDeployment = value; },
    onMetadataPublished(callback: () => void) { metadataPublished = callback; },
    beforeMetadataPublished(callback: () => void) { metadataPublishing = callback; },
    metadataReads: () => metadataReads,
    authoritySnapshot: () => snapshot,
    holdMetadata() {
      const gate = metadataGate = Promise.withResolvers<void>();
      return { resolve() { metadataGate = undefined; gate.resolve(); } };
    },
    acquisitions: () => acquisitions,
    releases: () => releases,
    viewPrivacy,
    viewAuthorizations: () => viewAuthorizations,
    rejectViewAuthorization() { rejectViewAuthorization = true; },
    duringLock(action: () => void) { duringLock = action; },
    guardianReads: () => guardianReads,
    guardianOpens: () => guardianOpens,
    recoveryOpens: () => recoveryOpens,
    openedLinks: () => openedLinks,
    authenticatorGuards: () => authenticatorGuards,
    hardwareBack() {
      assert(hardwareBack);
      return hardwareBack();
    },
    exits: () => exits,
    completeDeployment() {
      catalogue = {
        ...catalogue,
        revision: catalogue.revision + 1,
        accounts: catalogue.accounts.map((account) => ({
          ...account,
          smartAccount: { ...account.smartAccount!, isDeployed: true },
        })),
      };
    },
    ready: () => change('ready'),
    readyAtRevision(revision: number) {
      snapshot = { ...snapshot, phase: 'ready', revision, account: { address: '0x' + '11'.repeat(20), network: 'ethereum' } };
      for (const listener of authorityListeners) listener(snapshot);
    },
    selectionCalls: () => selectionCalls,
    consume() {
      incoming = null;
    },
    expire() {
      now += 300001;
    },
    connections(patch: object) {
      connectionSnapshot = { ...connectionSnapshot, ...patch };
      for (const listener of connectionListeners) listener();
    },
    prompt(active: boolean) { promptActive = active; },
    cameraPrompt(active: boolean) { cameraPromptActive = active; },
    requestCameraPermission: () => cameraModule.exports.requestNativeCameraPermission(() => cameraOwnerAlive),
    finishCameraPermission(granted: boolean) { cameraReply.resolve({ granted, canAskAgain: false }); },
    inactive() {
      native.AppState.currentState = 'inactive';
      for (const listener of appListeners.get('change') ?? []) listener('inactive');
    },
    background() {
      native.AppState.currentState = 'background';
      for (const listener of appListeners.get('change') ?? [])
        listener('background');
    },
    blur() {
      for (const listener of appListeners.get('blur') ?? []) listener('');
    },
    foreground() {
      native.AppState.currentState = 'active';
      for (const listener of appListeners.get('change') ?? [])
        listener('active');
    },
    dispose() {
      cameraOwnerAlive = false;
      cells.forEach((entry) => entry.cleanup?.());
    },
  };
}

function find(
  tree: unknown,
  predicate: (node: Element) => boolean
): Element | undefined {
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return;
  const node = tree as Element;
  return predicate(node)
    ? node
    : [...node.children, node.props.footer].flatMap((child) => find(child, predicate) ?? []).at(0);
}

async function mounted(ready = false, smartAccount = false, withPairing = true, canManage = true, handoff = false, slh = false, infrastructure = false, realNavigation = false, withAccounts = false) {
  const f = harness(ready, smartAccount, withPairing, canManage, handoff, slh, infrastructure, realNavigation, withAccounts);
  f.render();
  await settle();
  f.render();
  await settle();
  f.render();
  return f;
}

test('wallet wrapper renders public content without an app authentication sibling', () => {
  const f = harness();
  const tree = f.wrapper();
  assert.equal(tree.type, f.content);
  assert.equal(tree.children.length, 0);
  f.dispose();
});

test('an incoming pairing waits for public entry and never applies the saved account hint', async () => {
  const f = await mounted();
  try {
    let tree = f.render();
    assert.equal(tree.type, 'SafeAreaView');
    const open = find(tree, node => node.props.title === 'Open wallet');
    assert(open); open.props.onPress();
    await settle();
    f.render();
    await settle();
    tree = f.render();
    assert.equal(tree.type, 'NativeConnections');
    assert.equal(tree.props.incomingPairing.uri, URI);
    assert.equal(f.selectionCalls(), 0);
  } finally {
    f.dispose();
  }
});

test('an incoming pairing waits for an existing connection review to finish', async () => {
  const f = await mounted();
  try {
    f.connections({ status: 'approving', proposals: [{ id: 1 }] });
    f.ready();
    f.render();
    assert.notEqual(f.render().type, 'NativeConnections');
    f.connections({ status: 'ready', proposals: [] });
    f.render();
    await settle();
    assert.equal(f.render().type, 'NativeConnections');
  } finally {
    f.dispose();
  }
});

for (const expired of [false, true])
  for (const transition of ['background', 'blur'] as const) {
    test(`camera intent ${
      expired ? 'expires' : 'resumes only after unlock'
    } after ${transition}`, async () => {
      const f = await mounted(true);
      try {
        let tree = f.render();
        assert.equal(tree.type, 'NativeConnections');
        tree.props.onPairingHandled(tree.props.incomingPairing.id);
        f.consume();
        tree.props.onScanStarted();
        f.render();
        const lifecycleOffset = f.lifecycle().length;
        if (transition === 'background') f.background();
        else f.blur();
        assert.deepEqual(f.lifecycle().slice(lifecycleOffset), ['trezor-background', 'psbt-background', 'lock']);
        tree = f.render();
        assert.notEqual(tree.type, 'NativeConnections');
        if (expired) f.expire();
        f.foreground();
        f.ready();
        f.render();
        await settle();
        tree = f.render();
        assert.equal(tree.type === 'NativeConnections', !expired);
        if (!expired) {
          assert.equal(tree.props.initialScan, true);
          tree.props.onBack();
          f.render();
          assert.notEqual(f.render().type, 'NativeConnections');
        }
      } finally {
        f.dispose();
      }
    });
  }

for (const [kind, screen] of [
  ['message', 'NativeMessageReviewScreen'],
  ['encryption', 'NativeEncryptionReviewScreen'],
  ['transaction', 'NativeTransactionReviewScreen'],
] as const)
  test(`an incoming pairing never replaces an already active ${kind} approval`, async () => {
    const f = await mounted();
    try {
      f.connections({ signingReview: { kind, id: `${kind}-1` } });
      f.ready();
      f.render();
      assert.equal(f.render().type, screen);
      f.connections({ signingReview: null });
      f.render();
      await settle();
      assert.equal(f.render().type, 'NativeConnections');
    } finally {
      f.dispose();
    }
  });

for (const back of ['Android', 'screen'] as const)
  test(`${back} Back refreshes the completed smart deployment without exiting or locking`, async () => {
    const f = await mounted(true, true);
    try {
      const portfolio = find(
        f.render(),
        (node) => node.type === 'NativePortfolio'
      );
      assert(portfolio);
      assert.equal(portfolio.props.smartAccount.isDeployed, false);
      portfolio.props.onDeploySmartAccount();
      const route = f.render();
      assert.equal(route.type, 'NativeSmartAccountOperationRoute');
      // The runtime committed new metadata without an authority phase change.
      f.completeDeployment();
      if (back === 'Android') assert.equal(f.hardwareBack(), false);
      route.props.onBack();
      const refreshed = find(
        f.render(),
        (node) => node.type === 'NativePortfolio'
      );
      assert(refreshed);
      assert.equal(refreshed.props.smartAccount.isDeployed, true);
      assert.equal(refreshed.props.onDeploySmartAccount, undefined);
      assert.equal(f.exits(), 0);
    } finally {
      f.dispose();
    }
  });


test('viewing a completed deployment refreshes Wallet metadata and capabilities before returning', async () => {
  const f = await mounted(true, true, false);
  try {
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(portfolio.props.smartAccount.isDeployed, false);
    portfolio.props.onDeploySmartAccount();
    const result = f.render();
    assert.equal(result.type, 'NativeSmartAccountOperationRoute');
    // Persistence changed without a new authority event, as in real deployment.
    f.completeDeployment();
    const hash = '0x' + 'cd'.repeat(32);
    result.props.onViewTransaction(hash);
    const activity = find(f.render(), node => node.type === 'AllNetworksActivity')!;
    assert.equal(activity.props.initialTarget.hash, hash);
    assert.equal(activity.props.initialTarget.networkId, 'ethereum');
    f.showWallet();
    const refreshed = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(refreshed.props.smartAccount.isDeployed, true);
    assert.equal(refreshed.props.onDeploySmartAccount, undefined);
    assert.equal(typeof refreshed.props.onManageSmartAccountModules, 'function');
    assert.equal(typeof refreshed.props.onUseWalletAuthenticator, 'function');
    assert.equal(f.exits(), 0);
  } finally { f.dispose(); }
});

test('a stale deployment result cannot refresh or navigate a successor public context', async () => {
  const f = await mounted(true, true, false);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onDeploySmartAccount();
    const result = f.render();
    f.readyAtRevision(2); f.render();
    result.props.onViewTransaction('0x' + 'cd'.repeat(32));
    assert.equal(find(f.render(), node => node.type === 'AllNetworksActivity'), undefined);
  } finally { f.dispose(); }
});

test('Smart native, ERC20 and NFT sends use the owned operation route', async () => {
  const f = await mounted(true, true);
  try {
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio');
    assert(portfolio);
    assert.equal(typeof portfolio.props.onSend, 'function');
    assert.equal(typeof portfolio.props.onSendToken, 'function');
    assert.equal(typeof portfolio.props.onSendCollectible, 'function');
    portfolio.props.onSend();
    const route = f.render();
    assert.equal(route.type, 'NativeSmartAccountSend');
    assert.equal(f.hardwareBack(), false);
    route.props.onBack();
    const returned = find(f.render(), node => node.type === 'NativePortfolio');
    assert(returned);
    const token = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 6, name: 'Token', symbol: 'TKN' };
    returned.props.onSendToken(token);
    const tokenRoute = f.render();
    assert.equal(tokenRoute.type, 'NativeSmartAccountSend');
    assert.equal(tokenRoute.props.token, token);
    assert.equal(f.hardwareBack(), false);
    tokenRoute.props.onBack();
    const afterToken = find(f.render(), node => node.type === 'NativePortfolio');
    assert(afterToken);
    const collectible = { contractAddress: '0x6666666666666666666666666666666666666666', tokenStandard: 'ERC-721' };
    afterToken.props.onSendCollectible(collectible);
    const nftRoute = f.render();
    assert.equal(nftRoute.type, 'NativeSmartAccountSend');
    assert.equal(nftRoute.props.collectible, collectible);
    assert.equal(f.hardwareBack(), false);
    nftRoute.props.onBack();
    assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.equal(f.exits(), 0);
  } finally { f.dispose(); }
});


test('controlled Smart accounts expose the existing guardian-status tool through the actual wallet Tools branch', async () => {
  const f = await mounted(true, true);
  f.showTools();
  const tools = find(f.render(), (node) => node.type === 'RealTools');
  assert.ok(tools?.props.guardianRecovery);
  assert.equal(tools.props.guardianRecovery.address, '0x' + '11'.repeat(20));
  await tools.props.guardianRecovery.read(new AbortController().signal, () => undefined);
  assert.equal(f.guardianReads(), 1);
  assert.equal(tools.props.guardianRecovery.manage.chainId, 1);
  await tools.props.guardianRecovery.recovery.openRecoveryAlerts();
  assert.deepEqual(f.openedLinks(), [PALI_RECOVERY_ALERTS_URL]);
  const draft = { action: 'set', guardian: '0x' + '55'.repeat(20), delaySeconds: 259200, acknowledgedPendingOperationId: null };
  await tools.props.guardianRecovery.manage.open(draft, new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
  assert.equal(f.guardianOpens(), 1);
  f.ready();
  await assert.rejects(tools.props.guardianRecovery.read(new AbortController().signal, () => undefined), /CANCELLED/);
  assert.equal(f.guardianReads(), 1);
  await assert.rejects(tools.props.guardianRecovery.manage.open(draft, new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope()), /CANCELLED/);
  assert.equal(f.guardianOpens(), 1);
  await assert.rejects(tools.props.guardianRecovery.recovery.openRecoveryAlerts(), /CANCELLED/);
  assert.equal(f.openedLinks().length, 1);
  f.dispose();
});

test('ordinary controlled EOAs do not gain a guardian-status entry', async () => {
  const f = await mounted(true, false, false);
  f.showTools();
  const tools = find(f.render(), (node) => node.type === 'RealTools');
  assert.ok(tools); assert.equal(tools.props.guardianRecovery, undefined);
  assert.equal(f.guardianReads(), 0); f.dispose();
});

test('a closed or backgrounded controlled Smart tool cannot use its captured read capability', async () => {
  for (const retire of ['background', 'dispose'] as const) {
    const f = await mounted(true, true); f.showTools();
    const tools = find(f.render(), (node) => node.type === 'RealTools')!;
    if (retire === 'background') f.background(); else f.dispose();
    await assert.rejects(tools.props.guardianRecovery.read(new AbortController().signal, () => undefined), /CANCELLED/);
    assert.equal(f.guardianReads(), 0);
    f.dispose();
  }
});


test('guardian pane identity changes after owner retirement even when the restored account revision matches', async () => {
  const f = await mounted(true, true);
  try {
    f.showTools();
    const previous = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    f.background();
    f.foreground();
    await settle(); await settle();
    f.readyAtRevision(1);
    const current = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    assert.notEqual(current.scope, previous.scope);
    await assert.rejects(previous.read(new AbortController().signal, () => undefined), /CANCELLED/);
    await current.read(new AbortController().signal, () => undefined);
  } finally { f.dispose(); }
});


test('closing a guardian operation refreshes the visible Smart account without an authority event', async () => {
  const f = await mounted(true, true);
  try {
    const original = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(original.props.smartAccount.isDeployed, false);
    f.showTools();
    const tools = find(f.render(), node => node.type === 'RealTools')!;
    f.completeDeployment();
    tools.props.onGuardianClose();
    f.showWallet();
    const refreshed = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(refreshed.props.smartAccount.isDeployed, true);
    assert.equal(refreshed.props.onDeploySmartAccount, undefined);
  } finally { f.dispose(); }
});


test('recovery remains available for a verified Smart account without its original signing owner', async () => {
  const f = await mounted(true, true, false, false);
  try {
    f.showTools();
    const tool = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    assert.equal(tool.manage, undefined);
    assert.equal(tool.recovery.hasIntent, true);
    await tool.recovery.open({ kind: 'resume' }, new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    assert.equal(f.recoveryOpens(), 1);
    f.background();
    await assert.rejects(tool.recovery.open({ kind: 'resume' }, new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope()), /CANCELLED/);
    assert.equal(f.recoveryOpens(), 1);
  } finally { f.dispose(); }
});


test('saved recovery transaction handoff selects its payer and returns to the verified Smart target', async () => {
  const f = await mounted(true, true, false, false, true);
  try {
    f.showTools();
    const initial = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    const hash = '0x' + 'aa'.repeat(32);
    await initial.recovery.onActivity('hd:60:1', 1, hash);
    const activity = find(f.render(), node => node.type === 'AllNetworksActivity');
    assert(activity);
    assert.equal(activity.props.initialTarget.networkId, 'ethereum');
    assert.equal(activity.props.initialTarget.hash, hash);
    const back = find(f.render(), node => node.props.title === 'Return to recovery');
    assert(back);
    back.props.onPress(); await settle();
    const tools = find(f.render(), node => node.type === 'RealTools');
    assert(tools);
    assert.equal(tools.props.guardianRecovery.address, '0x' + '11'.repeat(20));
    assert.equal(tools.props.initialGuardianScope, tools.props.guardianRecovery.scope);
    assert.equal(f.recoveryOpens(), 0);
    await assert.rejects(initial.recovery.onActivity('hd:60:1', 1, hash), /CANCELLED/);
  } finally { f.dispose(); }
});


test('Pali wallet authenticator entry uses runtime eligibility and retains ownership across metadata revisions', async () => {
  const f = await mounted(true, true);
  try {
    assert.equal(find(f.render(), node => node.type === 'NativePortfolio')!.props.onUseWalletAuthenticator, undefined);
    f.completeDeployment();
    f.readyAtRevision(2);
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(typeof portfolio.props.onUseWalletAuthenticator, 'function');
    portfolio.props.onUseWalletAuthenticator();
    const route = f.render();
    assert.equal(route.type, 'NativeSmartAccountAuthenticator');
    await route.props.open(new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    assert.equal(f.authenticatorGuards().length, 1);
    f.readyAtRevision(3);
    const refreshedRoute = f.render();
    assert.equal(refreshedRoute.type, 'NativeSmartAccountAuthenticator');
    assert.equal(refreshedRoute.props.open, route.props.open);
    f.authenticatorGuards()[0]!();
    // The leaf drains any pending open before calling this parent callback.
    assert.equal(f.hardwareBack(), false);
    refreshedRoute.props.onBack();
    assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
    assert.equal(f.exits(), 0);
  } finally { f.dispose(); }
});

test('Pali wallet authenticator entry stays hidden for a runtime-ineligible Smart account', async () => {
  const f = await mounted(true, true, false, false);
  try {
    f.completeDeployment();
    f.readyAtRevision(2);
    assert.equal(find(f.render(), node => node.type === 'NativePortfolio')!.props.onUseWalletAuthenticator, undefined);
  } finally { f.dispose(); }
});

test('Pali wallet authenticator owner is revoked when the wallet backgrounds', async () => {
  const f = await mounted(true, true);
  try {
    f.completeDeployment();
    f.readyAtRevision(2);
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onUseWalletAuthenticator();
    const route = f.render();
    await route.props.open(new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    f.background();
    assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
    assert.notEqual(f.render().type, 'NativeSmartAccountAuthenticator');
  } finally { f.dispose(); }
});

test('SLH management and Smart send use runtime signer availability independently of the guardian ECDSA gate', async () => {
  const f = await mounted(true, true, false, false, false, true);
  try {
    f.completeDeployment(); f.readyAtRevision(2);
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(typeof portfolio.props.onSend, 'function');
    assert.equal(typeof portfolio.props.onManageSlhDsa, 'function');
    assert.equal(portfolio.props.onUseWalletAuthenticator, undefined, 'fixture deliberately withholds that separate target route');
    portfolio.props.onManageSlhDsa(); const route = f.render();
    assert.equal(route.type, 'NativeSlhDsaManagementScreen');
    await route.props.open(new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    assert.equal(f.authenticatorGuards().length, 1); f.authenticatorGuards()[0]!();
    assert.equal(f.hardwareBack(), false, 'management leaf owns its drain-before-Back');
    route.props.onBack(); assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
  } finally { f.dispose(); }
});

test('SLH management is hidden behind the runtime qualification capability and retires on background', async () => {
  const gated = await mounted(true, true, false);
  try { assert.equal(find(gated.render(), node => node.type === 'NativePortfolio')!.props.onManageSlhDsa, undefined); }
  finally { gated.dispose(); }
  const f = await mounted(true, true, false, false, false, true);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onManageSlhDsa();
    const route = f.render(); await route.props.open(new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    f.background(); assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
    assert.notEqual(f.render().type, 'NativeSlhDsaManagementScreen');
  } finally { f.dispose(); }
});

test('Trezor Continue opens a fresh Smart review through a stable guarded opener and the route signal', async () => {
  const f = await mounted(true, true);
  try {
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    portfolio.props.hardwareRequest.props.onResume();
    const trezor = f.render();
    assert.equal(trezor.type, 'NativeTrezor');
    await trezor.props.onResumeSend(Object.freeze({kind: 'smart-operation', id: 'public-smart-resume', accountId: 'smart:60:0', networkId: 'ethereum'}));
    assert.deepEqual(f.resumedSmart(), [], 'Continue changes only the public route');
    const route = f.render();
    assert.equal(route.type, 'NativeSmartAccountOperationRoute');
    assert.equal(f.hardwareBack(), false, 'the operation route owns cancellation and disposal');
    const lifetime = new AbortController();
    await route.props.open(() => undefined, lifetime.signal, privateAuthentication.createNativePrivateAuthenticationScope());
    assert.equal(f.resumedSmart().length, 1);
    assert.equal(f.resumedSmart()[0]!.id, 'public-smart-resume');
    assert.equal(f.resumedSmart()[0]!.signal, lifetime.signal);
    f.resumedSmart()[0]!.check();
    f.readyAtRevision(2);
    assert.equal(f.render().props.open, route.props.open);
    route.props.onBack();
    assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.throws(f.resumedSmart()[0]!.check, /CANCELLED/);
    await assert.rejects(route.props.open(() => undefined, lifetime.signal, privateAuthentication.createNativePrivateAuthenticationScope()), /CANCELLED/);
    assert.equal(f.resumedSmart().length, 1);
  } finally {f.dispose();}
});

test('wallet background records the local Trezor departure before locking a resumed Smart route', async () => {
  const f = await mounted(true, true);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.hardwareRequest.props.onResume();
    await f.render().props.onResumeSend({kind: 'smart-operation', id: 'public-smart-resume', accountId: 'smart:60:0', networkId: 'ethereum'});
    const route = f.render(), lifetime = new AbortController();
    await route.props.open(() => undefined, lifetime.signal, privateAuthentication.createNativePrivateAuthenticationScope());
    const offset = f.lifecycle().length;
    f.background();
    assert.deepEqual(f.lifecycle().slice(offset), ['trezor-background', 'psbt-background', 'lock']);
    assert.throws(f.resumedSmart()[0]!.check, /CANCELLED/);
    assert.notEqual(f.render().type, 'NativeSmartAccountOperationRoute');
  } finally {f.dispose();}
});

test('manual wallet lock cancels local Trezor work before locking custody', async () => {
  const f = await mounted(true, true);
  try {
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    const offset = f.lifecycle().length;
    portfolio.props.onLock();
    assert.deepEqual(f.lifecycle().slice(offset), ['trezor-cancel', 'psbt-cancel', 'lock']);
  } finally {f.dispose();}
});


for (const routeKind of ['authenticator', 'slh'] as const) test(`actual NativeWallet ${routeKind} parent preserves only its owned prompt interruption`, async () => {
  const f = await mounted(true, true, false, routeKind === 'authenticator', false, routeKind === 'slh');
  const scope = privateAuthentication.createNativePrivateAuthenticationScope();
  const binding = privateAuthentication.bindNativePrivateAuthentication(scope, { assertCurrent() {}, isPromptActive: () => true });
  try {
    f.completeDeployment(); f.readyAtRevision(2);
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    if (routeKind === 'authenticator') portfolio.props.onUseWalletAuthenticator(); else portfolio.props.onManageSlhDsa();
    const route = f.render();
    await route.props.open(new AbortController().signal, () => undefined, scope);
    const guard = f.authenticatorGuards()[0]!;
    const before = f.lifecycle().length;
    await privateAuthentication.withNativePrivateAuthentication(binding, new AbortController().signal, () => undefined, async () => {
      f.prompt(true); f.inactive(); guard(); f.blur(); guard();
      assert.equal(f.render().type, route.type);
      assert.equal(f.lifecycle().length, before, 'the native prompt must not lock custody');
      f.foreground(); f.prompt(false); guard();
    });
    f.inactive();
    assert.throws(guard, /CANCELLED/);
    assert.notEqual(f.render().type, route.type);
  } finally { scope.retire(); f.dispose(); }
});

test('Trezor infrastructure Continue opens only its dedicated fresh-review route with exact request and signal binding', async () => {
  const f = await mounted(true, false, false, true, false, false, true);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.hardwareRequest.props.onResume();
    const trezor = f.render(); assert.equal(trezor.type, 'NativeTrezor');
    await trezor.props.onResumeSend({ kind: 'infrastructure', id: 'infrastructure-suite-job', accountId: 'trezor:60:0', networkId: 'ethereum' });
    assert.deepEqual(f.resumedInfrastructure(), [], 'Continue only changes the route; no signing or host operation starts');
    const route = f.render();
    assert.equal(route.type, 'NativeInfrastructure');
    assert.equal(route.props.mode.kind, 'suite-resume'); assert.equal(route.props.mode.id, 'infrastructure-suite-job');
    assert.equal(route.props.ledgerConnection, undefined);
    assert.equal(f.hardwareBack(), false, 'the infrastructure leaf owns cancellation and disposal');
    const lifetime = new AbortController();
    await route.props.open(lifetime.signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    assert.equal(f.resumedInfrastructure().length, 1);
    assert.equal(f.resumedInfrastructure()[0]!.id, 'infrastructure-suite-job');
    assert.equal(f.resumedInfrastructure()[0]!.signal, lifetime.signal); f.resumedInfrastructure()[0]!.check();
    f.readyAtRevision(2); assert.equal(f.render().props.open, route.props.open);
    route.props.onBack(); assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.throws(f.resumedInfrastructure()[0]!.check, /CANCELLED/);
    await assert.rejects(route.props.open(lifetime.signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope()), /CANCELLED/);
    assert.equal(f.resumedInfrastructure().length, 1); assert.deepEqual(f.resumedSmart(), []);
  } finally { f.dispose(); }
});

test('wallet background captures the infrastructure Suite departure before lock and invalidates its old opener', async () => {
  const f = await mounted(true, false, false, true, false, false, true);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.hardwareRequest.props.onResume();
    await f.render().props.onResumeSend({ kind: 'infrastructure', id: 'infrastructure-suite-job', accountId: 'trezor:60:0', networkId: 'ethereum' });
    const route = f.render(), lifetime = new AbortController();
    await route.props.open(lifetime.signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    const offset = f.lifecycle().length; f.background();
    assert.deepEqual(f.lifecycle().slice(offset), ['trezor-background', 'psbt-background', 'lock']);
    assert.throws(f.resumedInfrastructure()[0]!.check, /CANCELLED/);
    assert.notEqual(f.render().type, 'NativeInfrastructure');
    f.foreground(); f.ready(); f.render();
    assert.equal(f.resumedInfrastructure().length, 1, 'unlock must not resume or approve the operation');
  } finally { f.dispose(); }
});

test('deliberate wallet lock survives foreground resume and opens only after OS authorization', async () => {
  const f = await mounted(true, false, false);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onLock();
    await settle();
    assert.equal(f.viewPrivacy.marker(), 'locked');
    f.foreground(); await settle();
    assert.equal(f.viewAuthorizations(), 0);
    const open = find(f.render(), node => node.props.title === 'Unlock wallet'); assert(open);
    open.props.onPress(); await settle();
    assert.equal(f.viewAuthorizations(), 1);
    assert.equal(f.viewPrivacy.marker(), 'unlocked');
    assert(find(f.render(), node => node.type === 'NativePortfolio'));
  } finally { f.dispose(); }
});

test('a persisted lock hides the public wallet after mounting and cancelled OS authorization keeps it hidden', async () => {
  const f = harness(true, false, false);
  await f.viewPrivacy.viewLock.lock();
  f.rejectViewAuthorization();
  try {
    f.render(); await settle(); f.render();
    assert.equal(find(f.render(), node => node.type === 'NativePortfolio'), undefined);
    find(f.render(), node => node.props.title === 'Unlock wallet')!.props.onPress(); await settle();
    assert.equal(f.viewAuthorizations(), 1);
    assert.equal(f.viewPrivacy.marker(), 'locked');
    assert.equal(find(f.render(), node => node.type === 'NativePortfolio'), undefined);
  } finally { f.dispose(); }
});

test('update installation waits for full controller release and suppresses foreground reopening', async () => {
  const f = await mounted(true, false, false);
  const held = f.holdRelease();
  try {
    f.showSettings();
    find(f.render(), node => node.type === 'RealSettings')!.props.onUpdate();
    assert.equal(f.render().type, 'WalletUpdateScreen');
    assert.equal(f.render().props.phase, 'closing');
    assert.equal(f.releases(), 1);
    const acquired = f.acquisitions();
    f.background(); f.foreground(); await settle();
    assert.equal(f.acquisitions(), acquired);
    assert.equal(f.render().props.phase, 'closing');
    held.resolve(); await settle();
    assert.equal(f.render().props.phase, 'ready');
    f.render().props.onBack(); await settle();
    assert.equal(f.acquisitions(), acquired + 1);
    assert.notEqual(f.render().type, 'WalletUpdateScreen');
  } finally { held.resolve(); f.dispose(); }
});

test('update Back waits for controller release before reacquiring the public wallet', async () => {
  const f = await mounted(true, false, false);
  const held = f.holdRelease();
  try {
    f.showSettings(); find(f.render(), node => node.type === 'RealSettings')!.props.onUpdate();
    const acquired = f.acquisitions();
    assert.equal(f.hardwareBack(), true); await settle();
    assert.equal(f.render().props.phase, 'closing');
    assert.equal(f.acquisitions(), acquired);
    held.resolve(); await settle();
    assert.equal(f.acquisitions(), acquired + 1);
    assert.notEqual(f.render().type, 'WalletUpdateScreen');
  } finally { held.resolve(); f.dispose(); }
});

test('reentrant Back during update lock publication waits for the actual release', async () => {
  const f = await mounted(true, false, false);
  const held = f.holdRelease();
  try {
    const acquired = f.acquisitions();
    f.duringLock(() => { assert.equal(f.hardwareBack(), true); });
    f.showSettings(); find(f.render(), node => node.type === 'RealSettings')!.props.onUpdate();
    await settle();
    assert.equal(f.render().props.phase, 'closing');
    assert.equal(f.acquisitions(), acquired);
    held.resolve(); await settle();
    assert.equal(f.acquisitions(), acquired + 1);
    assert.notEqual(f.render().type, 'WalletUpdateScreen');
  } finally { held.resolve(); f.dispose(); }
});

test('failed controller release never grants update installation', async () => {
  const f = await mounted(true, false, false);
  const held = f.holdRelease();
  try {
    f.showSettings(); find(f.render(), node => node.type === 'RealSettings')!.props.onUpdate();
    held.reject(Error('cleanup failed')); await settle();
    assert.equal(f.render().type, 'WalletUpdateScreen');
    assert.equal(f.render().props.phase, 'failed');
    f.foreground(); await settle();
    assert.equal(f.render().props.phase, 'failed');
  } finally { f.dispose(); }
});

test('an infrastructure resume discriminator cannot route a selected software account into its hardware continuation', async () => {
  const f = await mounted(true, false, false);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.hardwareRequest.props.onResume();
    await assert.rejects(f.render().props.onResumeSend({ kind: 'infrastructure', id: 'forged-suite-job', accountId: 'hd:60:0', networkId: 'ethereum' }), /CANCELLED/);
    assert.deepEqual(f.resumedInfrastructure(), []);
    assert.equal(f.render().type, 'NativeTrezor');
  } finally { f.dispose(); }
});

for (const action of ['speed-up', 'cancel', 'cancel-saved'] as const) test(`Smart Activity ${action} reaches the retained-payer review and bound result without an owner connection`, async () => {
  const f = await mounted(true, true, false, false);
  try {
    f.showActivity();
    const activity = find(f.render(), node => node.type === 'AllNetworksActivity'); assert(activity);
    assert.equal(typeof activity.props.onAction, 'function');
    const hash = '0x' + 'ab'.repeat(32), result = '0x' + 'cd'.repeat(32);
    await activity.props.onAction({ choice: f.activityChoice(), row: { hash } }, action, hash, () => undefined);
    await settle(); f.render(); await settle();
    const review = f.render();
    assert.equal(review.type, 'NativeSend');
    assert.equal(review.props.replacement.mode, action); assert.equal(review.props.replacement.hash, hash);
    review.props.onViewTransaction(result);
    const completed = find(f.render(), node => node.type === 'AllNetworksActivity'); assert(completed);
    assert.equal(completed.props.initialTarget.networkId, 'ethereum'); assert.equal(completed.props.initialTarget.hash, result);
    review.props.onViewTransaction(hash);
    assert.equal(find(f.render(), node => node.type === 'AllNetworksActivity')!.props.initialTarget.hash, result);
  } finally { f.dispose(); }
});

for (const interruption of ['inactive', 'blur'] as const) test(`camera permission ${interruption} preserves the public Send route but never real background`, async () => {
  const f = await mounted(true, true, false);
  try {
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    portfolio.props.onSend();
    const route = f.render(); assert.equal(route.type, 'NativeSmartAccountSend');
    const before = f.lifecycle().length;
    f.cameraPrompt(true); f[interruption]();
    assert.equal(f.render().type, route.type);
    assert.equal(f.lifecycle().length, before, 'the public camera dialog must not revoke the send draft');
    f.foreground(); f.cameraPrompt(false);
    assert.equal(f.render().type, route.type);
    f.cameraPrompt(true); f.background();
    assert.notEqual(f.render().type, route.type, 'background still retires a send even during a camera request');
    assert(f.lifecycle().slice(before).includes('lock'));
  } finally { f.dispose(); }
});

test('inactive without a camera prompt still retires the Send route', async () => {
  const f = await mounted(true, true, false);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onSend();
    assert.equal(f.render().type, 'NativeSmartAccountSend');
    f.inactive(); assert.notEqual(f.render().type, 'NativeSmartAccountSend');
  } finally { f.dispose(); }
});

for (const granted of [true, false]) test(`actual camera port ${granted ? 'grant' : 'denial'} preserves the mounted wallet Send route`, async () => {
  const f = await mounted(true, true, false);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onSend();
    const route = f.render(); assert.equal(route.type, 'NativeSmartAccountSend');
    const pending = f.requestCameraPermission(); await settle();
    f.inactive(); f.blur(); assert.equal(f.render().type, route.type);
    f.finishCameraPermission(granted); await settle();
    assert.equal(f.render().type, route.type);
    f.foreground(); assert.equal((await pending).granted, granted);
    assert.equal(f.render().type, route.type);
  } finally { f.dispose(); }
});

test('real background during the actual camera port request still retires the mounted wallet', async () => {
  const f = await mounted(true, true, false);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onSend();
    assert.equal(f.render().type, 'NativeSmartAccountSend');
    const pending = f.requestCameraPermission();
    const refused = assert.rejects(pending, /interrupted/); await settle();
    f.background(); assert.notEqual(f.render().type, 'NativeSmartAccountSend');
    f.foreground(); f.finishCameraPermission(true); await refused;
    assert.notEqual(f.render().type, 'NativeSmartAccountSend');
  } finally { f.dispose(); }
});

for (const granted of [true, false]) test(`result-first camera ${granted ? 'grant' : 'denial'} preserves Send through late lifecycle events`, async () => {
  const f = await mounted(true, true, false);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onSend();
    const route = f.render(); assert.equal(route.type, 'NativeSmartAccountSend');
    const before = f.lifecycle().length;
    let settled = false;
    const pending = f.requestCameraPermission().then(value => { settled = true; return value; });
    await settle(); f.finishCameraPermission(granted); await settle();
    assert.equal(settled, false); assert.equal(f.render().type, route.type);
    f.inactive(); f.blur(); assert.equal(f.render().type, route.type);
    assert.equal(f.lifecycle().length, before, 'the queued camera events must not revoke the Send draft');
    f.foreground(); assert.equal((await pending).granted, granted);
    assert.equal(f.render().type, route.type);
    f.background(); assert.notEqual(f.render().type, route.type);
    assert(f.lifecycle().slice(before).includes('lock'));
  } finally { f.dispose(); }
});

function notificationNavigationScreen(action: 'direct-send' | 'filtered-send' | 'filtered-activity', portfolio: Element, choice: any) {
  const direct = action === 'direct-send';
  const file = new URL(`../src/screens/${direct ? 'NativePortfolio' : 'NativeAccountOverview'}.tsx`, import.meta.url);
  const source = readFileSync(file, 'utf8');
  const imports: Record<string, any> = Object.fromEntries([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => [match[1]!, {}]));
  const native = { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener: () => ({ remove() {} }) }, StyleSheet: { create: (value: unknown) => value },
    useWindowDimensions: () => ({ width: 390, fontScale: 1 }) };
  Object.assign(imports, {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'IconButton', 'Row', 'Screen', 'Text'].map(type => [type, type])), colors: {}, styles: {} },
    '../platform/localization': nativeTranslationFixture,
    '../platform/balancePrivacy': { useBalancePrivacy: () => ({ hidden: false }), HIDDEN_BALANCE: 'hidden' },
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }) },
    '../custody/networkContext': networks, '../core/amounts': { formatBaseUnits },
    '../activity/activityAmountLabel': { compactActivityAmountLabel: (value: string) => value },
    '../portfolio/useNativeCoinQuote': { useNativeCoinQuote: () => ({ supported: false }) },
    '../custody/testnetFaucet': { getTestnetFaucet: () => null },
    '../portfolio/nativePortfolio': { NativePortfolioController: class {
      subscribe = () => () => {}; getSnapshot = () => ({ status: 'available', account: { ...portfolio.props.source.getSnapshot().account, revision: 1 }, units: '1000000000000000000', updatedAt: null });
      connect = () => () => {}; isCurrent = () => true; getUtxoNetwork = () => undefined; getNetworkRegistration = () => networks.getNativeNetwork('ethereum');
    } },
  });
  const screen = screenFixture(file, direct ? 'NativePortfolio' : 'NativeAccountOverview', imports);
  const controller = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', filter: 'ethereum', choices: [choice], rows: [], currency: null }),
    setCurrency() {}, connect: () => () => {}, cachedBalances: () => [] };
  let tree = screen.render(direct ? portfolio.props : { controller, portfolio: portfolio.props, selectNetwork: portfolio.props.selectNetwork,
    send: portfolio.props.sendFrom, navigateActivity: portfolio.props.navigateActivity });
  if (direct) tree = screen.renderChild(tree);
  const control = screenElements(tree).find(node => node.props.title === (action === 'filtered-activity' ? 'Activity' : 'Send'));
  assert(control, `missing actual ${action} control`);
  return { press: () => control.props.onPress(), close: screen.close };
}

for (const action of ['none', 'stale-account-navigation', 'direct-send', 'filtered-send', 'filtered-activity'] as const) test(`late notification permission respects ${action} through the actual wallet and navigation hook`, async () => {
  const f = await mounted(true, false, false, true, false, false, false, true);
  try {
    f.showSettings();
    const settings = find(f.render(), node => node.type === 'RealSettings'); assert(settings);
    const result = Promise.withResolvers<'granted'>();
    settings.props.notifications.onPermissionPresentation(f.activityChoice().scope, result.promise);
    f.background(); f.render();
    assert(f.lifecycle().includes('lock'), 'actual background still revokes custody');
    f.foreground(); f.render(); await settle(); f.render(); await settle();
    const open = find(f.render(), node => node.props.title === 'Open wallet');
    if (open) { open.props.onPress(); await settle(); f.render(); await settle(); }
    f.ready(); f.render(); await settle();
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio'); assert(portfolio);
    if (action === 'stale-account-navigation') {
      await assert.rejects(portfolio.props.navigateActivity(f.activityChoice(), () => { throw Error('STALE_VIEW'); }), /STALE_VIEW/);
      await assert.rejects(portfolio.props.navigateActivity({ ...f.activityChoice(), scope: { ...f.activityChoice().scope, accountId: 'missing' } }, () => {}), /CANCELLED/);
    }
    const controls = action === 'none' || action === 'stale-account-navigation' ? null : notificationNavigationScreen(action, portfolio, f.activityChoice());
    controls?.press();
    f.render(); await settle(); f.render();
    controls?.close();
    result.resolve('granted'); await settle(); f.render(); await settle();
    const tree = f.render();
    if (action === 'none' || action === 'stale-account-navigation') {
      assert(find(tree, node => node.type === 'RealSettings')?.props.notificationReturn);
      f.showWallet(); f.render(); f.showSettings();
      assert.equal(find(f.render(), node => node.type === 'RealSettings')?.props.notificationReturn, null, 'a later manual visit does not reuse the consumed return');
    }
    else if (action === 'filtered-activity') assert.equal(find(tree, node => node.type === 'RealAppShell')?.props.tab, 'activity');
    else {
      const send = find(tree, node => node.type === 'NativeSend'); assert(send);
      send.props.onBack(); f.render(); await settle();
      assert.equal(find(f.render(), node => node.type === 'RealAppShell')?.props.tab, 'wallet');
    }
  } finally { f.dispose(); }
});

for (const accountId of ['hd:60:0', 'hd:60:1']) for (const destination of ['detail', 'activity'] as const)
  test(`Accounts return for ${accountId} admits current ${destination} navigation`, async () => {
    const f = await mounted(true, false, false, true, false, false, false, true, true);
    try {
      f.showTools();
      find(f.render(), node => node.type === 'RealTools')!.props.onAccounts();
      const accounts = f.render();
      assert.equal(accounts.type, 'WalletAccounts');
      await accounts.props.onSelect({ kind: 'hd', id: accountId });
      f.render();
      f.showWallet();
      const portfolio = find(f.render(), node => node.type === 'NativePortfolio'); assert(portfolio);
      const choice = f.activityChoice();
      assert.equal(choice.scope.accountId, accountId);
      assert.equal(f.selectionCalls(), accountId === 'hd:60:0' ? 0 : 1);
      if (destination === 'detail') {
        await portfolio.props.navigateDetail(choice, false, undefined, () => {});
        const detail = find(f.render(), node => node.type === 'NativePortfolio')!.props.detail;
        assert.equal(detail.accountId, accountId);
        assert.equal(detail.networkId, 'ethereum');
        assert.equal(detail.receive, false);
      } else {
        await portfolio.props.navigateActivity(choice, () => {});
        assert.equal(find(f.render(), node => node.type === 'RealAppShell')!.props.tab, 'activity');
      }
    } finally { f.dispose(); }
  });

test('late Accounts selection cannot close a newer Accounts route', async () => {
  const f = await mounted(true, false, false, true, false, false, false, true, true);
  const gate = f.holdSelection();
  let pending: Promise<void> | undefined;
  try {
    f.showTools();
    find(f.render(), node => node.type === 'RealTools')!.props.onAccounts();
    const previous = f.render();
    pending = previous.props.onSelect({ kind: 'hd', id: 'hd:60:1' });
    await settle();
    previous.props.onBack();
    find(f.render(), node => node.type === 'RealTools')!.props.onAccounts();
    assert.equal(f.render().type, 'WalletAccounts');
    gate.resolve(); await pending;
    assert.equal(f.render().type, 'WalletAccounts', 'the previous completion does not clear the new route owner');
  } finally { gate.resolve(); await pending; f.dispose(); }
});

for (const stale of [false, true]) test(`Trezor external resume ${stale ? 'preserves a newer route' : 'returns with current Home navigation'}`, async () => {
  const f = await mounted(true, false, false, true, false, false, true, true, true);
  const gate = Promise.withResolvers<void>();
  f.resumeExternal(() => gate.promise);
  let pending: Promise<void> | undefined;
  try {
    f.showTools();
    find(f.render(), node => node.type === 'RealTools')!.props.onAccounts();
    f.render().props.onManageHd();
    f.render().props.onTrezor();
    const trezor = f.render(); assert.equal(trezor.type, 'NativeTrezor');
    pending = trezor.props.onResumeSend({ kind: 'external-signing', id: 'external-request', accountId: 'trezor:60:0', networkId: 'ethereum' });
    await settle();
    assert.deepEqual(f.externalResumes(), ['external-request']);
    if (stale) {
      trezor.props.onBack();
      f.render().props.onBack();
      f.render().props.onBack();
      find(f.render(), node => node.type === 'RealTools')!.props.onAccounts();
      assert.equal(f.render().type, 'WalletAccounts');
    }
    gate.resolve(); await pending;
    if (stale) assert.equal(f.render().type, 'WalletAccounts');
    else {
      f.render(); f.showWallet();
      const portfolio = find(f.render(), node => node.type === 'NativePortfolio'); assert(portfolio);
      await portfolio.props.navigateActivity(f.activityChoice(), () => {});
      assert.equal(find(f.render(), node => node.type === 'RealAppShell')!.props.tab, 'activity');
    }
  } finally { gate.resolve(); await pending; f.dispose(); }
});

test('late Trezor external resume cannot close a newer visit under the same Accounts root', async () => {
  const f = await mounted(true, false, false, true, false, false, true, true, true);
  const gate = Promise.withResolvers<void>();
  f.resumeExternal(() => gate.promise);
  let pending: Promise<void> | undefined;
  try {
    f.showTools();
    find(f.render(), node => node.type === 'RealTools')!.props.onAccounts();
    f.render().props.onManageHd();
    f.render().props.onTrezor();
    const firstVisit = f.render(); assert.equal(firstVisit.type, 'NativeTrezor');
    pending = firstVisit.props.onResumeSend({ kind: 'external-signing', id: 'external-request', accountId: 'trezor:60:0', networkId: 'ethereum' });
    await settle();
    assert.deepEqual(f.externalResumes(), ['external-request']);
    firstVisit.props.onBack();
    const manage = f.render(); assert.equal(manage.type, 'NativeAccounts');
    manage.props.onTrezor();
    assert.equal(f.render().type, 'NativeTrezor');
    gate.resolve(); await pending;
    assert.equal(f.render().type, 'NativeTrezor', 'the previous completion does not close a new Trezor visit under the same root');
  } finally { gate.resolve(); await pending; f.dispose(); }
});

test('visible Smart overview adopts runtime-only metadata publication without an authority event or revision loop', async () => {
  const f = await mounted(true, true, false, true, false, false, false, true);
  try {
    assert.equal(typeof find(f.render(), node => node.type === 'NativePortfolio')!.props.onDeploySmartAccount, 'function');
    const authority = f.authoritySnapshot();
    f.observeDeployment(true);
    f.showTools(); f.render();
    f.showWallet(); f.render(); await settle(); f.render(); await settle();
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(portfolio.props.smartAccount.isDeployed, true);
    assert.equal(portfolio.props.onDeploySmartAccount, undefined);
    assert.equal(typeof portfolio.props.onManageSmartAccountModules, 'function');
    assert.equal(typeof portfolio.props.onUseWalletAuthenticator, 'function');
    assert.equal(f.authoritySnapshot(), authority, 'metadata publication does not replace or notify the authority snapshot');
    assert.equal(f.metadataReads().length, 2);
    f.render(); await settle(); f.render();
    assert.equal(f.metadataReads().length, 2, 'publishing metadata does not start another read');
    assert.equal(f.viewAuthorizations(), 0, 'public metadata refresh does not request OS authorization');
  } finally { f.dispose(); }
});

test('manual Smart metadata refresh preserves the same open asset detail and coalesces requests', async () => {
  const f = await mounted(true, true, false, true, false, false, false, true);
  const gate = f.holdMetadata();
  try {
    let portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    await portfolio.props.navigateDetail(f.activityChoice(), false, undefined, () => {});
    portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    const detail = portfolio.props.detail;
    assert(detail);
    let duringPublication: unknown;
    let forcedPublicationRender = false;
    f.beforeMetadataPublished(() => { f.render(); forcedPublicationRender = true; });
    f.onMetadataPublished(() => {
      duringPublication = find(f.render(), node => node.type === 'NativePortfolio')!.props.detail;
    });
    f.observeDeployment(true);
    const first = portfolio.props.onRefreshSmartAccount(), second = portfolio.props.onRefreshSmartAccount();
    await settle();
    assert.equal(f.metadataReads().length, 2);
    gate.resolve(); await Promise.all([first, second]);
    portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(portfolio.props.smartAccount.isDeployed, true);
    assert.equal(forcedPublicationRender, true);
    assert.equal(duringPublication, detail, 'the detail is preserved in the publication turn before the refresh promise returns');
    assert.equal(portfolio.props.detail, detail, 'only the owned detail context is advanced');
    assert.equal(f.metadataReads().length, 2);
  } finally { gate.resolve(); f.dispose(); }
});

test('leaving the Smart overview cancels metadata and cannot revive the previous detail', async () => {
  const f = await mounted(true, true, false, true, false, false, false, true);
  const gate = f.holdMetadata();
  try {
    let portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    await portfolio.props.navigateDetail(f.activityChoice(), false, undefined, () => {});
    portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    f.observeDeployment(true);
    const pending = portfolio.props.onRefreshSmartAccount(); await settle();
    portfolio.props.closeDetail();
    f.showTools(); f.render();
    assert.equal(f.metadataReads().at(-1)!.signal.aborted, true);
    gate.resolve(); await pending;
    assert(find(f.render(), node => node.type === 'RealTools'));
    f.observeDeployment(false);
    f.showWallet(); f.render(); await settle();
    portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(portfolio.props.smartAccount.isDeployed, false);
    assert.equal(portfolio.props.detail, undefined, 'cancelled metadata cannot rebind a stale detail');
    assert.equal(f.metadataReads().length, 3);
    f.render(); await settle(); assert.equal(f.metadataReads().length, 3, 'unchanged undeployed observation does not loop');
  } finally { gate.resolve(); f.dispose(); }
});

test('ordinary account overview does not read Smart deployment metadata', async () => {
  const f = await mounted(true, false, false, true, false, false, false, true);
  try {
    assert.equal(f.metadataReads().length, 0);
    assert.equal(find(f.render(), node => node.type === 'NativePortfolio')!.props.onRefreshSmartAccount, undefined);
  } finally { f.dispose(); }
});

test('an external revision during Smart refresh cannot rebind the previous detail', async () => {
  const f = await mounted(true, true, false, true, false, false, false, true);
  const gate = f.holdMetadata();
  try {
    let portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    await portfolio.props.navigateDetail(f.activityChoice(), false, undefined, () => {});
    portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    f.observeDeployment(true);
    const pending = portfolio.props.onRefreshSmartAccount(); await settle();
    f.readyAtRevision(50); f.render();
    gate.resolve(); await pending;
    portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(portfolio.props.smartAccount.isDeployed, false);
    assert.equal(portfolio.props.detail, undefined);
    assert.equal(f.metadataReads().length, 2);
  } finally { gate.resolve(); f.dispose(); }
});

test('opening a Smart detail retries an unfinished overview observation without a revision loop', async () => {
  const f = await mounted(true, true, false, true, false, false, false, true);
  const gate = f.holdMetadata();
  try {
    f.observeDeployment(true);
    f.showTools(); f.render(); f.showWallet(); f.render(); await settle();
    const abandoned = f.metadataReads().at(-1)!;
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    await portfolio.props.navigateDetail(f.activityChoice(), false, undefined, () => {});
    f.render(); await settle();
    assert.equal(abandoned.signal.aborted, true);
    assert.equal(f.metadataReads().length, 3);
    gate.resolve(); await settle();
    const detail = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(detail.props.smartAccount.isDeployed, true);
    assert(detail.props.detail);
    f.render(); await settle(); assert.equal(f.metadataReads().length, 3);
  } finally { gate.resolve(); f.dispose(); }
});
