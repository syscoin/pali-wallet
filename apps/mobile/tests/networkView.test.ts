import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeNetworkView } from '../src/custody/networkView.ts';
import { UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { NATIVE_NETWORKS } from '../src/custody/networkContext.ts';
import type { NativeWalletCatalogueSnapshot } from '../src/custody/walletCatalogue.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';

const address = '0x52908400098527886E0F7030069857D2E4169EE7';
function fixture() {
  let state: CustodySnapshot = { phase: 'ready', revision: 12, presence: 'existing', backup: 'confirmed', account: { network: 'ethereum', address }, error: null };
  let catalogue: NativeWalletCatalogueSnapshot | null = Object.freeze<NativeWalletCatalogueSnapshot>({ revision: 3, accounts: [], networks: NATIVE_NETWORKS, active: { accountId: 'hd:60:0', networkId: 'ethereum' } });
  const listeners = new Set<(value: CustodySnapshot) => void>();
  const requests: unknown[][] = [];
  let cancels = 0;
  const authority = {
    getSnapshot: () => state,
    getCatalogue: () => catalogue,
    subscribe(listener: (value: CustodySnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async selectNetwork(...args: [string, number, number]) { requests.push(args); },
    cancelAccountOperation() { cancels++; },
  };
  const view = createNativeNetworkView(authority);
  return { view, requests, listeners, cancels: () => cancels,
    set(next: CustodySnapshot, nextCatalogue: NativeWalletCatalogueSnapshot | null) {
      state = next; catalogue = nextCatalogue;
      for (const listener of listeners) listener(state);
    } };
}

test('network projection is stable, frozen, public-only and projects all saved EVM capabilities', () => {
  const f = fixture(); const first = f.view.getSnapshot()!;
  assert.equal(f.view.getSnapshot(), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.networks), true);
  assert.equal(first.selectedId, 'ethereum');
  assert.equal(first.revision, 3);
  assert.equal(first.networks.length, NATIVE_NETWORKS.length + UTXO_NETWORKS.length);
  assert.deepEqual(first.networks.filter(network => network.canSign).map(network => network.id), NATIVE_NETWORKS.map((network) => network.id));
  assert.deepEqual(first.networks.filter((network) => !network.canSign).map((network) => network.id), UTXO_NETWORKS.map((network) => network.id));
  for (const network of first.networks) {
    assert.equal(Object.isFrozen(network), true);
    assert.deepEqual(Object.keys(network).sort(), network.canSign
      ? ['canSign', 'id', 'name', 'registration', 'symbol', 'testnet']
      : ['canSign', 'id', 'name', 'symbol', 'testnet']);
  }
  assert.equal(f.requests.length, 0);
});

test('network selection forwards both captured revisions and teardown removes observation', async () => {
  const f = fixture(); let updates = 0;
  const stop = f.view.subscribe(() => updates++);
  await f.view.select('base', f.view.getContextRevision(), f.view.getSnapshot()!.revision);
  assert.deepEqual(f.requests, [['base', 12, 3]]);
  f.set({ phase: 'locked', revision: 13, presence: 'existing', backup: 'confirmed', account: null, error: null }, null);
  assert.equal(updates, 1);
  assert.equal(f.view.getSnapshot(), null);
  f.view.cancel(); assert.equal(f.cancels(), 1);
  stop(); assert.equal(f.listeners.size, 0);
});

test('network verification and persistence share one detached registration snapshot', async () => {
  const { createNativeNetwork } = await import('../src/custody/networkContext.ts');
  const original = createNativeNetwork({ id: 'custom:4444', name: 'Custom', kind: 'evm', chainId: '4444', slip44: 60, rpcUrl: 'https://first.example', symbol: 'T', decimals: 18, testnet: true });
  const mutable = { ...original };
  let finish!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const state: CustodySnapshot = { phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { network: 'ethereum', address }, error: null };
  const catalogue = { revision: 1, accounts: [], networks: NATIVE_NETWORKS, active: { accountId: 'hd:60:0', networkId: 'ethereum' } };
  const saved: unknown[] = [];
  const view = createNativeNetworkView({ getSnapshot: () => state, getCatalogue: () => catalogue, subscribe: () => () => undefined,
    selectNetwork: async () => undefined, cancelAccountOperation: () => undefined,
    manageNetwork: async (request) => { saved.push(request); } }, { fetch: async (url, init) => {
      assert.equal(url, original.rpcUrl); const request = JSON.parse(String(init.body)); started(); await held;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0x115c' }), { headers: { 'content-type': 'application/json' } });
    } });
  const pending = view.save!(mutable, 1, 1); await entered;
  Object.assign(mutable, createNativeNetwork({ ...original, chainId: '5555', rpcUrl: 'https://second.example' }));
  finish(); await pending;
  assert.deepEqual(saved, [{ kind: 'save-network', registration: original }]);
});

test('long padded network text reaches the verified endpoint unchanged and stale or wrong-chain replies never save', async () => {
  const { createNativeNetwork } = await import('../src/custody/networkContext.ts');
  const registration = createNativeNetwork({ id: 'custom:31337', name: `  ${'network '.repeat(12)}  `,
    symbol: ` ${'x'.repeat(32)} `, kind: 'evm', chainId: '31337', rpcUrl: 'https://rpc.example/long', slip44: 60, decimals: 18, testnet: true });
  for (const mode of ['healthy', 'wrong-chain', 'stale-context', 'stale-catalogue'] as const) {
    let revision = 1, catalogueRevision = 1;
    const saved: unknown[] = [], urls: string[] = [];
    const view = createNativeNetworkView({
      getSnapshot: () => ({ phase: 'ready', revision, presence: 'existing', backup: 'confirmed', account: { network: 'ethereum', address }, error: null }),
      getCatalogue: () => ({ revision: catalogueRevision, accounts: [], networks: NATIVE_NETWORKS, active: { accountId: 'hd:60:0', networkId: 'ethereum' } }),
      subscribe: () => () => undefined, selectNetwork: async () => undefined, cancelAccountOperation: () => undefined,
      manageNetwork: async (request) => { saved.push(request); },
    }, { fetch: async (url, init) => {
      urls.push(url); const request = JSON.parse(String(init.body));
      assert.equal(request.method, 'eth_chainId');
      if (mode === 'stale-context') revision++;
      if (mode === 'stale-catalogue') catalogueRevision++;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: mode === 'wrong-chain' ? '0x1' : '0x7a69' }), { headers: { 'content-type': 'application/json' } });
    } });
    if (mode === 'healthy') {
      await view.save!(registration, 1, 1);
      assert.deepEqual(saved, [{ kind: 'save-network', registration }]);
    } else {
      await assert.rejects(view.save!(registration, 1, 1));
      assert.deepEqual(saved, []);
    }
    assert.deepEqual(urls, [registration.rpcUrl]);
  }
});

test('catalogue is lazy and verified Save rejects unexpected endpoints before reservation', async () => {
  const { createNativeNetwork } = await import('../src/custody/networkContext.ts');
  const { EVM_CHAIN_CATALOGUE_URL } = await import('../../../source/shared/chainCatalogueData.ts');
  const registration = createNativeNetwork({ id: 'custom:31337', name: 'Example', symbol: 'EX', kind: 'evm',
    chainId: '31337', slip44: 60, rpcUrl: 'https://rpc.example', decimals: 18, testnet: true });
  const requests: string[] = [], saved: unknown[] = [];
  let finalUrl = 'https://rpc.example/';
  let redirected = false;
  const view = createNativeNetworkView({
    getSnapshot: () => ({ phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { network: 'ethereum', address }, error: null }),
    getCatalogue: () => ({ revision: 1, accounts: [], networks: NATIVE_NETWORKS, active: { accountId: 'hd:60:0', networkId: 'ethereum' } }),
    subscribe: () => () => undefined, selectNetwork: async () => undefined, cancelAccountOperation: () => undefined,
    manageNetwork: async (request) => { saved.push(request); },
  }, { fetch: async (url, init) => {
    requests.push(url);
    assert.equal(init.redirect, 'error');
    if (url === EVM_CHAIN_CATALOGUE_URL) {
      assert.equal(init.body, undefined);
      return Response.json([{ chainId: 31337, name: 'Example',
        nativeCurrency: { symbol: 'EX', decimals: 18 }, rpc: [{ url: registration.rpcUrl }] }]);
    }
    const request = JSON.parse(String(init.body));
    assert.equal(request.method, 'eth_chainId');
    assert.deepEqual(request.params, []);
    return Object.defineProperties(Response.json({ jsonrpc: '2.0', id: request.id, result: '0x7a69' }), {
      url: { value: finalUrl }, redirected: { value: redirected },
    });
  } });
  assert.deepEqual(requests, []);
  const chains = await view.loadCatalogue!();
  assert.equal(chains[0]!.chainId, 31337);
  assert.equal(await view.loadCatalogue!(), chains);
  assert.deepEqual(requests, [EVM_CHAIN_CATALOGUE_URL]);
  assert.deepEqual(saved, []);

  for (const unexpected of ['https://wrong.example/', 'https://rpc.example/changed']) {
    finalUrl = unexpected;
    await assert.rejects(view.save!(registration, 1, 1), { code: 'PROFILE_CHANGED' });
  }
  finalUrl = 'https://rpc.example/';
  redirected = true;
  await assert.rejects(view.save!(registration, 1, 1), { code: 'PROFILE_CHANGED' });
  assert.deepEqual(saved, []);
  redirected = false;
  await view.save!(registration, 1, 1);
  assert.deepEqual(saved, [{ kind: 'save-network', registration }]);
  assert.deepEqual(requests, [EVM_CHAIN_CATALOGUE_URL, ...Array(4).fill(registration.rpcUrl)]);
});
