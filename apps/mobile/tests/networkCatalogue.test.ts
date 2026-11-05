import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeChainCatalogue } from '../src/custody/networkCatalogue.ts';
import { EVM_CHAIN_CATALOGUE_URL } from '../../../source/shared/chainCatalogueData.ts';
import { rankChainSuggestions } from '../../../source/shared/chainCatalogue.ts';

const rpc = (url: string, tracking?: string, isOpenSource?: boolean) => ({ url, tracking, isOpenSource });
const entry = (chainId: number, name: string, decimals: number, candidates: ReturnType<typeof rpc>[]) =>
  ({ chainId, name, nativeCurrency: { symbol: 'EX', name: 'Example', decimals }, rpc: candidates });

test('lazy native catalogue uses one identifier-free request and shares local ranking and RPC preferences', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const load = createNativeChainCatalogue(async (url, init) => {
    requests.push({ url, init });
    return Response.json([
      entry(42, 'Example Testnet', 18, [
        rpc('https://first.example'),
        rpc('https://template.example/${API_KEY}', 'none', true),
        rpc('https://encoded.example/%7Bkey%7D', 'none', true),
        rpc('https://user:secret@credentials.example', 'none', true),
        rpc('wss://websocket.example', 'none', true),
        rpc('https://preferred.example', 'none', true),
      ]),
      entry(42, 'Duplicate', 18, [rpc('https://duplicate.example')]),
      entry(24, 'Example Incompatible', 6, [rpc('https://decimals.example')]),
      entry(0, 'Example Invalid', 18, [rpc('https://zero.example')]),
      entry(43, 'Example Template', 18, [rpc('https://bad.example/{key}')]),
    ]);
  });
  assert.equal(requests.length, 0);
  const first = load();
  assert.equal(load(), first);
  const result = await first;
  assert.equal(await load(), result);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, EVM_CHAIN_CATALOGUE_URL);
  assert.deepEqual({ ...requests[0]!.init, signal: undefined }, {
    method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
    redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: undefined,
  });
  assert.deepEqual(rankChainSuggestions(result, 'Example').map((row) => row.chainId), [42]);
  assert.deepEqual(result[0], {
    chainId: 42, name: 'Example Testnet', isTestnet: false,
    nativeCurrency: { symbol: 'EX' }, rpc: [{ url: 'https://preferred.example' }],
  });
});

test('only explicit retry replaces a failed lookup and concurrent retry reuses it', async () => {
  let calls = 0;
  const load = createNativeChainCatalogue(async () => {
    if (++calls === 1) return new Response('Forbidden', { status: 403 });
    return Response.json([entry(42, 'Example', 18, [rpc('https://example.test')])]);
  });
  const failed = load();
  await assert.rejects(failed);
  assert.equal(load(), failed);
  assert.equal(calls, 1);
  const retry = load(true);
  assert.equal(load(true), retry);
  assert.equal(load(), retry);
  assert.equal((await retry)[0]?.chainId, 42);
  assert.equal(load(true), retry);
  assert.equal(calls, 2);
});

test('catalogue rejects forbidden, malformed, redirected and oversized responses without a retry', async () => {
  for (const makeResponse of [
    () => new Response('Forbidden', { status: 403 }),
    () => Response.json({ chainId: 42 }),
    () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
    () => Object.defineProperty(Response.json([]), 'redirected', { value: true }),
    () => Object.defineProperty(Response.json([]), 'url', { value: 'https://wrong.example/rpcs.json' }),
    () => new Response('[]', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }),
    () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)),
  ]) {
    let calls = 0;
    const load = createNativeChainCatalogue(async () => { calls++; return makeResponse(); });
    const first = load();
    await assert.rejects(first);
    assert.equal(load(), first);
    assert.equal(calls, 1);
  }
});

test('catalogue deadline settles even if the transport ignores abort and discards a late body', async () => {
  let release!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const load = createNativeChainCatalogue(async (_url, init) => {
    signal = init.signal;
    return new Promise<Response>((resolve) => { release = resolve; });
  }, 5);
  await assert.rejects(load(), { name: 'AbortError' });
  assert.equal(signal?.aborted, true);
  let cancelled = false;
  release(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('catalogue refuses a response that can only be buffered in full', async () => {
  let textCalls = 0;
  let cancelled = false;
  const response = {
    ok: true, headers: new Headers(),
    body: { async cancel() { cancelled = true; } },
    async text() { textCalls++; return '[]'; },
  } as unknown as Response;
  const load = createNativeChainCatalogue(async () => response);
  await assert.rejects(load(), /stream/);
  assert.equal(textCalls, 0);
  assert.equal(cancelled, true);
});

test('catalogue cancels a stream that crosses its admission limit', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  }));
  const load = createNativeChainCatalogue(async () => response);
  await assert.rejects(load(), { name: 'ResponseSizeLimitError' });
  assert.equal(cancelled, true);
});
