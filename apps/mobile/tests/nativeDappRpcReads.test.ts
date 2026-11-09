import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeDappRpcReadHost } from '../src/custody/dappRpcReads.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { executeDappRpcRequest, normalizeDappRpcRequest } from '../../../source/shared/dappRpcReads.ts';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum.js';
import { Wallet } from 'ethers/wallet';
import { Signature } from 'ethers/crypto';
import { getBytes } from 'ethers/utils';

const registration = createNativeNetwork({ id: 'ethereum', name: 'Ethereum', kind: 'evm', chainId: '1', slip44: 60, rpcUrl: 'https://rpc.example', symbol: 'ETH', decimals: 18, testnet: false });
const json = (id: number, value: Record<string, unknown>) => new Response(JSON.stringify({ jsonrpc: '2.0', id, ...value }), { headers: { 'content-type': 'application/json' } });
const HASH = `0x${'22'.repeat(32)}`;
const NODE_PUBLIC_CASES = [
  ['eth_coinbase', [], `0x${'33'.repeat(20)}`], ['web3_sha3', ['0Xabcd'], HASH],
  ['eth_getFilterChanges', ['0x0000aBcD'], []], ['eth_getFilterLogs', ['opaque-filter-ID'], []],
  ['eth_newBlockFilter', [], 'opaque-block-filter'], ['eth_newFilter', [{ topics: [null] }], '0x0000aBcD'],
  ['eth_newPendingTransactionFilter', [true], 'opaque-pending-filter'], ['eth_uninstallFilter', ['0x0000aBcD'], false],
  ['eth_getWork', [], [HASH, HASH, HASH, '0x1']], ['eth_hashrate', [], '0x0'], ['eth_mining', [], false],
  ['eth_submitHashrate', [`0x${'00'.repeat(31)}01`, HASH], false],
  ['eth_submitWork', ['0x0000000000000001', HASH, HASH], false],
] as const;
test('public reads use the saved endpoint, verify the chain twice and carry the request guard', async () => {
  const calls: { method: string; params: unknown[] }[] = [];
  let checks = 0;
  const host = createNativeDappRpcReadHost({ verifyPersonalMessage() { throw new Error('RPC reads must not invoke recovery'); }, registration: () => registration, async fetch(url, init) {
    assert.equal(url, registration.rpcUrl); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const request = JSON.parse(init.body as string); calls.push(request);
    return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : '0x42' });
  } });
  assert.equal(await host.read(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => { checks++; }), '0x42');
  assert.deepEqual(calls.map(value => value.method), ['eth_chainId', 'eth_blockNumber', 'eth_chainId']);
  assert(checks > 5);
});
test('RPC execution errors retain the exact revert code, message and hex data', async () => {
  const host = createNativeDappRpcReadHost({ verifyPersonalMessage() { throw new Error('RPC reads must not invoke recovery'); }, registration: () => registration, async fetch(_url, init) {
    const request = JSON.parse(init.body as string);
    return json(request.id, request.method === 'eth_chainId' ? { result: '0x1' } : { error: { code: 3, message: 'execution reverted', data: '0x1234' } });
  } });
  await assert.rejects(host.read(normalizeDappRpcRequest('eth_call', [{ to: `0x${'11'.repeat(20)}` }]), new AbortController().signal, () => {}), { code: 3, message: 'execution reverted', data: '0x1234' });
});
for (const fault of ['chain', 'registration', 'redirect', 'bytes', 'guard', 'abort']) test(`public reads fail closed on ${fault}`, async () => {
  let selected = registration, valid = true;
  const controller = new AbortController();
  const host = createNativeDappRpcReadHost({ verifyPersonalMessage() { throw new Error('RPC reads must not invoke recovery'); }, registration: () => selected, async fetch(_url, init) {
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
  await assert.rejects(host.read(normalizeDappRpcRequest('eth_blockNumber', []), controller.signal, () => { if (!valid) throw new Error('STALE'); }));
});
test('a read deadline aborts a provider that never settles without extending other wallet read limits', async () => {
  const rpc = new EvmTransferReadRpc(registration, { timeoutMs: 1, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(rpc.dappRequest(normalizeDappRpcRequest('eth_blockNumber', []), new AbortController().signal, () => {}));
});

for (const [method, params, result] of [
  ['eth_getLogs', [{ address: `0x${'11'.repeat(20)}`, topics: [null, [`0x${'22'.repeat(32)}`, null]], fromBlock: 'earliest', toBlock: 'pending' }], []],
  ['eth_getProof', [`0x${'11'.repeat(20)}`, ['0XABC', '0x', `0x${'00'.repeat(32)}`], null], { storageProof: [] }],
  ['web3_clientVersion', [], 'Example/v1'], ['net_listening', [], false], ['net_peerCount', [], '0x0'],
  ...NODE_PUBLIC_CASES,
] as const) test(`${method} uses the common execution request with the existing three-call chain fence`, async () => {
  const calls: { method: string; params: unknown[] }[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Must not verify'); }, async fetch(_url, init) {
      const request = JSON.parse(init.body as string); calls.push(request);
      return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : result });
    } });
  const request = normalizeDappRpcRequest(method, params);
  assert.deepEqual(await host.read(request, new AbortController().signal, () => {}), result);
  assert.deepEqual(calls.map(value => value.method), ['eth_chainId', method, 'eth_chainId']);
  assert.deepEqual(calls[1]!.params, request.params);
});

for (const [method, params] of NODE_PUBLIC_CASES) test(`${method} preserves node errors without an implicit retry`, async () => {
  const calls: string[] = [];
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { throw Error('Must not verify'); }, async fetch(_url, init) {
      const request = JSON.parse(init.body as string); calls.push(request.method);
      return json(request.id, request.method === 'eth_chainId' ? { result: '0x1' } : { error: { code: -32601, message: 'Method unavailable on this node' } });
    } });
  await assert.rejects(host.read(normalizeDappRpcRequest(method, params), new AbortController().signal, () => {}), { code: -32601, message: 'Method unavailable on this node' });
  assert.equal(calls.filter(value => value === method).length, 1);
});
for (const [method, params, result] of NODE_PUBLIC_CASES) test(`${method} retains selected-source and cancellation fences after a node operation`, async () => {
  for (const change of ['source', 'abort'] as const) {
    let selected = registration, attempts = 0;
    const lifetime = new AbortController();
    const host = createNativeDappRpcReadHost({ registration: () => selected,
      verifyPersonalMessage() { throw Error('Must not verify'); }, async fetch(_url, init) {
        const request = JSON.parse(init.body as string);
        if (request.method !== 'eth_chainId') {
          attempts++;
          if (change === 'source') selected = { ...registration, registrationHash: `0x${'ff'.repeat(32)}` };
          else lifetime.abort();
        }
        return json(request.id, { result: request.method === 'eth_chainId' ? '0x1' : result });
      } });
    await assert.rejects(host.read(normalizeDappRpcRequest(method, params), lifetime.signal, () => {}));
    assert.equal(attempts, 1);
  }
});

test('actual published SDK recovery vectors share exact text/hex decoding and checksum without keys, devices or RPC', async () => {
  const unavailable = (): never => { throw Error('Public recovery must not access wallet/network/signing state'); };
  const sdk = new EthereumTransactions(unavailable, unavailable, unavailable, undefined, undefined, unavailable, null);
  const wallet = new Wallet(`0x${'11'.repeat(32)}`);
  let rpcCalls = 0;
  const verifyPersonalMessage = (message: string, signature: string) => sdk.verifyPersonalMessage(message, signature);
  const host = createNativeDappRpcReadHost({ registration: () => registration, verifyPersonalMessage,
    async fetch() { rpcCalls++; throw Error('Recovery must not call RPC'); } });
  for (const [message, signedMessage] of [['', ''], ['public ✓', 'public ✓'], ['0xabc', getBytes('0x0abc')]] as const) {
    const signature = await wallet.signMessage(signedMessage);
    for (const encoded of [signature, Signature.from(signature).compactSerialized, signature.slice(0, -2) + '00' + signature.slice(-2)]) {
      const request = normalizeDappRpcRequest('personal_ecRecover', [message, encoded]);
      const extensionResult = await executeDappRpcRequest(request, { assertCurrent() {}, verifyPersonalMessage,
        async request() { throw Error('Recovery must not call remote execution'); } });
      assert.equal(extensionResult, wallet.address);
      assert.equal(await host.read(request, new AbortController().signal, () => {}), extensionResult);
    }
  }
  assert.equal(rpcCalls, 0);
  await assert.rejects(host.read(normalizeDappRpcRequest('personal_ecRecover', ['public', 'invalid']), new AbortController().signal, () => {}));
});

test('local recovery retains source/abort guards and cannot leak onto the HTTP-only port', async () => {
  const lifetime = new AbortController(); let current = true;
  const host = createNativeDappRpcReadHost({ registration: () => registration,
    verifyPersonalMessage() { current = false; return `0x${'11'.repeat(20)}`; },
    async fetch() { throw Error('Must not fetch'); } });
  const request = normalizeDappRpcRequest('personal_ecRecover', ['text', 'signature']);
  await assert.rejects(host.read(request, lifetime.signal, () => { if (!current) throw Error('STALE'); }), /STALE/);
  current = true; lifetime.abort();
  await assert.rejects(host.read(request, lifetime.signal, () => {}), /CONTEXT_CHANGED/);
  await assert.rejects(new EvmTransferReadRpc(registration, { fetch: async () => { throw Error('Must not fetch'); } })
    .dappRequest(request, new AbortController().signal, () => {}), /INVALID_INPUT/);
});
