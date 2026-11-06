import assert from 'node:assert/strict';
import test from 'node:test';
import { readSentryNode } from '../../../source/shared/sentryNodeLookup.ts';
import { SENTRY_NETWORKS } from '../../../source/shared/sentryNetworks.ts';
import { SENTRY_TXID, sentryNodeResponse } from './sentryNodeFixtures.ts';

const origin = 'https://sentry.test';
const input = { network: 'mainnet' as const, origin, proTxHash: SENTRY_TXID };
const requestUrl = `${origin}/api/sentry/v1/context?network=mainnet&proTxHash=${SENTRY_TXID}`;
const fixture = () => sentryNodeResponse(SENTRY_NETWORKS.mainnet.genesisHash);

test('reads only the fixed public Sentry context and projects known fields', async () => {
  let calls = 0;
  const active = new AbortController();
  const body = fixture();
  const result = await readSentryNode(input, {
    assertCurrent: () => undefined,
    signal: active.signal,
    async fetch(url, init) {
      calls++;
      assert.equal(url, requestUrl);
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.equal(init.body, undefined);
      return Response.json({ ...body, node: {
        ...body.node, hidden: 'unexpected value',
        collateralOutpoint: { ...body.node.collateralOutpoint, ignored: 'unexpected value' },
      } });
    },
  });
  assert.deepEqual(result, { network: 'mainnet', origin, node: body.node });
  assert.equal(calls, 1);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.node.collateralOutpoint));
});

test('rejects mismatched scope, malformed outpoints, redirects and oversized responses', async () => {
  const body = fixture();
  for (const response of [
    Response.json({ ...body, chain: { genesisHash: SENTRY_NETWORKS.testnet.genesisHash } }),
    Response.json({ ...body, node: { ...body.node, proTxHash: '1'.repeat(64) } }),
    Response.json({ ...body, node: { ...body.node, collateralOutpoint: { ...body.node.collateralOutpoint, vout: 0x100000000 } } }),
    Object.defineProperty(Response.json(body), 'url', { value: 'https://other.test/' }),
    new Response('x'.repeat(65_537)),
  ]) {
    let fetchSignal: AbortSignal | null | undefined;
    await assert.rejects(readSentryNode(input, {
      assertCurrent: () => undefined,
      signal: new AbortController().signal,
      async fetch(_url, init) { fetchSignal = init.signal; return response; },
    }));
    assert.equal(fetchSignal?.aborted, true);
  }
});

test('no request on invalid origin or revoked owner, and a late result after close is retired', async () => {
  for (const [lookup, revoked] of [[{ ...input, origin: 'https://sentry.test/extra' }, false], [input, true]] as const) {
    await assert.rejects(readSentryNode(lookup, {
      assertCurrent() { if (revoked) throw Error('Activity changed'); },
      signal: new AbortController().signal,
      async fetch() { assert.fail('Retired request should not dispatch'); },
    }));
  }
  const active = new AbortController();
  let finish!: (response: Response) => void;
  let requestSignal: AbortSignal | null | undefined;
  const waiting = readSentryNode(input, {
    assertCurrent: () => undefined,
    signal: active.signal,
    fetch(_url, init) {
      requestSignal = init.signal;
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  active.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(requestSignal?.aborted, true);
  finish(Response.json(fixture()));
});
