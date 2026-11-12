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

function harness(ready = false, smartAccount = false, withPairing = true, canManage = true, handoff = false, slh = false, infrastructure = false) {
  let now = 1000,
    cursor = 0,
    selectionCalls = 0;
  let hardwareBack: (() => boolean) | undefined;
  let exits = 0;
  let shellTab = 'wallet';
  let acquisitions = 0, releases = 0, lifecycleActive = true;
  let releaseGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
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
    async resumeSigning() { throw Error('PSBT resume is outside this fixture'); },
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
      ...(handoff ? [{ id: 'hd:60:1', index: 1, slip44: 60, type: 'HDAccount', address: '0x' + '22'.repeat(20), label: 'Guardian' }] : []),
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
      supportsAccountManagement: () => false,
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
      async execute(request: { id: string }) {
        selectionCalls++;
        if (handoff) {
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
    '../notifications/service': { nativeActivityNotifications: quietActivityNotifications, isNotificationPermissionPromptActive: () => false },
    '../platform/cameraPermission': { isCameraPermissionPromptActive: () => cameraPromptActive || cameraModule.exports.isCameraPermissionPromptActive() },
    '../activity/accountActivity': { AccountActivityController: class {} },
    './BackupIntroduction': { BackupIntroduction: 'BackupIntroduction' },
    './TransactionAuthentication': { TransactionAuthentication: 'TransactionAuthentication' },
    './NativeImportWallet': { NativeImportWallet: 'NativeImportWallet' },
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
  });
  const module = {
    exports: {} as { NativeWalletScreen(props: object): Element; NativeWalletContent(props: object): Element },
  };
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
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
  });
  const controllerRef = { current: null };
  const render = () => {
    cursor = 0;
    const tree = module.exports.NativeWalletContent({
      controllerRef,
      onExit() {
        exits++;
      },
      initialAccountId: 'hd:60:9',
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
    showTools() { shellTab = 'tools'; },
    showWallet() { shellTab = 'wallet'; },
    showSettings() { shellTab = 'settings'; },
    showActivity() { shellTab = 'activity'; },
    activityChoice() { return controllers.getNotificationChoices()[0]!; },
    holdRelease() { return releaseGate = Promise.withResolvers<void>(); },
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

async function mounted(ready = false, smartAccount = false, withPairing = true, canManage = true, handoff = false, slh = false, infrastructure = false) {
  const f = harness(ready, smartAccount, withPairing, canManage, handoff, slh, infrastructure);
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
