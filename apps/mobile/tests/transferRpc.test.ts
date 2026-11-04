import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
const sender = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const recipient = '0x1111111111111111111111111111111111111111';
const signal = () => new AbortController().signal;
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { method: string; params: unknown[]; init: RequestInit }[] = [];
  const values: Record<string, unknown> = {
    eth_chainId: '0x1',
    eth_getBlockByNumber: (body: { params: string[] }) => ({ number: body.params[0] === 'finalized' ? '0x20' : body.params[0], hash: '0x' + '2'.repeat(64) }),
    eth_getTransactionCount: '0x0',
    eth_getBalance: '0x10000000000000000',
    eth_feeHistory: { oldestBlock: '0x1', baseFeePerGas: ['0x64', '0x6e'] },
    eth_maxPriorityFeePerGas: '0x2',
    eth_estimateGas: '0x5208',
    ...overrides,
  };
  const rpc = new NativeTransferRpc({
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ ...body, init });
      const raw = values[body.method];
      const result = typeof raw === 'function' ? await raw(body, init) : raw;
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  return { rpc, calls };
}
test('prepares an exact integer EIP1559 quote without broadcasting', async () => {
  const f = fixture();
  const quote = await f.rpc.prepare(sender.address, recipient, '123', signal());
  assert.equal(quote.transaction.maxFeePerGas, '222');
  assert.equal(quote.transaction.gasLimit, '21000');
  assert.equal(quote.maximumFeeUnits, '4662000');
  assert.equal(quote.totalUnits, '4662123');
  assert(Object.isFrozen(quote));
  assert(Object.isFrozen(quote.transaction));
  assert.equal(f.calls[0]?.method, 'eth_chainId');
  assert.equal(f.calls.at(-1)?.method, 'eth_chainId');
  assert(!f.calls.some((c) => c.method === 'eth_sendRawTransaction'));
  assert(
    f.calls.every(
      (c) => c.init.credentials === 'omit' && c.init.redirect === 'error'
    )
  );
});
test('does not disclose any address if the endpoint chain is wrong', async () => {
  const f = fixture({ eth_chainId: '0x2' });
  await assert.rejects(f.rpc.prepare(sender.address, recipient, '1', signal()));
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ['eth_chainId']
  );
});
test('rejects changed chain after fee lookup', async () => {
  let count = 0;
  const f = fixture({ eth_chainId: () => (++count === 1 ? '0x1' : '0x2') });
  await assert.rejects(f.rpc.prepare(sender.address, recipient, '1', signal()));
});
test('keeps maximum costs within balance and rejects unsafe quotes', async () => {
  for (const override of [
    { eth_getBalance: '0x1' },
    { eth_estimateGas: '0x1' },
    { eth_estimateGas: '0xffffffffffff' },
    { eth_getTransactionCount: '0x20000000000000' },
    { eth_feeHistory: { oldestBlock: '0x1', baseFeePerGas: ['0x1'] } },
  ]) {
    await assert.rejects(
      fixture(override).rpc.prepare(sender.address, recipient, '1', signal())
    );
  }
});
test('adds exact bounded gas headroom for a complex native transfer', async () => {
  const f = fixture({ eth_estimateGas: '0x7530' });
  assert.equal(
    (await f.rpc.prepare(sender.address, recipient, '1', signal())).transaction
      .gasLimit,
    '36000'
  );
});
test('new Ethereum quotes reject estimates or padded limits above the EIP-7825 transaction cap', async () => {
  for (const estimate of ['0x1000001', '0xe00000']) {
    await assert.rejects(fixture({ eth_estimateGas: estimate }).rpc.prepare(sender.address, recipient, '1', signal()), { code: 'INVALID_RESPONSE' });
  }
  const below = fixture({ eth_estimateGas: '0xd55555' });
  assert.equal((await below.rpc.prepare(sender.address, recipient, '1', signal())).transaction.gasLimit, '16777216');
});
test('aborts unresolved sibling requests when one quote component fails', async () => {
  let observed: AbortSignal | undefined;
  const f = fixture({
    eth_estimateGas: () => {
      throw Error('Unavailable');
    },
    eth_getBalance: (_body: unknown, init: RequestInit) => {
      observed = init.signal as AbortSignal;
      return new Promise(() => undefined);
    },
  });
  await assert.rejects(f.rpc.prepare(sender.address, recipient, '1', signal()));
  assert.equal(observed?.aborted, true);
});
test('a cancelled request never reaches the network', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.rpc.prepare(sender.address, recipient, '1', controller.signal),
    { code: 'CANCELLED' }
  );
  assert.equal(f.calls.length, 0);
});
test('rejects mismatched JSON-RPC id and oversized responses', async () => {
  for (const text of [
    JSON.stringify({ jsonrpc: '2.0', id: 100, result: '0x1' }),
    'x'.repeat(17000),
  ]) {
    const rpc = new NativeTransferRpc({
      fetch: async () => new Response(text),
    });
    await assert.rejects(rpc.prepare(sender.address, recipient, '1', signal()));
  }
});
test('broadcasts only exact verified bytes once and retains an unknown result on lost acknowledgement', async () => {
  const raw = await sender.signTransaction({
    type: 2,
    chainId: 1,
    nonce: 0,
    to: recipient,
    value: 1,
    gasLimit: 21000,
    maxFeePerGas: 2,
    maxPriorityFeePerGas: 1,
  });
  const hash = keccak256(raw);
  const f = fixture({ eth_sendRawTransaction: hash });
  assert.equal(await f.rpc.broadcast(raw, hash, signal()), hash);
  assert.deepEqual(
    f.calls.find((c) => c.method === 'eth_sendRawTransaction')?.params,
    [raw]
  );
  const lost = fixture({
    eth_sendRawTransaction: () => {
      throw Error('Response lost');
    },
  });
  await assert.rejects(lost.rpc.broadcast(raw, hash, signal()));
  assert.equal(
    lost.calls.filter((c) => c.method === 'eth_sendRawTransaction').length,
    1
  );
  const invalid = fixture();
  await assert.rejects(
    invalid.rpc.broadcast(raw, '0x' + '0'.repeat(64), signal())
  );
  assert.equal(invalid.calls.length, 0);
});
test('receipt inclusion remains unresolved until the account nonce is finalized', async () => {
  const hash = '0x' + '1'.repeat(64);
  const receipt = {
    transactionHash: hash,
    from: sender.address,
    to: recipient,
    status: '0x1',
    blockNumber: '0xa',
    blockHash: '0x' + '2'.repeat(64),
  };
  const expected = { hash, from: sender.address, to: recipient, nonce: '0' };
  const f = fixture({ eth_getTransactionReceipt: receipt });
  assert.equal((await f.rpc.receipt(expected, signal()))?.finalized, false);
  const finalized = fixture({
    eth_getTransactionReceipt: receipt,
    eth_getTransactionCount: '0x1',
  });
  assert.equal(
    (await finalized.rpc.receipt(expected, signal()))?.finalized,
    true
  );
  assert.equal(
    finalized.calls.filter((c) => c.method === 'eth_getTransactionReceipt')
      .length,
    2
  );
});
test('refuses a receipt for another transaction or a changed canonical block', async () => {
  const hash = '0x' + '1'.repeat(64);
  const expected = { hash, from: sender.address, to: recipient, nonce: '0' };
  await assert.rejects(
    fixture({
      eth_getTransactionReceipt: { transactionHash: '0x' + '2'.repeat(64) },
    }).rpc.receipt(expected, signal())
  );
  let count = 0;
  const f = fixture({
    eth_getTransactionCount: '0x1',
    eth_getTransactionReceipt: () => ({
      transactionHash: hash,
      from: sender.address,
      to: recipient,
      status: '0x1',
      blockNumber: '0xa',
      blockHash: '0x' + (++count === 1 ? '2' : '3').repeat(64),
    }),
  });
  await assert.rejects(f.rpc.receipt(expected, signal()));
});

test('reports only nonce consumption when a different finalized transaction may have used it', async () => {
  const hash = '0x' + '1'.repeat(64);
  const f = fixture({
    eth_getTransactionReceipt: null,
    eth_getTransactionCount: '0x2',
  });
  assert.deepEqual(
    await f.rpc.receipt(
      { hash, from: sender.address, to: recipient, nonce: '1' },
      signal()
    ),
    { status: 'nonce-consumed', finalized: true }
  );
});

test('receipt canonicality and finalized height both gate terminal eligibility', async () => {
  const hash = '0x' + '1'.repeat(64);
  const receipt = { transactionHash: hash, from: sender.address, to: recipient, status: '0x1', blockNumber: '0xa', blockHash: '0x' + '2'.repeat(64) };
  const expected = { hash, from: sender.address, to: recipient, nonce: '0' };
  const orphan = fixture({ eth_getTransactionReceipt: receipt, eth_getTransactionCount: '0x1',
    eth_getBlockByNumber: (body: { params: string[] }) => ({ number: body.params[0] === 'finalized' ? '0x20' : body.params[0], hash: '0x' + '3'.repeat(64) }) });
  await assert.rejects(orphan.rpc.receipt(expected, signal()), { code: 'INVALID_RESPONSE' });
  const beforeFinal = fixture({ eth_getTransactionReceipt: receipt, eth_getTransactionCount: '0x1',
    eth_getBlockByNumber: (body: { params: string[] }) => ({ number: body.params[0] === 'finalized' ? '0x9' : body.params[0], hash: '0x' + '2'.repeat(64) }) });
  assert.equal((await beforeFinal.rpc.receipt(expected, signal()))?.finalized, false);
});

test('receipt error mapping distinguishes caller cancellation, deadline and malformed responses', async () => {
  const expected = { hash: '0x' + '1'.repeat(64), from: sender.address, to: recipient, nonce: '0' };
  const timed = new NativeTransferRpc({ timeoutMs: 5, fetch: async () => new Promise(() => undefined) });
  await assert.rejects(timed.receipt(expected, signal()), { code: 'UNAVAILABLE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(timed.receipt(expected, controller.signal), { code: 'CANCELLED' });
  const malformed = fixture({ eth_getTransactionReceipt: { transactionHash: '0x00' } });
  await assert.rejects(malformed.rpc.receipt(expected, signal()), { code: 'INVALID_RESPONSE' });
  const unavailable = fixture({ eth_getTransactionReceipt: () => { throw Error('Endpoint unavailable'); } });
  await assert.rejects(unavailable.rpc.receipt(expected, signal()), { code: 'UNAVAILABLE' });
});
