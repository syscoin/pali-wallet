import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CustodyOperationError } from '../src/custody/authority.ts';
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
  const runtime = { catalogue: { getSnapshot: () => catalogue } };
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
      return catalogue;
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
  const dependencies: Record<string, unknown> = {
    './security': security,
    './deviceUnlockCredential.native': {
      createNativeDeviceUnlockCapability: () => ({
        credentials: {},
        prompt: { cancel() {} },
      }),
    },
    './walletConnectRuntime': {
      prepareWalletConnectRuntime() {
        assert.fail('unexpected WalletConnect');
      },
    },
    '../connections/controller.ts': { NativeConnectionsController: Passive },
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
    rpc,
    read,
    listeners,
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
