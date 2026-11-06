import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { createNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';

const from = '0x1111111111111111111111111111111111111111';
const to = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}`;
const blockHash = `0x${'b'.repeat(64)}`;
function fixture(network: NativeNetworkRegistration, legacy = false) {
  const calls: { method: string; params: unknown[] }[] = [];
  let receipt: unknown = { transactionHash: hash, from, to, status: '0x1', blockNumber: '0x10', blockHash };
  let nonce = '0x1', gas = '0x5208', balance = '0xffffffffffffffff';
  let wrongChain = false, unsupportedTip = false;
  const fetcher = async (_url: string, init: RequestInit) => {
    assert.equal(_url, network.rpcUrl);
    const body = JSON.parse(String(init.body));
    calls.push(body);
    let result: unknown;
    switch (body.method) {
      case 'eth_chainId': result = `0x${(BigInt(network.chainId) + (wrongChain ? 1n : 0n)).toString(16)}`; break;
      case 'eth_getBlockByNumber': result = { number: '0x10', hash: blockHash, gasLimit: '0x1c9c380', ...(legacy ? {} : { baseFeePerGas: '0x64' }) }; break;
      case 'eth_gasPrice': result = '0x65'; break;
      case 'eth_maxPriorityFeePerGas':
        if (unsupportedTip) return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } }), { headers: { 'content-type': 'application/json' } });
        result = '0x0'; break;
      case 'eth_feeHistory': result = { reward: [['0x0', '0x0', '0x1'], ['0x0', '0x0', '0x1']] }; break;
      case 'eth_getTransactionCount': result = nonce; break;
      case 'eth_getBalance': result = balance; break;
      case 'eth_estimateGas': result = gas; break;
      case 'eth_getTransactionReceipt': result = receipt; break;
      case 'eth_getCode': result = '0x6000'; break;
      case 'eth_call': result = body.params[0].data === '0x313ce567' ? `0x${'6'.padStart(64, '0')}` : body.params[0].data.startsWith('0x70a08231') ? `0x${'f'.repeat(64)}` : '0x'; break;
      default: throw new Error(`Unexpected ${body.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, rpc: new NativeTransferRpc({ registration: network, fetch: fetcher }), setReceipt: (value: unknown) => { receipt = value; },
    setNonce: (value: string) => { nonce = value; }, setGas: (value: string) => { gas = value; }, setBalance: (value: string) => { balance = value; },
    wrongChain: () => { wrongChain = true; }, unsupportedTip: () => { unsupportedTip = true; } };
}
const custom = (id: string, chainId: string) => createNativeNetwork({ id, name: id, kind: 'evm', chainId, slip44: 60, rpcUrl: `https://${id}.example/rpc`, symbol: 'TEST', decimals: 18, testnet: true });
for (const network of [...NATIVE_NETWORKS, custom('custom-one', '43210'), custom('custom-two', '98765')]) {
  test(`${network.id}: one generic fee path, zero priority and first receipt confirms`, async () => {
    const f = fixture(network), signal = new AbortController().signal;
    const quote = await f.rpc.prepare(from, to, '100', signal);
    assert.equal(quote.transaction.chainId, network.chainId);
    assert.equal(quote.transaction.type, 2);
    if (quote.transaction.type !== 2) throw new Error('Expected dynamic fee');
    assert.equal(quote.transaction.maxPriorityFeePerGas, '0');
    const estimate = f.calls.find((call) => call.method === 'eth_estimateGas')!.params[0] as Record<string, unknown>;
    assert.equal(estimate.type, '0x2'); assert.equal(estimate.nonce, '0x1');
    assert.equal(estimate.maxFeePerGas, `0x${BigInt(quote.transaction.maxFeePerGas).toString(16)}`);
    const refreshed = await f.rpc.requote(quote.transaction, signal);
    assert.deepEqual(refreshed.transaction, quote.transaction);
    assert.deepEqual(await f.rpc.receipt({ hash, from, to, nonce: '1' }, signal), { status: 'confirmed', blockHash, blockNumber: '16' });
    assert.equal(f.calls.some((call) => call.params.includes('finalized') || call.params.includes('safe')), false);
    assert.equal(f.calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
  });
}
test('unlisted legacy EVM gets a type0 exact-envelope recheck', async () => {
  const f = fixture(custom('legacy-chain', '102030'), true), signal = new AbortController().signal;
  const quote = await f.rpc.prepare(from, to, '100', signal);
  assert.equal(quote.transaction.type, 0);
  assert.deepEqual((await f.rpc.requote(quote.transaction, signal)).transaction, quote.transaction);
  assert.equal(f.calls.some((call) => call.method === 'eth_maxPriorityFeePerGas'), false);
});
test('unsupported priority method uses shared SDK history fallback', async () => {
  const f = fixture(custom('history-chain', '65432')); f.unsupportedTip();
  const quote = await f.rpc.prepare(from, to, '100', new AbortController().signal);
  assert.equal(quote.transaction.type, 2);
  assert.equal(f.calls.filter((call) => call.method === 'eth_feeHistory').length, 1);
});
test('tokens bind to any selected chain instead of literal Ethereum1', async () => {
  const network = custom('token-chain', '44444'), f = fixture(network), signal = new AbortController().signal;
  const quote = await f.rpc.prepareToken(from, { kind: 'erc20-transfer', chainId: network.chainId,
    token: { contractAddress: to, name: 'Test', symbol: 'T', decimals: 6 }, recipient: from, amountUnits: '10' }, signal);
  assert.equal(quote.transaction.chainId, '44444'); assert.equal(quote.transaction.value, '0');
  await assert.rejects(f.rpc.prepareToken(from, { ...quote.intent!, chainId: '1' }, signal), { code: 'INVALID_RESPONSE' });
});
test('reorg re-reads can become missing, reverted or nonce-used without claiming another hash won', async () => {
  const f = fixture(custom('receipt-chain', '87654')), signal = new AbortController().signal;
  assert.equal((await f.rpc.receipt({ hash, from, to, nonce: '1' }, signal))?.status, 'confirmed');
  f.setReceipt(null); assert.equal(await f.rpc.receipt({ hash, from, to, nonce: '1' }, signal), null);
  f.setNonce('0x2'); assert.deepEqual(await f.rpc.receipt({ hash, from, to, nonce: '1' }, signal), { status: 'nonce-consumed' });
  f.setReceipt({ transactionHash: hash, from, to, status: '0x0', blockNumber: '0x10', blockHash });
  assert.equal((await f.rpc.receipt({ hash, from, to, nonce: '1' }, signal))?.status, 'reverted');
});
test('wrong chain is rejected before disclosing an account address', async () => {
  const f = fixture(custom('wrong-chain', '12121')); f.wrongChain();
  await assert.rejects(f.rpc.prepare(from, to, '100', new AbortController().signal), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(f.calls.map((call) => call.method), ['eth_chainId']);
});
test('gas/nonce/affordability changes invalidate exact reviewed envelope', async () => {
  const f = fixture(custom('changed-chain', '12222')), signal = new AbortController().signal;
  const quote = await f.rpc.prepare(from, to, '100', signal);
  f.setGas(`0x${(BigInt(quote.transaction.gasLimit) + 1n).toString(16)}`);
  await assert.rejects(f.rpc.requote(quote.transaction, signal), { code: 'REVIEW_REQUIRED' });
  f.setGas('0x5208'); f.setNonce('0x2'); await assert.rejects(f.rpc.requote(quote.transaction, signal), { code: 'REVIEW_REQUIRED' });
  f.setNonce('0x1'); f.setBalance('0x1'); await assert.rejects(f.rpc.requote(quote.transaction, signal), { code: 'INSUFFICIENT_BALANCE' });
});
