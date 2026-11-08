import { emptyNoncePlanner } from './noncePlannerFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { snapshotUnsignedTransfer, type EvmUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';
import { createNativeNetwork, getNativeNetwork, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';

const from = '0x2222222222222222222222222222222222222222';
const to = '0x1111111111111111111111111111111111111111';
const cap = 16777216n;
const custom = createNativeNetwork({ id: 'custom-gas-test', name: 'Gas test', kind: 'evm',
  chainId: '454545', slip44: 60, rpcUrl: 'https://gas-test.example', symbol: 'TEST', decimals: 18, testnet: true });
const customEthereum = createNativeNetwork({ ...custom, id: 'custom-ethereum-gas', chainId: '1' });
const input = { from, to, value: '1', data: '0x' };
const envelope = (network: NativeNetworkRegistration, gas: bigint): EvmUnsignedTransfer => ({
  ...input, chainId: network.chainId, gasLimit: gas.toString(), nonce: '0', type: 2, accessList: [], maxFeePerGas: '3', maxPriorityFeePerGas: '1',
});
function fixture(network: NativeNetworkRegistration, estimate: bigint, blockGas = 30000000n) {
  const calls: string[] = [];
  const rpc = new EvmTransferReadRpc(network, { fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body));
    calls.push(request.method);
    const results: Record<string, unknown> = {
      eth_chainId: `0x${BigInt(network.chainId).toString(16)}`,
      eth_getBlockByNumber: { number: '0x1', hash: `0x${'a'.repeat(64)}`, baseFeePerGas: '0x1', gasLimit: `0x${blockGas.toString(16)}` },
      eth_getTransactionCount: '0x0', eth_getBalance: `0x${(10n ** 30n).toString(16)}`,
      eth_gasPrice: '0x2', eth_maxPriorityFeePerGas: '0x1', eth_estimateGas: `0x${estimate.toString(16)}`,
    };
    assert(Object.hasOwn(results, request.method), `unexpected RPC ${request.method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] }),
      { headers: { 'content-type': 'application/json' } });
  } });
  return { rpc, calls };
}
const signal = () => new AbortController().signal;
const current = () => undefined;

for (const network of [getNativeNetwork('ethereum'), customEthereum]) {
  test(`${network.id} rejects the 14M estimate whose padding exceeds the protocol ceiling`, async () => {
    const f = fixture(network, 14000000n);
    await assert.rejects(f.rpc.prepare(input, signal(), current, undefined, undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
    assert(!f.calls.includes('eth_sendRawTransaction'));
    assert.equal((await fixture(network, 13981014n).rpc.prepare(input, signal(), current, undefined, undefined, emptyNoncePlanner)).transaction.gasLimit, cap.toString());
  });
  test(`${network.id} rejects an over-cap approved envelope before requesting a fee quote`, async () => {
    assert.throws(() => snapshotUnsignedTransfer(envelope(network, cap + 1n), network), { code: 'INVALID_INPUT' });
    const f = fixture(network, 21000n);
    await assert.rejects(async () => f.rpc.quoteFees(envelope(network, cap + 1n), signal(), current), { code: 'INVALID_INPUT' });
    assert.deepEqual(f.calls, []);
  });
}

test('an unrelated EVM chain keeps its own block bound instead of inheriting the Ethereum ceiling', async () => {
  assert.equal((await fixture(custom, 14000000n).rpc.prepare(input, signal(), current, undefined, undefined, emptyNoncePlanner)).transaction.gasLimit, '16800000');
  assert.equal(snapshotUnsignedTransfer(envelope(custom, cap + 1n), custom).gasLimit, (cap + 1n).toString());
  await assert.rejects(fixture(custom, 14000000n, 16000000n).rpc.prepare(input, signal(), current, undefined, undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
});

for (const method of ['prepare', 'quoteFees'] as const) test(`${method} rechecks the approved envelope against a lower current block limit`, async () => {
  const network = getNativeNetwork('ethereum'), f = fixture(network, 21000n, 10000000n);
  const approved = envelope(network, 13000000n);
  await assert.rejects(method === 'prepare' ? f.rpc.prepare(input, signal(), current, approved, undefined, emptyNoncePlanner)
    : f.rpc.quoteFees(approved, signal(), current), { code: 'REVIEW_REQUIRED' });
});

for (const type of [0, 2] as const) test(`type ${type} raw broadcasting validates the shared cap without lowering existing native bounds`, async () => {
  const wallet = Wallet.fromPhrase('test test test test test test test test test test test junk');
  for (const [network, gasLimit, accepted] of [
    [getNativeNetwork('ethereum'), cap + 1n, false],
    [getNativeNetwork('ethereum'), cap, true],
    [custom, cap + 1n, true],
    [custom, 1n, false],
    [custom, BigInt(Number.MAX_SAFE_INTEGER) + 1n, false],
  ] as const) {
    const raw = await wallet.signTransaction({ type, to, nonce: 0, chainId: BigInt(network.chainId), value: 1n, gasLimit,
      ...(type === 0 ? { gasPrice: 2n } : { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }) });
    const hash = keccak256(raw), methods: string[] = [];
    const rpc = new NativeTransferRpc({ networkId: network.id, registration: network, fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body)); methods.push(request.method);
      assert(['eth_chainId', 'eth_getTransactionCount', 'eth_sendRawTransaction'].includes(request.method));
      if (request.method === 'eth_getTransactionCount')
        assert.deepEqual(request.params, [wallet.address, 'pending']);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'eth_chainId' ? `0x${BigInt(network.chainId).toString(16)}` : request.method === 'eth_getTransactionCount' ? '0x0' : hash }),
      { headers: { 'content-type': 'application/json' } });
    } });
    if (accepted) {
      assert.equal(await rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => undefined,  mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }), hash);
      assert.deepEqual(methods, ['eth_sendRawTransaction']);
    } else {
      await assert.rejects(rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => undefined,  mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }), { code: 'INVALID_RESPONSE' });
      assert.deepEqual(methods, []);
    }
  }
});
