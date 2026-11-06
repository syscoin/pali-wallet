import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { EvmReplayError, type EvmReplayDispatchAdmission } from '../../../source/wallet/evmSignedReplay.ts';
const sender = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const recipient = '0x1111111111111111111111111111111111111111';
const signal = () => new AbortController().signal;
function fixture(overrides: Record<string, unknown> = {}) {
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
    { eth_gasPrice: null },
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
test('quotes reject estimates or padded limits above the selected block gas limit', async () => {
  const block = (body: {params:string[]}) => ({number:body.params[0]==='latest'?'0x20':body.params[0],hash:'0x'+'2'.repeat(64),baseFeePerGas:'0x64',gasLimit:'0xf4240'});
  for (const estimate of ['0xf4241', '0xdbba0']) {
    await assert.rejects(fixture({ eth_getBlockByNumber:block, eth_estimateGas: estimate }).rpc.prepare(sender.address, recipient, '1', signal()), { code: 'INVALID_RESPONSE' });
  }
  const below = fixture({ eth_getBlockByNumber:block, eth_estimateGas: '0xc3500' });
  assert.equal((await below.rpc.prepare(sender.address, recipient, '1', signal())).transaction.gasLimit, '960000');
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
    const rpc = new NativeTransferRpc({ networkId: 'ethereum',
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
  assert.equal(await f.rpc.broadcast(raw, hash, signal(), { mode: 'new-send', beforeBroadcast: () => undefined }), hash);
  assert.deepEqual(
    f.calls.find((c) => c.method === 'eth_sendRawTransaction')?.params,
    [raw]
  );
  const lost = fixture({
    eth_sendRawTransaction: () => {
      throw Error('Response lost');
    },
  });
  await assert.rejects(lost.rpc.broadcast(raw, hash, signal(), { mode: 'new-send', beforeBroadcast: () => undefined }));
  assert.equal(
    lost.calls.filter((c) => c.method === 'eth_sendRawTransaction').length,
    1
  );
  const invalid = fixture();
  await assert.rejects(
    invalid.rpc.broadcast(raw, '0x' + '0'.repeat(64), signal(), { mode: 'new-send', beforeBroadcast: () => undefined })
  );
  assert.equal(invalid.calls.length, 0);
});

test('requires current synchronous broadcast admission at the actual POST boundary', async () => {
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
  await assert.rejects(
    f.rpc.broadcast(raw, hash, signal(), {
      mode: 'new-send',
      beforeBroadcast: (async () => { throw new Error('late review'); }) as never,
    }),
    { code: 'REVIEW_REQUIRED' }
  );
  assert.deepEqual(f.calls.map((call) => call.method), ['eth_chainId']);
  const revoked = {
    mode: 'new-send' as const,
    beforeBroadcast: () => { throw new Error('review revoked'); },
  };
  const pending = f.rpc.broadcast(raw, hash, signal(), revoked);
  Object.assign(revoked, { mode: 'replay' });
  await assert.rejects(pending);
  assert.deepEqual(f.calls.map((call) => call.method), ['eth_chainId', 'eth_chainId']);
});

test('retained cancellation reads the latest nonce before latest and pending code inside admission', async () => {
  const raw = await sender.signTransaction({
    type: 2, chainId: 1, nonce: 1, to: sender.address, value: 0,
    gasLimit: 42000, maxFeePerGas: 2, maxPriorityFeePerGas: 1,
  });
  const hash = keccak256(raw);
  const context = { chainId: '1', from: sender.address, hash, nonce: 1, operation: 'cancel' as const };
  for (const [latestNonce, delegatedAt, ready] of [
    ['0x0', '', false], ['0x2', '', false], ['0x01', '', false],
    ['0x1', 'latest', false], ['0x1', 'pending', false], ['0x1', '', true],
  ] as const) {
    const f = fixture({
      eth_getTransactionCount: latestNonce,
      eth_getCode: ({ params }: { params: string[] }) => params[1] === delegatedAt ? `0xef0100${'33'.repeat(20)}` : '0x',
      eth_sendRawTransaction: hash,
    });
    const admit: EvmReplayDispatchAdmission = async (send, preflight) => {
      assert.equal(f.calls.length, 0);
      assert(preflight);
      await preflight();
      return send();
    };
    const result = f.rpc.broadcast(raw, hash, signal(), { mode: 'replay', admit, context });
    if (ready) assert.equal(await result, hash);
    else await assert.rejects(result, { code: 'REVIEW_REQUIRED' });
    assert.deepEqual(f.calls.map(({ method, params }) => [method, params]), [
      ['eth_chainId', []],
      ['eth_getTransactionCount', [sender.address, 'latest']],
      ...(latestNonce === '0x1' ? [
        ['eth_getCode', [sender.address, 'latest']],
        ['eth_getCode', [sender.address, 'pending']],
      ] : []),
      ...(ready ? [['eth_sendRawTransaction', [raw]]] : []),
    ]);
  }
});

test('native cancellation checks a changed chain inside the final journal admission', async () => {
  const raw = await sender.signTransaction({
    type: 2, chainId: 1, nonce: 1, to: sender.address, value: 0,
    gasLimit: 42000, maxFeePerGas: 2, maxPriorityFeePerGas: 1,
  });
  const hash = keccak256(raw), context = {
    chainId: '1', from: sender.address, hash, nonce: 1, operation: 'cancel' as const,
  };
  let chain = '0x1';
  const f = fixture({ eth_chainId: () => chain, eth_getTransactionCount: '0x1', eth_getCode: '0x', eth_sendRawTransaction: hash });
  const admit: EvmReplayDispatchAdmission = async (send, preflight) => {
    chain = '0x2';
    await preflight();
    return send();
  };
  await assert.rejects(f.rpc.broadcast(raw, hash, signal(), { mode: 'replay', admit, context }), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(f.calls.map(({ method }) => method), ['eth_chainId']);
});

test('a ready retained type-1 self fee replacement preserves its exact access list and bytes', async () => {
  const raw = await sender.signTransaction({
    type: 1, chainId: 1, nonce: 1, to: sender.address, value: 0,
    gasLimit: 42000, gasPrice: 2,
    accessList: [{ address: sender.address, storageKeys: ['0x' + '01'.repeat(32)] }],
  });
  const hash = keccak256(raw), context = {
    chainId: '1', from: sender.address, hash, nonce: 1, operation: 'speed-up' as const,
    requiresPayerCheck: true as const,
  };
  const f = fixture({ eth_getTransactionCount: '0x1', eth_getCode: '0x', eth_sendRawTransaction: hash });
  const admit: EvmReplayDispatchAdmission = async (send, preflight) => {
    assert.equal(f.calls.length, 0);
    await preflight();
    return send();
  };
  assert.equal(await f.rpc.broadcast(raw, hash, signal(), { mode: 'replay', admit, context }), hash);
  assert.deepEqual(f.calls.at(-1)?.params, [raw]);
});

test('ordinary native replay preserves shared admission failures with no cancellation reads or POST', async () => {
  const raw = await sender.signTransaction({
    type: 2, chainId: 1, nonce: 0, to: recipient, value: 1,
    gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1,
  });
  const hash = keccak256(raw), f = fixture();
  const context = { chainId: '1', from: sender.address, hash, nonce: 0, operation: 'send' as const };
  const admit: EvmReplayDispatchAdmission = async (_send, preflight) => {
    assert.equal(typeof preflight, 'function');
    throw new EvmReplayError('CONTEXT_CHANGED');
  };
  await assert.rejects(f.rpc.broadcast(raw, hash, signal(), { mode: 'replay', admit, context }), EvmReplayError);
  assert.deepEqual(f.calls, []);
  const mislabeled = fixture();
  await assert.rejects(mislabeled.rpc.broadcast(raw, hash, signal(), { mode: 'replay', admit, context: { ...context, operation: 'cancel' } }), { code: 'INVALID_RESPONSE' });
  assert.equal(mislabeled.calls.length, 0);
});

test('ordinary native replay checks the chain once inside final admission before POST', async () => {
  const raw = await sender.signTransaction({
    type: 2, chainId: 1, nonce: 0, to: recipient, value: 1,
    gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1,
  });
  const hash = keccak256(raw);
  const context = { chainId: '1', from: sender.address, hash, nonce: 0, operation: 'send' as const };
  for (const chain of ['0x1', '0x2']) {
    let current = '0x1';
    const f = fixture({ eth_chainId: () => current, eth_sendRawTransaction: hash });
    const admit: EvmReplayDispatchAdmission = async (send, preflight) => {
      assert.deepEqual(f.calls, []);
      current = chain;
      await preflight();
      return send();
    };
    const work = f.rpc.broadcast(raw, hash, signal(), { mode: 'replay', admit, context });
    if (chain === '0x1') assert.equal(await work, hash);
    else await assert.rejects(work, { code: 'INVALID_RESPONSE' });
    assert.deepEqual(f.calls.map(({ method, params }) => [method, params]), [
      ['eth_chainId', []],
      ...(chain === '0x1' ? [['eth_sendRawTransaction', [raw]]] : []),
    ]);
  }
});

test('native cancellation waits for the nonce response before sampling code', async () => {
  const raw = await sender.signTransaction({
    type: 0, chainId: 1, nonce: 1, to: sender.address, value: 0,
    gasLimit: 42000, gasPrice: 2,
  });
  const hash = keccak256(raw);
  let entered!: () => void, release!: (nonce: string) => void;
  const observed = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<string>((resolve) => { release = resolve; });
  const f = fixture({
    eth_getTransactionCount: () => { entered(); return held; },
    eth_getCode: `0xef0100${'33'.repeat(20)}`,
  });
  const context = { chainId: '1', from: sender.address, hash, nonce: 1, operation: 'cancel' as const };
  const admit: EvmReplayDispatchAdmission = async (send, preflight) => {
    assert(preflight);
    await preflight();
    return send();
  };
  const work = f.rpc.broadcast(raw, hash, signal(), { mode: 'replay', admit, context });
  const rejected = assert.rejects(work, { code: 'REVIEW_REQUIRED' });
  await observed;
  assert.deepEqual(f.calls.map((call) => call.method), ['eth_chainId', 'eth_getTransactionCount']);
  release('0x1');
  await rejected;
  assert.deepEqual(f.calls.map((call) => call.method), ['eth_chainId', 'eth_getTransactionCount', 'eth_getCode', 'eth_getCode']);
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
