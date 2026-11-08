import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';

const hash = '0x' + '1'.repeat(64);
const from = '0x2222222222222222222222222222222222222222';
const to = '0x3333333333333333333333333333333333333333';
const blockHash = '0x' + '4'.repeat(64);
const expected = { hash, from, to, nonce: '7' };
const receipt = {
  transactionHash: hash,
  from,
  to,
  status: '0x1',
  blockNumber: '0x8',
  blockHash,
};
const largeReceipt = {
  ...receipt,
  logs: [{ address: to, topics: [hash], data: '0x' + 'ab'.repeat(1024 * 1024) }],
};
const canonicalBlock = { number: '0x8', hash: blockHash, gasLimit: '0x1c9c380' };
const jsonBody = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/json' } });
type Stage = 'initial' | 'repeated';
type BodyKind = 'stream' | 'text' | 'declared';
function fixture(
  options: {
    stage?: Stage;
    kind?: BodyKind;
    consumed?: boolean;
    receiptResponse?: (id: number) => Response;
    blockResult?: (read: number) => unknown;
    chainResult?: (read: number) => string;
    onNonce?: () => void;
  } = {}
) {
  const calls: { method: string; params: unknown[] }[] = [];
  let receipts = 0,
    blocks = 0,
    chains = 0;
  const rpc = new NativeTransferRpc({ networkId: 'ethereum',
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      calls.push(request);
      let result: unknown;
      if (request.method === 'eth_chainId')
        result = options.chainResult?.(++chains) ?? '0x1';
      else if (request.method === 'eth_getTransactionReceipt') {
        receipts++;
        if (options.stage !== 'repeated' || receipts > 1) {
          if (options.receiptResponse)
            return options.receiptResponse(request.id);
          const text = JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: largeReceipt,
          });
          if (options.kind === 'text')
            return {
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              body: null,
              text: async () => text,
            } as Response;
          return new Response(text, {
            headers: {
              'content-type': 'application/json',
              ...(options.kind === 'declared'
                ? { 'content-length': String(text.length) }
                : {}),
            },
          });
        }
        result = receipt;
      } else if (request.method === 'eth_getTransactionCount') {
        options.onNonce?.();
        result = options.consumed !== false ? '0x8' : '0x7';
      } else if (request.method === 'eth_getBlockByNumber') {
        result = options.blockResult
          ? options.blockResult(++blocks)
          : canonicalBlock;
      } else throw Error('Unexpected RPC method');
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
        {
          headers: { 'content-type': 'application/json' },
        }
      );
    },
  });
  return { rpc, calls };
}

for (const stage of ['initial', 'repeated'] as const) for (const kind of ['stream', 'text', 'declared'] as const) for (const consumed of [true, false]) {
  test(`${stage} oversized ${kind} receipt is unavailable with ${consumed ? 'used' : 'unused'} nonce`, async () => {
    const f = fixture({ stage, kind, consumed });
    if (stage === 'repeated') assert.deepEqual(await f.rpc.receipt(expected, new AbortController().signal), { status: 'confirmed', blockHash, blockNumber: '8' });
    const before = f.calls.length;
    await assert.rejects(f.rpc.receipt(expected, new AbortController().signal), { code: 'UNAVAILABLE' });
    assert.deepEqual(f.calls.slice(before).map(c => c.method), ['eth_chainId', 'eth_getTransactionReceipt']);
    assert(!f.calls.some(c => c.method === 'eth_sendRawTransaction' || c.params.includes('finalized')));
  });
}

test('ordinary inclusion accepts a separately bounded canonical block above 16KiB', async () => {
  const largeBlock = { ...canonicalBlock, transactions: Array(300).fill(hash) };
  assert(JSON.stringify(largeBlock).length > 16 * 1024);
  const f = fixture({ stage: 'repeated', blockResult: () => largeBlock });
  assert.deepEqual(await f.rpc.receipt(expected, new AbortController().signal), { status: 'confirmed', blockHash, blockNumber: '8' });
  assert.deepEqual(f.calls.filter(c => c.method === 'eth_getBlockByNumber').map(c => c.params), [['0x8', false]]);
  assert(!f.calls.some(c => c.method === 'eth_getTransactionCount'));
});

test('malformed, mismatched or oversized canonical blocks cannot confirm a valid receipt', async () => {
  for (const value of [null, { ...canonicalBlock, number: '0x08' }, { ...canonicalBlock, number: '0x9' }, { ...canonicalBlock, hash: 'invalid' }, { ...canonicalBlock, hash }, { ...canonicalBlock, extra: 'x'.repeat(512 * 1024) }]) {
    const f = fixture({ stage: 'repeated', blockResult: () => value });
    await assert.rejects(f.rpc.receipt(expected, new AbortController().signal), (error: unknown) => error instanceof Error && ['INVALID_RESPONSE', 'UNAVAILABLE'].includes((error as { code?: string }).code ?? ''));
    assert(!f.calls.some(c => c.method === 'eth_getTransactionCount'));
  }
});

test('ordinary receipt observations retain chain binding and cancellation', async () => {
  const changed = fixture({ stage: 'repeated', chainResult: read => read === 1 ? '0x1' : '0x2' });
  await assert.rejects(changed.rpc.receipt(expected, new AbortController().signal), { code: 'INVALID_RESPONSE' });
  const wrong = fixture({ chainResult: () => '0x2' });
  await assert.rejects(wrong.rpc.receipt(expected, new AbortController().signal), { code: 'INVALID_RESPONSE' });
  assert.equal(wrong.calls.length, 1);
  const controller = new AbortController();
  const canceled = fixture({ stage: 'repeated', blockResult: () => { controller.abort(); return canonicalBlock; } });
  await assert.rejects(canceled.rpc.receipt(expected, controller.signal), { code: 'CANCELLED' });
  assert.equal(canceled.calls.at(-1)?.method, 'eth_getBlockByNumber');
});

test('ordinary receipt failures cannot become nonce-used evidence', async () => {
  const responses = [
    () => {
      throw Error('Network unavailable');
    },
    () =>
      new Response('{}', {
        headers: {
          'content-type': 'application/json',
          'content-length': 'invalid',
        },
      }),
    () => jsonBody('{broken JSON'),
    () => new Response('unavailable', { status: 503 }),
    () =>
      new Response('x'.repeat(17000), {
        headers: { 'content-type': 'text/html' },
      }),
    (id: number) =>
      jsonBody(JSON.stringify({ jsonrpc: '2.0', id: id + 1, result: receipt })),
    (id: number) =>
      jsonBody(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -1 } })),
    () => new Response(new Uint8Array([0xff])),
  ];
  for (const receiptResponse of responses) {
    const f = fixture({ receiptResponse });
    await assert.rejects(f.rpc.receipt(expected, new AbortController().signal));
    assert(
      !f.calls.some(
        (c) =>
          c.method === 'eth_getBlockByNumber' ||
          c.method === 'eth_getTransactionCount'
      )
    );
  }
});

test('opaque oversized bodies establish no receipt or nonce-used outcome', async () => {
  const f = fixture({ receiptResponse: () => jsonBody('x'.repeat(1024 * 1024 + 1)) });
  await assert.rejects(f.rpc.receipt(expected, new AbortController().signal), { code: 'UNAVAILABLE' });
  assert(!f.calls.some(c => c.method === 'eth_getTransactionCount'));
});
