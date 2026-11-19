import { emptyNoncePlanner } from './noncePlannerFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import { NativeTransferRpc, captureNativeOwnedDappAdmission } from '../src/custody/transferRpc.ts';
import { snapshotPreparedEvmTransaction, serializePreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { assertEvmCancellationNonceReady } from '../../../source/shared/evmCancellationPayer.ts';
const sender = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const recipient = '0x1111111111111111111111111111111111111111';
const signal = () => new AbortController().signal;
function fixture(overrides: Record<string, unknown> = {}, scalarOnly = false) {
  const calls: { method: string; params: unknown[]; init: RequestInit }[] = [];
  const values: Record<string, unknown> = {
    eth_chainId: '0x1',
    eth_getBlockByNumber: (body: { params: string[] }) => ({ number: body.params[0] === 'latest' ? '0x20' : body.params[0], hash: '0x' + '2'.repeat(64), baseFeePerGas: '0x64', gasLimit: '0x1c9c380' }),
    eth_gasPrice: '0x65',
    eth_getTransactionCount: '0x0',
    eth_getBalance: '0x10000000000000000',
    eth_feeHistory: { oldestBlock: '0x1', baseFeePerGas: ['0x64', '0x6e'] },
    eth_maxPriorityFeePerGas: '0x2',
    eth_estimateGas: '0x5208',
    ...overrides,
  };
  const rpc = new NativeTransferRpc({ networkId: 'ethereum',
    fetch: async function fetchFixture(_url, init): Promise<Response> {
      const request = JSON.parse(String(init.body));
      if (Array.isArray(request) && scalarOnly)
        return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests not supported' } });
      if (Array.isArray(request)) return Response.json(await Promise.all(request.map(async row => (await fetchFixture(_url, { ...init, body: JSON.stringify(row) })).json())));
      const body = JSON.parse(String(init.body));
      calls.push({ ...body, init });
      const raw = values[body.method];
      const result = typeof raw === 'function' ? await raw(body, init) : raw;
      if (result instanceof Response) return result;
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  return { rpc, calls };
}

test('owned dapp admission delegates identity to its exact one-use host preflight', async () => {
  const transaction = snapshotPreparedEvmTransaction({ from: sender.address, to: recipient,
    chainId: '1', nonce: '0', data: '0x', value: '1', gasLimit: '21000', type: 0, gasPrice: '101' });
  const raw = await sender.signTransaction(Transaction.from(serializePreparedEvmTransaction(transaction)));
  const hash = keccak256(raw), f = fixture({ eth_sendRawTransaction: hash });
  let finalChecks = 0;
  const admit = async (send: () => Promise<string>, preflight?: () => Promise<void>) => {
    await preflight?.();
    finalChecks++;
    return send();
  };
  const token = captureNativeOwnedDappAdmission(f.rpc, admit, hash);
  await assert.rejects(f.rpc.broadcastDapp(raw, hash, transaction, signal(), admit, () => undefined, () => undefined, {}), { code: 'REVIEW_REQUIRED' });
  assert.equal(f.calls.length, 0);
  assert.equal(await f.rpc.broadcastDapp(raw, hash, transaction, signal(), admit, () => undefined, () => undefined, token), hash);
  assert.equal(finalChecks, 1);
  assert.deepEqual(f.calls.map(call => call.method), ['eth_sendRawTransaction']);
  await assert.rejects(f.rpc.broadcastDapp(raw, hash, transaction, signal(), admit, () => undefined, () => undefined, token), { code: 'REVIEW_REQUIRED' });
  assert.equal(f.calls.length, 1);
  const defaultRpc = fixture({ eth_sendRawTransaction: hash });
  assert.equal(await defaultRpc.rpc.broadcastDapp(raw, hash, transaction, signal(), admit, () => undefined, () => undefined), hash);
  assert.deepEqual(defaultRpc.calls.map(call => call.method), ['eth_chainId', 'eth_sendRawTransaction']);
});

test('owned dapp identity cannot authorize a different sender and still respects final refusal', async () => {
  const transaction = snapshotPreparedEvmTransaction({ from: sender.address, to: recipient,
    chainId: '1', nonce: '0', data: '0x', value: '1', gasLimit: '21000', type: 0, gasPrice: '101' });
  const raw = await sender.signTransaction(Transaction.from(serializePreparedEvmTransaction(transaction)));
  const hash = keccak256(raw), f = fixture({ eth_sendRawTransaction: hash });
  const admit = async (_send: () => Promise<string>, preflight?: () => Promise<void>) => { await preflight?.(); throw new Error('late wrong chain'); };
  const other = fixture();
  const foreign = captureNativeOwnedDappAdmission(other.rpc, admit, hash);
  await assert.rejects(f.rpc.broadcastDapp(raw, hash, transaction, signal(), admit, () => undefined, () => undefined, foreign), { code: 'REVIEW_REQUIRED' });
  const token = captureNativeOwnedDappAdmission(f.rpc, admit, hash);
  await assert.rejects(f.rpc.broadcastDapp(raw, hash, transaction, signal(), admit, () => undefined, () => undefined, token), /late wrong chain/);
  assert.equal(f.calls.length, 0);
});
test('new cancellation preserves a saved legacy nonce and rejects unsupported original types before RPC', async () => {
  const legacy = await sender.signTransaction({
    type: 0, chainId: 1, nonce: 1, to: recipient, value: 1,
    gasLimit: 21000, gasPrice: 150,
  });
  const hash = keccak256(legacy);
  const f = fixture({
    eth_getTransactionByHash: { hash, from: sender.address, to: recipient, value: '0x1', nonce: '0x1',
      blockHash: null, blockNumber: null, transactionIndex: null },
    eth_getTransactionReceipt: null,
    eth_getTransactionCount: ({ params }: { params: string[] }) => {
      assert.equal(params[1], 'latest');
      return '0x1';
    },
    eth_getCode: '0x',
  });
  const rates = { type: 0 as const, gasPrice: 150n };
  const quote = await f.rpc.prepareCancellation(hash, legacy, sender.address, signal(), () => undefined, rates);
  assert.equal(quote.transaction.type, 0);
  assert.equal(quote.transaction.nonce, '1');
  assert.equal(quote.maximumFeeUnits, '7560000');
  assert(!f.calls.some(({ method }) => method === 'eth_estimateGas' || method === 'eth_sendRawTransaction'));

  const unsupported = await sender.signTransaction({
    type: 1, chainId: 1, nonce: 1, to: recipient, value: 1,
    gasLimit: 21000, gasPrice: 150,
  });
  f.calls.length = 0;
  await assert.rejects(f.rpc.prepareCancellation(keccak256(unsupported), unsupported, sender.address, signal(), () => undefined, rates), { code: 'REVIEW_REQUIRED' });
  assert.equal(f.calls.length, 0);
});
test('saved cancellation cannot POST after its queued admission loses receipt, nonce or code authority', async () => {
  const raw = await sender.signTransaction({
    type: 0, chainId: 1, nonce: 1, to: recipient, value: 1,
    gasLimit: 21000, gasPrice: 150,
  });
  const hash = keccak256(raw);
  let nonce = '0x1', code = '0x', chain = '0x1';
  let receipt: object | null = null;
  const f = fixture({
    eth_chainId: () => chain,
    eth_getTransactionCount: () => nonce,
    eth_getCode: () => code,
    eth_getTransactionReceipt: ({ params }: { params: string[] }) => {
      assert.deepEqual(params, [hash]);
      return receipt;
    },
  });
  const quote = await f.rpc.prepareSavedCancellation(hash, raw, sender.address, signal(), () => undefined,
    { type: 0, gasPrice: 150n });
  const transaction = quote.transaction;
  assert.equal(transaction.type, 0);
  const cancel = await sender.signTransaction({
    type: 0, chainId: 1, nonce: 1, to: sender.address, value: 0,
    gasLimit: BigInt(transaction.gasLimit), gasPrice: BigInt(transaction.gasPrice),
  });
  const dispatch = (skipPreflight = false) => f.rpc.broadcast(cancel, keccak256(cancel), signal(), {
    mode: 'cancel-saved', original: quote.original,
    async admit(send, preflight) {
      if (!skipPreflight) {
        assert.ok(preflight);
        await preflight();
      }
      return send();
    },
  });
  await assert.rejects(dispatch(true), { code: 'REVIEW_REQUIRED' });
  nonce = '0x0';
  await assert.rejects(dispatch(), { code: 'CANCELLATION_QUEUED' });
  nonce = '0x2';
  await assert.rejects(dispatch(), { code: 'REVIEW_REQUIRED' });
  nonce = '0x1';
  code = '0x6000';
  await assert.rejects(dispatch(), { code: 'REVIEW_REQUIRED' });
  code = '0x';
  chain = '0x2';
  await assert.rejects(dispatch(), { code: 'REVIEW_REQUIRED' });
  chain = '0x1';
  receipt = { transactionHash: hash, from: sender.address, to: recipient, status: '0x1',
    blockNumber: '0x20', blockHash: '0x' + '2'.repeat(64) };
  await assert.rejects(dispatch(), { code: 'REVIEW_REQUIRED' });
  assert(!f.calls.some(({ method }) => method === 'eth_sendRawTransaction'));
});
test('cancellation nonce reason distinguishes only a validated lower count', () => {
  assert.doesNotThrow(() => assertEvmCancellationNonceReady(1, '0x1'));
  assert.throws(() => assertEvmCancellationNonceReady(1, '0x0'), { code: 'EVM_CANCELLATION_NONCE', reason: 'queued' });
  for (const value of ['0x2', '0x01', '0x', '1', '0x' + '1'.repeat(65)])
    assert.throws(() => assertEvmCancellationNonceReady(1, value), { code: 'EVM_CANCELLATION_NONCE', reason: 'unavailable' });
  assert.throws(() => assertEvmCancellationNonceReady(-1, '0x0'), { code: 'EVM_CANCELLATION_NONCE', reason: 'unavailable' });
  assert.throws(() => assertEvmCancellationNonceReady((1n << 256n).toString(), '0x0'), { code: 'EVM_CANCELLATION_NONCE', reason: 'unavailable' });
});

test('cancellation classifies only a validated lower latest nonce as queued', async () => {
  const raw = await sender.signTransaction({ type: 0, chainId: 1, nonce: 1, to: recipient, value: 1,
    gasLimit: 21000, gasPrice: 150 });
  const hash = keccak256(raw);
  const pending = { hash, from: sender.address, to: recipient, value: '0x1', nonce: '0x1',
    blockHash: null, blockNumber: null, transactionIndex: null };
  for (const [latest, expected] of [['0x0', 'CANCELLATION_QUEUED'], ['0x2', 'REVIEW_REQUIRED'], ['0x01', 'REVIEW_REQUIRED']] as const) {
    const f = fixture({ eth_getTransactionByHash: pending, eth_getTransactionReceipt: null,
      eth_getTransactionCount: latest, eth_getCode: '0x' });
    await assert.rejects(f.rpc.prepareCancellation(hash, raw, sender.address, signal(), () => undefined,
      { type: 0, gasPrice: 150n }), { code: expected });
    assert(!f.calls.some(({ method }) => method === 'eth_sendRawTransaction'));
  }
});

test('prepares an exact integer EIP1559 quote without broadcasting', async () => {
  const f = fixture();
  const quote = await f.rpc.prepare(sender.address, recipient, '123', signal(), undefined, emptyNoncePlanner);
  assert.equal(quote.transaction.type, 2);
  if (quote.transaction.type !== 2) throw new Error('Expected dynamic-fee fixture');
  assert.equal(quote.transaction.maxFeePerGas, '252');
  assert.equal(quote.transaction.gasLimit, '25200');
  assert.equal(quote.maximumFeeUnits, '6350400');
  assert.equal(quote.totalUnits, '6350523');
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
  await assert.rejects(f.rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner));
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ['eth_chainId']
  );
});
test('rejects changed chain after fee lookup', async () => {
  let count = 0;
  const f = fixture({ eth_chainId: () => (++count === 1 ? '0x1' : '0x2') });
  await assert.rejects(f.rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner));
});
test('keeps maximum costs within balance and rejects unsafe quotes', async () => {
  for (const override of [
    { eth_getBalance: '0x1' },
    { eth_estimateGas: '0x1' },
    { eth_estimateGas: '0xffffffffffff' },
    { eth_getTransactionCount: '0x20000000000000' },
    { eth_gasPrice: null },
  ]) {
    await assert.rejects(
      fixture(override).rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner)
    );
  }
});
test('adds exact bounded gas headroom for a complex native transfer', async () => {
  const f = fixture({ eth_estimateGas: '0x7530' });
  assert.equal(
    (await f.rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner)).transaction
      .gasLimit,
    '36000'
  );
});
test('quotes reject estimates or padded limits above the selected block gas limit', async () => {
  const block = (body: {params:string[]}) => ({number:body.params[0]==='latest'?'0x20':body.params[0],hash:'0x'+'2'.repeat(64),baseFeePerGas:'0x64',gasLimit:'0xf4240'});
  for (const estimate of ['0xf4241', '0xdbba0']) {
    await assert.rejects(fixture({ eth_getBlockByNumber:block, eth_estimateGas: estimate }).rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
  }
  const below = fixture({ eth_getBlockByNumber:block, eth_estimateGas: '0xc3500' });
  assert.equal((await below.rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner)).transaction.gasLimit, '960000');
});
test('aborts unresolved sibling requests when one quote component fails', async () => {
  let observed: AbortSignal | undefined;
  const f = fixture({
    eth_gasPrice: () => {
      throw Error('Unavailable');
    },
    eth_getBalance: (_body: unknown, init: RequestInit) => {
      observed = init.signal as AbortSignal;
      return new Promise(() => undefined);
    },
  }, true);
  await assert.rejects(f.rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner));
  assert.equal(observed?.aborted, true);
});
test('a cancelled request never reaches the network', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.rpc.prepare(sender.address, recipient, '1', controller.signal, undefined, emptyNoncePlanner),
    { code: 'CANCELLED' }
  );
  assert.equal(f.calls.length, 0);
});
test('rejects mismatched JSON-RPC id and oversized responses', async () => {
  for (const text of [
    JSON.stringify({ jsonrpc: '2.0', id: 100, result: '0x1' }),
    'x'.repeat(17000),
  ]) {
    const rpc = new NativeTransferRpc({ networkId: 'ethereum',
      fetch: async () => new Response(text),
    });
    await assert.rejects(rpc.prepare(sender.address, recipient, '1', signal(), undefined, emptyNoncePlanner));
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
  assert.equal(await f.rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => undefined,  mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }), hash);
  assert.deepEqual(
    f.calls.find((c) => c.method === 'eth_sendRawTransaction')?.params,
    [raw]
  );
  const lost = fixture({
    eth_sendRawTransaction: () => {
      throw Error('Response lost');
    },
  });
  await assert.rejects(lost.rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => undefined,  mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }));
  assert.equal(
    lost.calls.filter((c) => c.method === 'eth_sendRawTransaction').length,
    1
  );
  const wrongEndpoint = fixture({
    eth_sendRawTransaction: ({ id }: { id: number }) => {
      const response = Response.json({ jsonrpc: '2.0', id, result: hash });
      Object.defineProperty(response, 'url', { value: 'https://different-rpc.invalid/' });
      return response;
    },
  });
  await assert.rejects(wrongEndpoint.rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => undefined,
    mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); },
  }), { code: 'INVALID_RESPONSE' });
  assert.equal(wrongEndpoint.calls.filter((c) => c.method === 'eth_sendRawTransaction').length, 1);
  const invalid = fixture();
  await assert.rejects(
    invalid.rpc.broadcast(raw, '0x' + '0'.repeat(64), signal(), { assertDispatchAdmission: () => undefined,  mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } })
  );
  assert.equal(invalid.calls.length, 0);
});

test('requires broadcast admission after preflight and never posts if admission refuses', async () => {
  const raw = await sender.signTransaction({
    type: 2, chainId: 1, nonce: 0, to: recipient, value: 1,
    gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1,
  });
  const hash = keccak256(raw);
  const f = fixture({ eth_sendRawTransaction: hash });
  await assert.rejects(
    f.rpc.broadcast(raw, hash, signal(), undefined as never),
    { code: 'REVIEW_REQUIRED' }
  );
  assert.equal(f.calls.length, 0);
  let methodsAtAdmission: string[] | undefined;
  await assert.rejects(
    f.rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => undefined,
      mode: 'new-send',
      admit: async (_send, preflight) => {
        await preflight?.();
        methodsAtAdmission = f.calls.map((call) => call.method);
        throw new Error('late review');
      },
    }),
    /late review/
  );
  assert.deepEqual(methodsAtAdmission, []);
  assert.deepEqual(f.calls.map((call) => call.method), []);
  const revoked = {
    mode: 'new-send' as const,
    assertDispatchAdmission: () => undefined,
    admit: async (_send: () => Promise<string>, preflight?: () => Promise<void>) => { await preflight?.(); throw new Error('review revoked'); },
  };
  const pending = f.rpc.broadcast(raw, hash, signal(), revoked);
  Object.assign(revoked, { mode: 'unsupported' });
  await assert.rejects(pending);
  assert.deepEqual(f.calls, []);
});

test('an endpoint chain change during the wire pending-nonce read prevents a new POST', async () => {
  const raw = await sender.signTransaction({
    type: 2, chainId: 1, nonce: 0, to: recipient, value: 1,
    gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1,
  });
  const hash = keccak256(raw);
  const tx = Transaction.from(raw);
  const envelope = { type: 2 as const, accessList: [], from: tx.from!, to: tx.to!, chainId: '1', nonce: '0', value: '1', data: '0x', gasLimit: '21000', maxFeePerGas: '2', maxPriorityFeePerGas: '1' };
  let verified = false;
  const nonceEntered = Promise.withResolvers<void>();
  const nonceResponse = Promise.withResolvers<string>();
  let chain = '0x1';
  const f = fixture({
    eth_getTransactionCount: ({ params }: { params: string[] }) => {
      if (params[1] !== 'pending') return '0x0';
      nonceEntered.resolve();
      return nonceResponse.promise;
    },
    eth_chainId: () => chain,
    eth_sendRawTransaction: hash,
  });
  const pending = f.rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => { assert.equal(verified, true); },
    mode: 'new-send',
    async admit(send, preflight) {
      await f.rpc.verifyForDispatch(envelope, signal(), () => undefined, emptyNoncePlanner);
      verified = true;
      await preflight!();
      return send();
    },
  });
  const rejected = assert.rejects(pending, { code: 'REVIEW_REQUIRED' });
  await nonceEntered.promise;
  chain = '0x2';
  nonceResponse.resolve('0x0');
  await rejected;
  assert.equal(f.calls.some(call => call.method === 'eth_sendRawTransaction'), false);

  const mismatched = fixture({ eth_chainId: '0x2' });
  await assert.rejects(mismatched.rpc.broadcast(raw, hash, signal(), { assertDispatchAdmission: () => { assert.equal(verified, true); },
    mode: 'new-send',
    async admit(send, preflight) {
      await mismatched.rpc.verifyForDispatch(envelope, signal(), () => undefined, emptyNoncePlanner);
      await preflight!();
      return send();
    },
  }), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(mismatched.calls.map(({ method }) => method), ['eth_chainId']);
});

test('first canonical receipt confirms immediately without nonce or finality gates', async () => {
  const hash = '0x' + '1'.repeat(64);
  const receipt = { transactionHash: hash, from: sender.address, to: recipient,
    status: '0x1', blockNumber: '0xa', blockHash: '0x' + '2'.repeat(64) };
  const f = fixture({ eth_getTransactionReceipt: receipt });
  assert.deepEqual(await f.rpc.receipt({hash,from:sender.address,to:recipient,nonce:'0'}, signal()),
    {status:'confirmed', blockHash:receipt.blockHash,blockNumber:'10'});
  assert.equal(f.calls.some(c=>c.method==='eth_getTransactionCount'),false);
  assert.equal(f.calls.some(c=>c.params.includes('finalized')||c.params.includes('safe')),false);
});
test('refuses a receipt for another transaction or a changed canonical block', async () => {
  const hash = '0x' + '1'.repeat(64);
  const expected = { hash, from: sender.address, to: recipient, nonce: '0' };
  await assert.rejects(
    fixture({
      eth_getTransactionReceipt: { transactionHash: '0x' + '2'.repeat(64) },
    }).rpc.receipt(expected, signal())
  );
  const f = fixture({
    eth_getTransactionReceipt: { transactionHash: hash, from:sender.address,to:recipient,status:'0x1',blockNumber:'0xa',blockHash:'0x'+'2'.repeat(64) },
    eth_getBlockByNumber: () => ({number:'0xa',hash:'0x'+'3'.repeat(64),gasLimit:'0x1c9c380'}),
  });
  await assert.rejects(f.rpc.receipt(expected, signal()));
});

test('reports only nonce consumption when another transaction may have used it', async () => {
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
    { status: 'nonce-consumed' }
  );
});

test('receipt reorg observations are revisable and retain canonical block checks', async () => {
  const hash='0x'+'1'.repeat(64),blockHash='0x'+'2'.repeat(64);
  const receipt={transactionHash:hash,from:sender.address,to:recipient,status:'0x1',blockNumber:'0xa',blockHash};
  const expected={hash,from:sender.address,to:recipient,nonce:'0'};
  const orphan=fixture({eth_getTransactionReceipt:receipt,eth_getBlockByNumber:()=>({number:'0xa',hash:'0x'+'3'.repeat(64),gasLimit:'0x1c9c380'})});
  await assert.rejects(orphan.rpc.receipt(expected,signal()),{code:'INVALID_RESPONSE'});
  let observed:unknown=receipt;
  const f=fixture({eth_getTransactionReceipt:()=>observed});
  assert.equal((await f.rpc.receipt(expected,signal()))?.status,'confirmed');
  observed=null;assert.equal(await f.rpc.receipt(expected,signal()),null);
  observed={...receipt,status:'0x0'};assert.equal((await f.rpc.receipt(expected,signal()))?.status,'reverted');
});

test('receipt error mapping distinguishes caller cancellation, deadline and malformed responses', async () => {
  const expected = { hash: '0x' + '1'.repeat(64), from: sender.address, to: recipient, nonce: '0' };
  const timed = new NativeTransferRpc({ networkId: 'ethereum', timeoutMs: 5, fetch: async () => new Promise(() => undefined) });
  await assert.rejects(timed.receipt(expected, signal()), { code: 'UNAVAILABLE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(timed.receipt(expected, controller.signal), { code: 'CANCELLED' });
  const malformed = fixture({ eth_getTransactionReceipt: { transactionHash: '0x00' } });
  await assert.rejects(malformed.rpc.receipt(expected, signal()), { code: 'INVALID_RESPONSE' });
  const unavailable = fixture({ eth_getTransactionReceipt: () => { throw Error('Endpoint unavailable'); } });
  await assert.rejects(unavailable.rpc.receipt(expected, signal()), { code: 'UNAVAILABLE' });
});
