import assert from 'node:assert/strict';
import test from 'node:test';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import {
  getNativeNetwork,
  type EvmNetworkId,
} from '../src/custody/networkContext.ts';

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
const jsonBody = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/json' } });
type Call = { method: string; params: unknown[] };
type Stage = 'initial' | 'repeated';
function fixture(
  options: {
    id?: EvmNetworkId;
    stage?: Stage;
    kind?: 'stream' | 'text' | 'declared';
    consumed?: boolean;
    receiptResponse?: (id: number) => Response;
    blockResult?: (call: Call) => unknown;
    onRequest?: (call: Call) => void;
    chain?: (read: number) => string;
    timeoutMs?: number;
  } = {}
) {
  const id = options.id ?? 'ethereum';
  const calls: Call[] = [];
  let receipts = 0,
    nonces = 0,
    chains = 0;
  const rpc = new EvmTransferReadRpc(id, {
    timeoutMs: options.timeoutMs,
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      calls.push(request);
      options.onRequest?.(request);
      let result: unknown;
      if (request.method === 'eth_chainId')
        result =
          options.chain?.(++chains) ??
          '0x' + BigInt(getNativeNetwork(id).chainId).toString(16);
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
        nonces++;
        result =
          (options.stage === 'repeated' && nonces === 1) ||
          options.consumed !== false
            ? '0x8'
            : '0x7';
      } else if (request.method === 'eth_getBlockByNumber') {
        result = options.blockResult
          ? options.blockResult(request)
          : {
              number:
                request.params[0] === 'finalized' ? '0xa' : request.params[0],
              hash: blockHash,
            };
      } else throw Error('Unexpected RPC method');
      return jsonBody(
        JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
      );
    },
  });
  return { rpc, calls };
}
const signal = () => new AbortController().signal;
const guard = () => undefined;

for (const stage of ['initial', 'repeated'] as const) {
  for (const kind of ['stream', 'text', 'declared'] as const) {
    test(`generic ${stage} oversized ${kind} receipt uses fresh finalized nonce evidence without claiming execution`, async () => {
      const f = fixture({ stage, kind });
      assert.deepEqual(await f.rpc.receipt(expected, signal(), guard), {
        status: 'nonce-consumed',
        settlement: {
          kind: 'ethereum-finalized',
          observedHeight: '10',
          terminalEligible: true,
        },
      });
      assert.deepEqual(
        f.calls
          .filter((c) => c.method === 'eth_getBlockByNumber')
          .slice(-2)
          .map((c) => c.params),
        [
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
  test(`generic ${stage} oversized receipt never returns absent or the previous status when fresh nonce is unconsumed`, async () => {
    const f = fixture({ stage, consumed: false });
    await assert.rejects(f.rpc.receipt(expected, signal(), guard), {
      code: 'UNAVAILABLE',
    });
  });
}

test('generic oversized receipt preserves NEVM observation-only semantics and refuses unqualified settlement', async () => {
  for (const id of ['syscoin-nevm', 'syscoin-nevm-testnet'] as const) {
    const f = fixture({ id });
    assert.deepEqual(await f.rpc.receipt(expected, signal(), guard), {
      status: 'nonce-consumed',
      settlement: {
        kind: 'nevm-depth-observation',
        observedHeight: '10',
        terminalEligible: false,
      },
    });
  }
  for (const id of ['base', 'arbitrum', 'rollux'] as const) {
    const f = fixture({ id });
    await assert.rejects(f.rpc.receipt(expected, signal(), guard), {
      code: 'UNAVAILABLE',
    });
    assert(
      !f.calls.some(
        (c) =>
          c.method === 'eth_getBlockByNumber' ||
          c.method === 'eth_getTransactionCount'
      )
    );
  }
  const disabled = fixture({ id: 'zksys-testnet' });
  await assert.rejects(disabled.rpc.receipt(expected, signal(), guard), {
    code: 'UNQUALIFIED_PROFILE',
  });
  assert.equal(disabled.calls.length, 0);
});

test('generic oversized receipt still requires bounded canonical finalized block and chain consistency', async () => {
  for (const blockResult of [
    () => null,
    () => ({ number: '0x00a', hash: blockHash }),
    () => ({ number: '0xa', hash: 'bad' }),
    (call: Call) => ({
      number: call.params[0] === 'finalized' ? '0xa' : '0xb',
      hash: blockHash,
    }),
    (call: Call) => ({
      number: '0xa',
      hash: call.params[0] === 'finalized' ? blockHash : hash,
    }),
  ])
    await assert.rejects(
      fixture({ blockResult }).rpc.receipt(expected, signal(), guard)
    );
  const wide = fixture({
    blockResult: (call) => ({
      number: call.params[0] === 'finalized' ? '0xa' : call.params[0],
      hash: blockHash,
      transactions: Array(300).fill(hash),
    }),
  });
  assert.equal(
    (await wide.rpc.receipt(expected, signal(), guard))?.status,
    'nonce-consumed'
  );
  const huge = fixture({
    blockResult: () => ({
      number: '0xa',
      hash: blockHash,
      extra: 'x'.repeat(512 * 1024),
    }),
  });
  await assert.rejects(huge.rpc.receipt(expected, signal(), guard), {
    code: 'UNAVAILABLE',
  });
  const changed = fixture({ chain: (read) => (read === 1 ? '0x1' : '0x2') });
  await assert.rejects(changed.rpc.receipt(expected, signal(), guard), {
    code: 'PROFILE_CHANGED',
  });
});

test('generic receipt fallback discards stale A-B-A and cancelled results at every new read boundary', async () => {
  for (const mode of ['guard', 'abort'] as const) {
    for (const boundary of [
      'receipt',
      'finalized',
      'nonce',
      'canonical',
      'end-chain',
    ]) {
      let revision = 0,
        chainReads = 0;
      const controller = new AbortController();
      const f = fixture({
        onRequest: (call) => {
          if (call.method === 'eth_chainId') chainReads++;
          const reached =
            (boundary === 'receipt' &&
              call.method === 'eth_getTransactionReceipt') ||
            (boundary === 'finalized' &&
              call.method === 'eth_getBlockByNumber' &&
              call.params[0] === 'finalized') ||
            (boundary === 'nonce' &&
              call.method === 'eth_getTransactionCount') ||
            (boundary === 'canonical' &&
              call.method === 'eth_getBlockByNumber' &&
              call.params[0] === '0xa') ||
            (boundary === 'end-chain' &&
              call.method === 'eth_chainId' &&
              chainReads === 2);
          if (reached) {
            if (mode === 'abort') controller.abort();
            else revision += 2;
          }
        },
      });
      await assert.rejects(
        f.rpc.receipt(expected, controller.signal, () => {
          if (revision !== 0) throw Error('stale');
        }),
        { code: 'CANCELLED' }
      );
    }
  }
  const asyncGuard = fixture();
  await assert.rejects(
    asyncGuard.rpc.receipt(
      expected,
      signal(),
      (async () => undefined) as () => void
    ),
    { code: 'CANCELLED' }
  );
  assert.equal(asyncGuard.calls.length, 0);
});

test('generic small malformed responses, RPC errors and transport failures never select the size fallback', async () => {
  for (const receiptResponse of [
    () => {
      throw Error('network unavailable');
    },
    () => jsonBody('{broken'),
    () =>
      new Response('{}', {
        headers: {
          'content-type': 'application/json',
          'content-length': 'invalid',
        },
      }),
    (id: number) =>
      jsonBody(JSON.stringify({ jsonrpc: '2.0', id: id + 1, result: receipt })),
    (id: number) =>
      jsonBody(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000 } })),
    () => new Response(new Uint8Array([0xff])),
    () => new Response('offline', { status: 503 }),
  ]) {
    const f = fixture({ receiptResponse });
    await assert.rejects(f.rpc.receipt(expected, signal(), guard));
    assert(
      !f.calls.some(
        (c) =>
          c.method === 'eth_getBlockByNumber' ||
          c.method === 'eth_getTransactionCount'
      )
    );
  }
  const opaque = fixture({
    receiptResponse: () => jsonBody('x'.repeat(17000)),
  });
  assert.equal(
    (await opaque.rpc.receipt(expected, signal(), guard))?.status,
    'nonce-consumed'
  );
});

test('generic oversized receipt retains the detached request during asynchronous caller mutation', async () => {
  const input = { ...expected };
  const f = fixture({
    onRequest: (call) => {
      if (call.method === 'eth_getTransactionReceipt') {
        input.from = to;
        input.nonce = '999';
        input.hash = blockHash;
      }
    },
  });
  assert.equal(
    (await f.rpc.receipt(input, signal(), guard))?.status,
    'nonce-consumed'
  );
  assert(
    f.calls
      .filter((call) => call.method === 'eth_getTransactionCount')
      .every((call) => call.params[0] === from)
  );
});
