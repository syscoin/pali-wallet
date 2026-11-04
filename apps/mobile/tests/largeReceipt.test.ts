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
  logs: [{ address: to, topics: [hash], data: '0x' + 'ab'.repeat(10_000) }],
};
const finalizedBlock = { number: '0xa', hash: blockHash };
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
  const rpc = new NativeTransferRpc({
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
        // The first complete receipt can be eligible before the repeated
        // oversized read. The subsequent fallback must query the nonce again.
        result = options.consumed !== false ||
          (options.stage === 'repeated' && receipts === 1) ? '0x8' : '0x7';
      } else if (request.method === 'eth_getBlockByNumber') {
        result = options.blockResult
          ? options.blockResult(++blocks)
          : { ...finalizedBlock, number: request.params[0] === 'finalized' ? finalizedBlock.number : request.params[0] };
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

for (const stage of ['initial', 'repeated'] as const) {
  for (const kind of ['stream', 'text', 'declared'] as const) {
    test(`${stage} oversized ${kind} receipt reports only independently finalized nonce consumption`, async () => {
      const f = fixture({ stage, kind });
      assert.deepEqual(
        await f.rpc.receipt(expected, new AbortController().signal),
        {
          status: 'nonce-consumed',
          finalized: true,
        }
      );
      const blockReads = f.calls.filter(
        (c) => c.method === 'eth_getBlockByNumber'
      );
      assert.deepEqual(
        blockReads.map((c) => c.params),
        stage === 'repeated' ? [
          ['finalized', false],
          ['0x8', false],
          ['finalized', false],
          ['0xa', false],
        ] : [
          ['finalized', false],
          ['0xa', false],
        ]
      );
      assert(
        f.calls.some(
          (c) => c.method === 'eth_getTransactionCount' && c.params[1] === '0xa'
        )
      );
      assert.equal(f.calls.at(-1)?.method, 'eth_chainId');
      assert(!f.calls.some((c) => c.method === 'eth_sendRawTransaction'));
    });
  }
  test(`${stage} oversized receipt with an unconsumed nonce is unavailable, never absent or confirmed`, async () => {
    const f = fixture({ stage, consumed: false });
    await assert.rejects(
      f.rpc.receipt(expected, new AbortController().signal),
      { code: 'UNAVAILABLE' }
    );
  });
}

test('oversized receipt fallback accepts separately bounded block responses above the ordinary 16 KiB budget', async () => {
  const block = { ...finalizedBlock, transactions: Array(300).fill(hash) };
  assert(JSON.stringify(block).length > 16 * 1024);
  const f = fixture({ blockResult: () => block });
  assert.deepEqual(
    await f.rpc.receipt(expected, new AbortController().signal),
    { status: 'nonce-consumed', finalized: true }
  );
});

test('oversized receipt fallback rejects malformed, mismatched or changed canonical anchors', async () => {
  for (const blockResult of [
    () => null,
    () => ({ ...finalizedBlock, number: '0x00a' }),
    () => ({ ...finalizedBlock, hash: 'invalid' }),
    (read: number) => ({
      ...finalizedBlock,
      number: read === 1 ? '0xa' : '0xb',
    }),
    (read: number) => ({
      ...finalizedBlock,
      hash: read === 1 ? blockHash : hash,
    }),
  ]) {
    const f = fixture({ blockResult });
    await assert.rejects(
      f.rpc.receipt(expected, new AbortController().signal),
      (error: unknown) =>
        error instanceof Error &&
        ['INVALID_RESPONSE', 'UNAVAILABLE'].includes(
          (error as { code?: string }).code ?? ''
        )
    );
  }
  const tooLarge = fixture({
    blockResult: () => ({ ...finalizedBlock, extra: 'x'.repeat(512 * 1024) }),
  });
  await assert.rejects(
    tooLarge.rpc.receipt(expected, new AbortController().signal),
    { code: 'UNAVAILABLE' }
  );
});

test('oversized receipt fallback retains chain and cancellation guards', async () => {
  const changed = fixture({
    chainResult: (read) => (read === 1 ? '0x1' : '0x2'),
  });
  await assert.rejects(
    changed.rpc.receipt(expected, new AbortController().signal),
    { code: 'INVALID_RESPONSE' }
  );
  const wrong = fixture({ chainResult: () => '0x2' });
  await assert.rejects(
    wrong.rpc.receipt(expected, new AbortController().signal),
    { code: 'INVALID_RESPONSE' }
  );
  assert.equal(wrong.calls.length, 1);
  const controller = new AbortController();
  const cancelled = fixture({ onNonce: () => controller.abort() });
  await assert.rejects(cancelled.rpc.receipt(expected, controller.signal), {
    code: 'CANCELLED',
  });
  assert.equal(cancelled.calls.at(-1)?.method, 'eth_getTransactionCount');
});

test('ordinary receipt failures never use the size-limit nonce fallback', async () => {
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

test('opaque oversized bodies establish no receipt outcome but permit independent nonce-consumed evidence', async () => {
  const f = fixture({ receiptResponse: () => jsonBody('x'.repeat(17000)) });
  assert.deepEqual(
    await f.rpc.receipt(expected, new AbortController().signal),
    {
      status: 'nonce-consumed',
      finalized: true,
    }
  );
});
