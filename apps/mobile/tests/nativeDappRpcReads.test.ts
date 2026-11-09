import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeDappRpcReadHost } from '../src/custody/dappRpcReads.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { normalizeDappRpcRead } from '../../../source/shared/dappRpcReads.ts';

const registration = createNativeNetwork({ id: 'ethereum', name: 'Ethereum', kind: 'evm', chainId: '1', slip44: 60, rpcUrl: 'https://rpc.example', symbol: 'ETH', decimals: 18, testnet: false });
const json = (id: number, value: Record<string, unknown>) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...value }), { headers: { 'content-type': 'application/json' } });
test('public reads use the saved endpoint, verify the chain twice and carry the request guard', async () => {
  const calls: { method: string; params: unknown[] }[] = [];
  let checks = 0;
  const host = createNativeDappRpcReadHost({ registration: () => registration, async fetch(url, init) {
    assert.equal(url, registration.rpcUrl); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const request = JSON.parse(init.body as string); calls.push(request);
    return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
  } });
  assert.equal(await host.read(normalizeDappRpcRead('eth_blockNumber', []), new AbortController().signal, () => { checks++; }), '0x42');
  assert.deepEqual(calls.map(value => value.method), ['eth_chainId', 'eth_blockNumber', 'eth_chainId']);
  assert(checks > 5);
});
test('RPC execution errors retain the exact revert code, message and hex data', async () => {
  const host = createNativeDappRpcReadHost({ registration: () => registration, async fetch(_url, init) {
    const request = JSON.parse(init.body as string);
    return json(request.id, request.method === 'eth_chainId' ? { result: '0x1' } : { error: { code: 3, message: 'execution reverted', data: '0x1234' } });
  } });
  await assert.rejects(host.read(normalizeDappRpcRead('eth_call', [{ to: `0x${'11'.repeat(20)}` }]), new AbortController().signal, () => {}), { code: 3, message: 'execution reverted', data: '0x1234' });
});
for (const fault of ['chain', 'registration', 'redirect', 'bytes', 'guard', 'abort']) test(`public reads fail closed on ${fault}`, async () => {
  let selected = registration, valid = true;
  const controller = new AbortController();
  const host = createNativeDappRpcReadHost({ registration: () => selected, async fetch(_url, init) {
    const request = JSON.parse(init.body as string);
    if (request.method !== 'eth_chainId') {
      if (fault === 'registration') selected = { ...registration, registrationHash: `0x${'22'.repeat(32)}` };
      if (fault === 'guard') valid = false;
      if (fault === 'abort') controller.abort();
    }
    const response = json(request.id, { result: request.method === 'eth_chainId' ? fault === 'chain' ? '0x2' : '0x1' : fault === 'bytes' ? 'x'.repeat(1024 * 1024 + 1) : '0x42' });
    if (fault === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    return response;
  } });
  await assert.rejects(host.read(normalizeDappRpcRead('eth_blockNumber', []), controller.signal, () => { if (!valid) throw new Error('STALE'); }));
});
test('a read deadline aborts a provider that never settles without extending other wallet read limits', async () => {
  const rpc = new EvmTransferReadRpc(registration, { timeoutMs: 1, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(rpc.dappRead(normalizeDappRpcRead('eth_blockNumber', []), new AbortController().signal, () => {}));
});
