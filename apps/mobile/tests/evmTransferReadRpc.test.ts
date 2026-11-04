import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction } from 'ethers/transaction';
import { Interface } from 'ethers/abi';
import bytecode from './evm-oracle-bytecode.json' with { type: 'json' };
import { getEvmTransferProfile } from '../src/custody/evmTransferProfiles.ts';
import { Wallet } from 'ethers/wallet';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { EvmNetworkId } from '../src/custody/networkContext.ts';
import { unsignedTransferBytes } from '../src/custody/evmFeeContracts.ts';
import type { EvmUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';
const from = Wallet.fromPhrase('test test test test test test test test test test test junk').address;
const to = '0x1111111111111111111111111111111111111111';
const hash = '0x' + '1'.repeat(64), blockHash = '0x' + '2'.repeat(64);
const transaction = (id: EvmNetworkId = 'ethereum'): EvmUnsignedTransfer => ({ type: 2, from, to, chainId: getNativeNetwork(id).chainId, nonce: '0', value: '100', gasLimit: '21000', data: '0x', maxFeePerGas: '10', maxPriorityFeePerGas: '2' });
const request = { hash, from, to, nonce: '0' };
const signal = () => new AbortController().signal;
const oracleAbi = new Interface(['function version() view returns (string)', 'function isFjord() view returns (bool)',
  'function isIsthmus() view returns (bool)', 'function isJovian() view returns (bool)',
  'function getL1FeeUpperBound(uint256) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)', 'function getL1Fee(bytes) view returns (uint256)']);
type Call = { method: string; params: unknown[]; signal: AbortSignal };
function fixture(id: EvmNetworkId = 'ethereum', override?: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const rpc = new EvmTransferReadRpc(id, { monotonicMilliseconds: () => 1000, fetch: async (url, init) => {
    assert.equal(url, getNativeNetwork(id).rpcUrl);
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const body = JSON.parse(String(init.body));
    const call = { ...body, signal: init.signal } as Call;
    calls.push(call);
    // This fixture would accept broadcasts; no quote/receipt path may invoke one
    // or pass any parseable signed envelope inside its nested request payload.
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(inspect);
      else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
      else if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) {
        let tx: Transaction | undefined;
        try { tx = Transaction.from(value); } catch { /* Other hex fields are not transactions. */ }
        assert.equal(tx?.isSigned() ?? false, false);
        let call;
        try { call = oracleAbi.parseTransaction({ data: value }); } catch { /* Not oracle calldata. */ }
        if (call) inspect(Array.from(call.args));
      }
    };
    inspect(body.params);
    assert.notEqual(call.method, 'eth_sendRawTransaction');
    let result = override ? await override(call) : undefined;
    if (result === undefined) {
      if (call.method === 'eth_chainId') result = '0x' + BigInt(getNativeNetwork(id).chainId).toString(16);
      else if (call.method === 'eth_getBlockByNumber') result = { number: call.params[0] === 'latest' ? '0x64' : call.params[0] === 'finalized' ? '0x60' : call.params[0], hash: blockHash, baseFeePerGas: '0x4' };
      else if (call.method === 'eth_estimateGas') result = '0x5208';
      else if (call.method === 'eth_getTransactionCount') result = '0x1';
      else if (call.method === 'eth_getCode') result = call.params[0] === getEvmTransferProfile(id).oracle?.address ? bytecode.proxy : bytecode[id as 'base' | 'rollux'];
      else if (call.method === 'eth_getStorageAt') result = '0x' + '0'.repeat(24) + getEvmTransferProfile(id).oracle!.implementation.slice(2);
      else if (call.method === 'eth_call') {
        const data = (call.params[0] as { data: string }).data;
        const parsed = oracleAbi.parseTransaction({ data })!;
        result = oracleAbi.encodeFunctionResult(parsed.name, [parsed.name === 'version' ? getEvmTransferProfile(id).oracle!.version :
          parsed.name.startsWith('is') ? true : parsed.name === 'getOperatorFee' ? 25n : 75n]);
      }
      else if (call.method === 'eth_getTransactionReceipt') result = { transactionHash: hash, from, to, status: '0x1', blockNumber: '0x50', blockHash };
      else throw Error('Unexpected read method');
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  } });
  return { rpc, calls };
}

test('execution-only and inclusive-gas profiles quote exact unsigned envelopes without double counting', async () => {
  for (const id of ['ethereum', 'syscoin-nevm', 'syscoin-nevm-testnet', 'arbitrum'] as const) {
    const f = fixture(id);
    const quote = await f.rpc.quoteFees(transaction(id), signal(), () => undefined);
    assert.equal(quote.envelopeFeeCapUnits, '210000');
    assert.equal(quote.estimatedFeeUnits, '126000');
    assert.equal(quote.fundingEstimateUnits, '210100');
    assert.deepEqual(quote.extras, []);
    assert.equal(quote.maximumTotalUnits, '210100');
    assert.equal(f.calls.filter((call) => call.method === 'eth_estimateGas').length, id === 'arbitrum' ? 1 : 0);
  }
});

test('zkSYS uses its fixed inclusive-gas profile and estimates the exact unsigned fee fields', async () => {
  const f = fixture('zksys-testnet');
  const quote = await f.rpc.quoteFees(transaction('zksys-testnet'), signal(), () => undefined);
  assert.equal(quote.profileId, 'zkos-inclusive-finalized-executed-v1');
  assert.deepEqual(quote.extras, []);
  assert.deepEqual(f.calls.find(c => c.method === 'eth_estimateGas')?.params, [{
    from, to, data: '0x', value: '0x64', maxFeePerGas: '0xa', maxPriorityFeePerGas: '0x2',
    type: '0x2', chainId: '0xdee1', nonce: '0x0',
  }, '0x64']);
});

test('input snapshot survives mutation during quote and A-B-A guard cancellation rejects stale results', async () => {
  const input = { ...transaction() };
  const f = fixture('ethereum', (call) => { if (call.method === 'eth_chainId') input.value = '999'; });
  assert.equal((await f.rpc.quoteFees(input, signal(), () => undefined)).fundingEstimateUnits, '210100');
  let revision = 0;
  const captured = revision;
  const changed = fixture('ethereum', (call) => { if (call.method === 'eth_getBlockByNumber') revision += 2; });
  await assert.rejects(changed.rpc.quoteFees(transaction(), signal(), () => { if (revision !== captured) throw Error('A-B-A'); }), { code: 'CANCELLED' });
  const asyncGuard = fixture();
  await assert.rejects(asyncGuard.rpc.quoteFees(transaction(), signal(), (async () => undefined) as () => void), { code: 'CANCELLED' });
  assert.equal(asyncGuard.calls.length, 0);
});

test('wrong chain, changed block, invalid gas and underpriced envelope reject', async () => {
  for (const [id, override, code] of [
    ['ethereum', (call: Call) => call.method === 'eth_chainId' ? '0x2' : undefined, 'PROFILE_CHANGED'],
    ['ethereum', (call: Call) => call.method === 'eth_getBlockByNumber' && call.params[0] === '0x64' ? { number: '0x64', hash, baseFeePerGas: '0x4' } : undefined, 'PROFILE_CHANGED'],
    ['ethereum', (call: Call) => call.method === 'eth_getBlockByNumber' ? { number: '0x64', hash, baseFeePerGas: '0xb' } : undefined, 'REVIEW_REQUIRED'],
    ['arbitrum', (call: Call) => call.method === 'eth_estimateGas' ? '0x5209' : undefined, 'REVIEW_REQUIRED'],
  ] as const) {
    const f = fixture(id, override);
    await assert.rejects(f.rpc.quoteFees(transaction(id), signal(), () => undefined), { code });
  }
});

test('canonical finalized Ethereum inclusion is separate from NEVM depth observation and unqualified rollup settlement', async () => {
  for (const id of ['ethereum', 'syscoin-nevm', 'arbitrum', 'base', 'rollux'] as const) {
    const result = await fixture(id).rpc.receipt(request, signal(), () => undefined);
    assert.equal(result?.status, 'included');
    assert.equal(result?.settlement.terminalEligible, id === 'ethereum');
    assert.equal(result?.settlement.kind, id === 'ethereum' ? 'ethereum-finalized' : id === 'syscoin-nevm' ? 'nevm-depth-observation' : 'unqualified');
  }
});

test('a consumed nonce cannot make an orphan receipt terminal or confirm a missing transaction', async () => {
  const orphan = fixture('ethereum', (call) => call.method === 'eth_getBlockByNumber' && call.params[0] === '0x50' ? { number: '0x50', hash } : undefined);
  await assert.rejects(orphan.rpc.receipt(request, signal(), () => undefined), { code: 'PROFILE_CHANGED' });
  const absent = fixture('ethereum', (call) => call.method === 'eth_getTransactionReceipt' ? null : undefined);
  const result = await absent.rpc.receipt(request, signal(), () => undefined);
  assert.equal(result?.status, 'nonce-consumed');
  assert.equal(result?.settlement.terminalEligible, true);
  const future = fixture('ethereum', (call) => call.method === 'eth_getBlockByNumber' && call.params[0] === 'finalized' ? { number: '0x40', hash: blockHash } : undefined);
  assert.equal((await future.rpc.receipt(request, signal(), () => undefined))?.settlement.terminalEligible, false);
});

test('same hash receipt replacement, changed final block and stale guard fail closed', async () => {
  let reads = 0;
  const changed = fixture('ethereum', (call) => call.method === 'eth_getTransactionReceipt' && ++reads > 1 ? { transactionHash: hash, from, to, status: '0x0', blockNumber: '0x50', blockHash } : undefined);
  await assert.rejects(changed.rpc.receipt(request, signal(), () => undefined), { code: 'PROFILE_CHANGED' });
  const final = fixture('ethereum', (call) => call.method === 'eth_getBlockByNumber' && call.params[0] === '0x60' ? { number: '0x60', hash } : undefined);
  await assert.rejects(final.rpc.receipt(request, signal(), () => undefined), { code: 'PROFILE_CHANGED' });
});

test('block responses have a separate bounded budget while ordinary responses remain capped', async () => {
  const wide = fixture('ethereum', (call) => call.method === 'eth_getBlockByNumber' ? { number: call.params[0] === 'latest' ? '0x64' : call.params[0], hash: blockHash, baseFeePerGas: '0x4', transactions: Array(400).fill(hash) } : undefined);
  assert.equal((await wide.rpc.quoteFees(transaction(), signal(), () => undefined)).maximumTotalUnits, '210100');
  const huge = fixture('ethereum', (call) => call.method === 'eth_getBlockByNumber' ? { number: '0x64', hash, baseFeePerGas: '0x4', padding: 'a'.repeat(512 * 1024) } : undefined);
  await assert.rejects(huge.rpc.quoteFees(transaction(), signal(), () => undefined), { code: 'UNAVAILABLE' });
  const ordinary = fixture('ethereum', (call) => call.method === 'eth_chainId' ? '0x' + '1'.repeat(17000) : undefined);
  await assert.rejects(ordinary.rpc.quoteFees(transaction(), signal(), () => undefined), { code: 'UNAVAILABLE' });
});

for (const id of ['base', 'rollux'] as const) {
  test(`${id} exact source-pinned oracle receives only unsigned bytes or size`, async () => {
    const f = fixture(id);
    const tx = transaction(id);
    const quote = await f.rpc.quoteFees(tx, signal(), () => undefined);
    assert.equal(quote.maximumTotalUnits, null);
    assert.equal(quote.fundingEstimateUnits, id === 'base' ? '210200' : '210175');
    assert.equal(quote.extras.length, id === 'base' ? 2 : 1);
    const oracleCalls = f.calls.filter((call) => call.method === 'eth_call').map((call) => oracleAbi.parseTransaction({ data: (call.params[0] as { data: string }).data })!);
    assert(oracleCalls.every((call) => !['getL1FeeUpperBound', 'getOperatorFee'].includes(call.name) || id === 'base'));
    assert(f.calls.filter((call) => ['eth_call', 'eth_getCode', 'eth_getStorageAt'].includes(call.method)).every((call) => call.params.at(-1) === '0x64'));
    if (id === 'rollux') {
      const raw = oracleCalls.find((call) => call.name === 'getL1Fee')!.args[0];
      assert.equal(Transaction.from(raw).isSigned(), false);
      assert.equal(Transaction.from(raw).chainId, 570n);
    } else {
      const unsignedBytes = (unsignedTransferBytes(tx).length - 2) / 2;
      assert.equal(oracleCalls.find((call) => call.name === 'getL1FeeUpperBound')!.args[0], BigInt(unsignedBytes));
      assert.equal(oracleCalls.find((call) => call.name === 'getOperatorFee')!.args[0], 21000n);
      assert.equal(oracleCalls.some((call) => call.name === 'getL1Fee'), false);
    }
  });

  test(`${id} rejects proxy, implementation, slot, version, and method drift without fallback`, async () => {
    const mutations: ((call: Call) => unknown)[] = [
      (call) => call.method === 'eth_getCode' ? '0x00' : undefined,
      (call) => call.method === 'eth_getStorageAt' ? '0x' + '0'.repeat(64) : undefined,
      (call) => call.method === 'eth_call' && oracleAbi.parseTransaction({ data: (call.params[0] as { data: string }).data })!.name === 'version' ? oracleAbi.encodeFunctionResult('version', ['1.999.0']) : undefined,
      (call) => { if (call.method === 'eth_call') throw Error('Method unavailable'); },
    ];
    for (const mutate of mutations) {
      const f = fixture(id, mutate);
      await assert.rejects(f.rpc.quoteFees(transaction(id), signal(), () => undefined));
      assert.equal(f.calls.filter((call) => call.method === 'eth_getBlockByNumber' && call.params[0] === 'latest').length, 1);
    }
  });
}

test('Base accepts successful zero estimates but rejects false upgrade flags and malformed ABI', async () => {
  const zero = fixture('base', (call) => {
    if (call.method !== 'eth_call') return;
    const parsed = oracleAbi.parseTransaction({ data: (call.params[0] as { data: string }).data })!;
    if (parsed.name.startsWith('get')) return oracleAbi.encodeFunctionResult(parsed.name, [0n]);
  });
  const quote = await zero.rpc.quoteFees(transaction('base'), signal(), () => undefined);
  assert.equal(quote.maximumTotalUnits, null);
  assert.equal(quote.fundingEstimateUnits, '210100');
  for (const flag of ['isFjord', 'isIsthmus', 'isJovian']) {
    const f = fixture('base', (call) => call.method === 'eth_call' && oracleAbi.parseTransaction({ data: (call.params[0] as { data: string }).data })!.name === flag ? oracleAbi.encodeFunctionResult(flag, [false]) : undefined);
    await assert.rejects(f.rpc.quoteFees(transaction('base'), signal(), () => undefined), { code: 'PROFILE_CHANGED' });
  }
  const malformed = fixture('base', (call) => call.method === 'eth_call' ? '0x01' : undefined);
  await assert.rejects(malformed.rpc.quoteFees(transaction('base'), signal(), () => undefined), { code: 'INVALID_RESPONSE' });
});

test('oracle quote revocation stops before later fee calls and aborted input sends nothing', async () => {
  let revision = 0;
  const f = fixture('base', (call) => {
    if (call.method === 'eth_call' && oracleAbi.parseTransaction({ data: (call.params[0] as { data: string }).data })!.name === 'getL1FeeUpperBound') revision += 2;
  });
  await assert.rejects(f.rpc.quoteFees(transaction('base'), signal(), () => { if (revision !== 0) throw Error('A-B-A'); }), { code: 'CANCELLED' });
  assert.equal(f.calls.filter((call) => call.method === 'eth_call').some((call) => oracleAbi.parseTransaction({ data: (call.params[0] as { data: string }).data })!.name === 'getOperatorFee'), false);
  const aborted = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(aborted.rpc.quoteFees(transaction(), controller.signal, () => undefined), { code: 'CANCELLED' });
  assert.equal(aborted.calls.length, 0);
});

test('RPC error envelopes and code-size overflow never become zero fees', async () => {
  const rpc = new EvmTransferReadRpc('base', { fetch: async (_url, init) => {
    const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'method unavailable' } }));
  } });
  await assert.rejects(rpc.quoteFees(transaction('base'), signal(), () => undefined), { code: 'INVALID_RESPONSE' });
  const tooLarge = fixture('base', (call) => call.method === 'eth_getCode' ? '0x' + '00'.repeat(17000) : undefined);
  await assert.rejects(tooLarge.rpc.quoteFees(transaction('base'), signal(), () => undefined), { code: 'UNAVAILABLE' });
});
