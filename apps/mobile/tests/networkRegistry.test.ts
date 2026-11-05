import test from 'node:test';
import assert from 'node:assert/strict';
import { EVM_NETWORK_DEFINITIONS, createExtensionEvmNetworks } from '../../../source/shared/evmNetworks.ts';
import { NATIVE_NETWORKS, nativeSigningEnabled } from '../src/custody/networkContext.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { RPC_ENDPOINTS, createBalanceReader } from '../src/platformRpc.ts';

test('extension defaults and all seven mobile read identities share one pure registry', () => {
  const extension = createExtensionEvmNetworks();
  assert.deepEqual(NATIVE_NETWORKS.map((network) => Number(network.chainId)).sort((a, b) => a - b), [1, 57, 570, 5700, 8453, 42161, 57057]);
  for (const definition of EVM_NETWORK_DEFINITIONS) {
    const native = NATIVE_NETWORKS.find((network) => network.id === definition.id)!;
    const publicNetwork = NETWORKS.find((network) => network.id === definition.id)!;
    assert.equal(extension[Number(native.chainId)]!.url, native.rpcUrl);
    assert.equal(RPC_ENDPOINTS[native.id], native.rpcUrl);
    assert.equal(publicNetwork.chainId, Number(native.chainId));
    assert.equal(publicNetwork.canWatch, true);
    assert.equal(native.slip44, 60);
    assert.equal(native.symbol, definition.network.currency.toUpperCase());
    assert.match(native.registrationHash, /^0x[0-9a-f]{64}$/);
    if (definition.testnet) assert.match(publicNetwork.name, /testnet/i);
    assert.equal(nativeSigningEnabled(native.id), true);
  }
  assert.equal(new Set(NATIVE_NETWORKS.map((network) => network.registrationHash)).size, 7);
});


test('all registered read paths verify the selected chain before disclosing an account address', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  for (const network of NATIVE_NETWORKS) {
    const calls: { url: string; method: string; params: string[] }[] = [];
    const reader = createBalanceReader({ fetch: async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, method: body.method, params: body.params });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id,
        result: body.method === 'eth_chainId' ? '0x' + Number(network.chainId).toString(16) : '0x2a' }),
      { headers: { 'content-type': 'application/json' } });
    } });
    assert.deepEqual(await reader.readBalance(network.id, address, new AbortController().signal), { chainId: Number(network.chainId), units: '42' });
    assert.deepEqual(calls, [
      { url: network.rpcUrl, method: 'eth_chainId', params: [] },
      { url: network.rpcUrl, method: 'eth_getBalance', params: [address, 'latest'] },
    ]);
    let leaked = false;
    const wrong = createBalanceReader({ fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body)); leaked ||= body.params.includes(address);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x0' }), { headers: { 'content-type': 'application/json' } });
    } });
    await assert.rejects(wrong.readBalance(network.id, address, new AbortController().signal), /different network/);
    assert.equal(leaked, false);
  }
});
