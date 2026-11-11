import { freshSmartOperationDeadline } from './nonSuiteSigningHandoff.ts';
import { assertSynchronousEvmFeeGuard } from '../../../source/shared/evmFeeGuard.ts';
import { createNativePrivacyServiceSettings } from '../src/platform/privacyServiceSettings.native.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createTrezorSessions } from '../src/hardware/trezorSessions.ts';
import { CustodyOperationError } from '../src/custody/authority.ts';
import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import * as credentialPlatform from '../src/platform/credentialPort.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import * as unavailableNativePasskeys from '../src/platform/nativePasskeys.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { isCustomUtxoNetworkId } from '../src/core/utxoNetworks.ts';
import { exactUtxoResponseFetch } from '../src/core/utxoReadSession.ts';
import { createSecurityTestFixture } from './idleComponentFixture.ts';
import {
  createGuardianRecoveryFixture,
  GUARDIAN_FIXTURE_ACCOUNT,
} from './native-watch-ui/guardianRecoveryFixture.ts';
import { GUARDIAN_FIXTURE_RUNTIME } from './guardianRecoveryRuntime.ts';
import { NativeSmartAccountOperation, type PreparedSmartAccountOperation } from '../src/smartAccount/operation.ts';
import { buildGuardianPolicyExecutions } from '../../../source/utils/smartAccount/guardianPolicy.ts';
import { encodeSmartAccountGasLimits, encodeSmartAccountGasFees } from '../../../source/utils/smartAccount/account.ts';

async function fixture(smart = true) {
  const rpc = createGuardianRecoveryFixture();
  rpc.select('healthy', GUARDIAN_FIXTURE_RUNTIME);
  const network = getNativeNetwork('ethereum');
  let snapshot: any = {
    phase: 'ready',
    revision: 1,
    account: { address: GUARDIAN_FIXTURE_ACCOUNT, network: network.id },
  };
  let catalogue: any = {
    revision: 1,
    active: { accountId: 'selected', networkId: network.id },
    networks: [network],
    utxoNetworks: [],
    accounts: [
      {
        id: 'selected',
        type: smart ? 'SmartAccount' : 'HDAccount',
        address: GUARDIAN_FIXTURE_ACCOUNT,
        smartAccount: smart ? { chainId: 1 } : undefined,
      },
    ],
  };
  const listeners = new Set<() => void>();
  const trezor = { subscribe: () => () => undefined };
  let runtime: any = { catalogue: { getSnapshot: () => catalogue }, trezor };
  const slhCounts = { opened: 0, installed: 0 };
  let promptActive = false;
  let slhAuthentication: privateAuthentication.NativePrivateAuthentication | null = null;
  const slhOperation = { dispose() {} };
  runtime.openSlhDsaAccount = async (check: () => void, _signal: AbortSignal, authentication: privateAuthentication.NativePrivateAuthentication | null) => { slhAuthentication = authentication; slhCounts.opened++; check(); return { installedKeys: [] }; };
  runtime.openSlhDsaInstallation = async (_keyId: string, _signal: AbortSignal, check: () => void) => { slhCounts.installed++; check(); return slhOperation; };
  let locks = 0;
  class Authority {
    private readonly factory: { open(): Promise<unknown> };
    constructor(factory: { open(): Promise<unknown> }) {
      this.factory = factory;
    }
    initialize() {
      return this.factory.open();
    }
    getSnapshot() {
      return snapshot;
    }
    getCatalogue() {
      return snapshot.phase === 'ready' ? runtime.catalogue.getSnapshot() : null;
    }
    lock() {
      locks++;
      snapshot = { ...snapshot, phase: 'locked', revision: snapshot.revision + 1, account: null };
    }
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  }
  class Passive {
    view = {};
    dispose() {}
  }
  const security = createSecurityTestFixture();
  await security.securityPreferences.load();
  security.custodyIdle.begin({}, () => undefined);
  const unexpectedFeature = () => assert.fail('unexpected feature operation in native factory fixture');
  const dependencies: Record<string, unknown> = {
    './nativePasskeys': unavailableNativePasskeys,
    '../notifications/service': { nativeActivityNotifications: { replaceAccountTypes: unexpectedFeature, disableOwner: unexpectedFeature } },
    '../notifications/choices': { nativeNotificationChoices: unexpectedFeature },
    '../custody/accountIdentity': { parseNativeAccountId: unexpectedFeature },
    '../custody/privateAuthentication.ts': privateAuthentication,
    '../portfolio/scopedPortfolioAssets.ts': { createScopedPortfolioAssetReader: unexpectedFeature },
    './privacyServiceSettings.native': { createNativePrivacyServiceSettings },
    '../../../../source/shared/evmFeeGuard': { assertSynchronousEvmFeeGuard },
    'react-native': { AppState: { currentState: 'active' }, Linking: { openURL: unexpectedFeature } },
    '../crypto/sentryCrypto.native': {
      createNativeSentryCryptoExecutor: (isolated: unknown) => {
        assert.equal(isolated, null, 'production isolated signing stays gated');
        return unexpectedFeature;
      },
    },
    '../crypto/native': { createNativeSlhCapability: () => ({ open: unexpectedFeature, purgePublicCache: unexpectedFeature }) },
    '../custody/networkView': { createNativeNetworkView: () => ({
      getSnapshot: () => null, getContextRevision: unexpectedFeature,
      subscribe: () => () => undefined, select: unexpectedFeature, cancel() {},
    }) },
    '../custody/dappControl': { createNativeDappControlHost: () => ({ context: () => null, prepare: unexpectedFeature }) },
    '../custody/dappRpcReads': { createNativeDappRpcReadHost: () => ({ read: unexpectedFeature }) },
    '../custody/dappSentry': { createNativeDappSentryHost: () => ({ prepare: unexpectedFeature }) },
    '../custody/dappSyscoin': { createNativeDappSyscoinHost: () => ({ registration: unexpectedFeature, anchor: unexpectedFeature, read: unexpectedFeature }) },
    '../portfolio/nativeWatchAsset': {
      createNativeWatchAssetObserver: () => unexpectedFeature,
      prepareNativeWatchAsset: unexpectedFeature,
    },
    '../portfolio/nativeRecipientResolver': { createNativeRecipientResolver: () => ({ resolve: unexpectedFeature }) },
    './security': security,
    './credentialPort.ts': credentialPlatform,
    './credential.native': {
      createNativeCredentialPort: createTestCredentialPort,
      isNativeCredentialPromptActive: () => promptActive,
      nativeCredentialAuthentication: { cancel() {}, run: unexpectedFeature },
    },
    './walletConnectRuntime': {
      prepareWalletConnectRuntime() {
        assert.fail('unexpected WalletConnect');
      },
    },
    '../connections/controller.ts': { NativeConnectionsController: Passive },
    '../hardware/trezorTransport.native': {
      createNativeTrezorSessions: (options: { randomBytes(length: number): Uint8Array }) => createTrezorSessions({
        ...options,
        loadClient: async () => assert.fail('unexpected Trezor SDK load in native factory fixture'),
        openURL: async () => assert.fail('unexpected Trezor handoff in native factory fixture'),
      }),
    },
    '../crypto/sentryPublicKey.native': {
      createNativeSentryPublicKeyDeriver: () => () => assert.fail('unexpected Sentry derivation in native factory fixture'),
    },
    '../custody/ledgerAccounts.ts': { NativeLedgerAccounts: Passive },
    '../../../../source/utils/security/blacklistService': {
      blacklistService: {},
    },
    '../custody/authority.ts': {
      NativeCustodyAuthority: Authority,
      CustodyOperationError,
    },
    '../custody/keyringRuntime.ts': {
      createKeyringRuntimeFactory: () => ({ open: async () => runtime }),
    },
    '../custody/evmTransferReadRpc.ts': { EvmTransferReadRpc },
    '../custody/recovery.ts': { NativeRecoveryCoordinator: Passive },
    '../custody/walletRemoval.ts': { NativeWalletRemoval: Passive },
    '../custody/recoveryInventory.ts': {},
    '../custody/seedBackup.ts': { SeedBackupFlow: Passive },
    '../custody/hdKeyExport.ts': { HdKeyExportFlow: Passive },
    '../custody/transfers.ts': { NativeTransfers: Passive },
    '../portfolio/nativeTokens.ts': { NativeTokens: Passive },
    '../activity/nativeActivity.ts': { NativeActivity: Passive },
    '../activity/explorerReader.ts': { ActivityExplorerReader: Passive },
    '../activity/receiptReader.ts': { ActivityReceiptReader: Passive },
    '../portfolio/erc20ReadRpc.ts': { createErc20Reader: () => ({}) },
    '../portfolio/ownedTokenReader.ts': { createOwnedTokenReader: () => ({}) },
    '../portfolio/nftOwnershipReadRpc.ts': {
      createNftOwnershipReader: () => ({}),
      createNftEnumerationReader: () => () => assert.fail('guardian recovery must not enumerate collectibles'),
    },
    '../custody/utxoActivity.ts': { createNativeUtxoActivity: () => ({}) },
    '../core/utxoActivity.ts': { createUtxoActivityReader: () => ({}) },
    '../core/utxoNetworks.ts': { isCustomUtxoNetworkId },
    '../core/utxoReadSession.ts': { exactUtxoResponseFetch },
    '../core/utxoBalanceReader.ts': {},
    '../platformRpc.ts': { createBalanceReader: () => ({}) },
    '../storage/native': {},
    './cryptoBootstrap': {},
    './http': {
      walletFetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        const response = await rpc.fetch(url, init);
        assert.ok(response, 'unexpected RPC');
        return response;
      },
    },
  };
  const module = {
    exports: {} as typeof import('../src/platform/nativeFactory.native.ts'),
  };
  const source = readFileSync(
    new NodeURL('../src/platform/nativeFactory.native.ts', import.meta.url),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    AbortController,
    process: { env: {} },
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
  });
  const controllers = module.exports.createNativeWalletControllers();
  await controllers.authority.initialize();
  const read = (signal = new AbortController().signal) =>
    controllers.readGuardianRecovery(signal, () => undefined);
  return {
    rpc, controllers, slhCounts, slhOperation,
    authentication: () => slhAuthentication,
    prompt(active: boolean) { promptActive = active; },
    read,
    listeners,
    snapshot: () => snapshot,
    locks: () => locks,
    async deferredPolicyFailure(failure: 'rpc' | 'storage' | 'stale' | 'old-runtime') {
      runtime.openGuardianPolicy = async (_draft: unknown, _signal: AbortSignal, guard: () => void) => {
        const command = { kind: 'install' as const, accountAddress: GUARDIAN_FIXTURE_ACCOUNT,
          chainId: 1, guardian: '0x' + '22'.repeat(20), delaySeconds: 259200 };
        const intent = { kind: 'guardian-policy' as const, command };
        const prepared = { actionHash: '0x' + 'aa'.repeat(32), executions: buildGuardianPolicyExecutions(command),
          userOperation: { nonce: '0', initCode: '0x', callData: '0x',
            accountGasLimits: encodeSmartAccountGasLimits({ callGasLimit: 1, verificationGasLimit: 1 }),
            gasFees: encodeSmartAccountGasFees({ maxFeePerGas: 2, maxPriorityFeePerGas: 1 }), preVerificationGas: '1', paymasterAndData: '0x' },
        } as PreparedSmartAccountOperation;
        return new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: freshSmartOperationDeadline(), intent, account: GUARDIAN_FIXTURE_ACCOUNT, network, assertCurrent: guard,
          async prepare() { return { kind: 'authorization', intent, operation: prepared }; },
          async sign() { return '0xsigned'; },
          async submit(_operation, _signature, _lifetime, check, _review, acknowledge) { check(); acknowledge(prepared.actionHash, 'submit-operation'); return prepared.actionHash; },
          async refreshMetadata() {
            if (failure === 'storage') catalogue = null;
            if (failure === 'stale') snapshot = { ...snapshot, revision: snapshot.revision + 1 };
            if (failure === 'old-runtime') {
              const replacement = catalogue;
              runtime = { catalogue: { getSnapshot: () => replacement }, trezor };
              await controllers.authority.initialize();
              catalogue = null;
            }
            throw Error('metadata unavailable');
          },
        });
      };
      return controllers.openGuardianPolicy({ action: 'set', guardian: '0x' + '22'.repeat(20), delaySeconds: 259200,
        acknowledgedPendingOperationId: null }, new AbortController().signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
    },
    change(kind: string) {
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        ...(kind === 'lock' || kind === 'dispose'
          ? { phase: 'locked', account: null }
          : {}),
      };
      if (kind === 'account' || kind === 'network')
        catalogue = { ...catalogue, revision: catalogue.revision + 1 };
      for (const listener of [...listeners]) listener();
    },
  };
}

test('the controlled Smart read uses the canonical guardian observer and selected registered endpoint', async () => {
  const f = await fixture();
  const status = await f.read();
  assert.equal(status.status, 'observed');
  if (status.status !== 'observed') return;
  assert.equal(status.observation.account, GUARDIAN_FIXTURE_ACCOUNT);
  assert.equal(status.observation.threshold, 1);
  assert.equal(status.observation.pending?.status, 'pending');
  assert.equal(f.rpc.methods().length, 11);
  assert.equal(f.listeners.size, 0);
});

test('a missing compatible policy is explicit and ordinary EOAs cannot invoke the controlled Smart port', async () => {
  const f = await fixture();
  f.rpc.select('eoa', GUARDIAN_FIXTURE_RUNTIME);
  assert.deepEqual(await f.read(), { status: 'no-compatible-policy' });
  const eoa = await fixture(false);
  await assert.rejects(eoa.read(), /NOT_READY/);
  assert.deepEqual(eoa.rpc.methods(), []);
});

for (const kind of [
  'account',
  'network',
  'lock',
  'dispose',
  'pane-close',
] as const)
  test(`controlled guardian read cancels immediately on ${kind}`, async () => {
    const f = await fixture();
    f.rpc.select('hold', GUARDIAN_FIXTURE_RUNTIME);
    const owner = new AbortController();
    const work = f.read(owner.signal);
    const rejected = assert.rejects(work);
    for (let i = 0; f.rpc.methods().length < 2 && i < 20; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.rpc.methods().length, 2);
    if (kind === 'pane-close') owner.abort();
    else f.change(kind);
    await rejected;
    assert.equal(f.listeners.size, 0);
    f.rpc.release();
  });

for (const failure of ['rpc', 'storage', 'stale', 'old-runtime'] as const) test(`deferred policy ${failure} failure preserves ACK and only quarantines the current storage owner`, async () => {
  const f = await fixture();
  const operation = await f.deferredPolicyFailure(failure);
  try {
    await operation.prepare();
    await operation.authorize(operation.getSnapshot().revision);
    assert.equal(operation.getSnapshot().phase, 'complete');
    assert.equal(operation.getSnapshot().transactionHash, '0x' + 'aa'.repeat(32));
    assert.equal(operation.getSnapshot().metadataRefresh, 'failed');
    assert.equal(f.snapshot().phase, failure === 'storage' ? 'locked' : 'ready');
    assert.equal(f.locks(), failure === 'storage' ? 1 : 0);
  } finally { operation.dispose(); }
});

test('native SLH factory rejects an async management owner before opening its private facade', async () => {
  const f = await fixture();
  await assert.rejects(f.controllers.openSlhDsaManagement(new AbortController().signal, async () => undefined, privateAuthentication.createNativePrivateAuthenticationScope()), /guard must be synchronous/);
  assert.equal(f.slhCounts.opened, 0); assert.equal(f.slhCounts.installed, 0);
});

test('native SLH factory rejects an async installation view before private installation', async () => {
  const f = await fixture(), signal = new AbortController().signal;
  const manager = await f.controllers.openSlhDsaManagement(signal, () => undefined, privateAuthentication.createNativePrivateAuthenticationScope());
  assert.equal(f.slhCounts.opened, 1);
  await assert.rejects(manager.openInstall('exact-public-key', signal, async () => undefined), /guard must be synchronous/);
  assert.equal(f.slhCounts.installed, 0);
  assert.equal(await manager.openInstall('exact-public-key', signal, () => undefined), f.slhOperation);
  assert.equal(f.slhCounts.installed, 1);
});


test('native smart factory binds prompt ownership without recursing through the view guard', async () => {
  const f = await fixture();
  const scope = privateAuthentication.createNativePrivateAuthenticationScope();
  let interrupted = false;
  const guard = () => { if (interrupted) assert(scope.isAuthenticating()); };
  await f.controllers.openSlhDsaManagement(new AbortController().signal, guard, scope);
  const binding = f.authentication(); assert(binding);
  await privateAuthentication.withNativePrivateAuthentication(binding, new AbortController().signal, () => undefined, async () => {
    f.prompt(true); interrupted = true;
    try { guard(); assert(scope.isAuthenticating()); }
    finally { interrupted = false; f.prompt(false); }
  });
  assert.equal(scope.isAuthenticating(), false);
});

test('native smart factory prompt ownership cannot survive an account revision change', async () => {
  const f = await fixture();
  const scope = privateAuthentication.createNativePrivateAuthenticationScope();
  await f.controllers.openSlhDsaManagement(new AbortController().signal, () => undefined, scope);
  const binding = f.authentication(); assert(binding);
  await assert.rejects(privateAuthentication.withNativePrivateAuthentication(binding, new AbortController().signal, () => undefined, async () => {
    f.prompt(true); f.change('account');
    assert.equal(scope.isAuthenticating(), false);
  }), /CANCELLED/);
  f.prompt(false); scope.retire();
});
