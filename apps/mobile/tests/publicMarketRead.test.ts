import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicMarketJson } from '../../../source/shared/publicMarketRead.ts';

const url = 'https://api.coingecko.com/api/v3/coins/markets?ids=ethereum&vs_currency=usd';

test('public market readers share one physical read with independent cancellation', async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  let physical!: AbortSignal;
  const fetcher = async (_url: string, init: RequestInit) => {
    calls++; physical = init.signal as AbortSignal;
    return new Promise<Response>(resolve => { finish = resolve; });
  };
  const a = new AbortController(), b = new AbortController();
  const first = readPublicMarketJson(fetcher, url, 1024, a.signal);
  const second = readPublicMarketJson(fetcher, url, 1024, b.signal);
  a.abort();
  await assert.rejects(first);
  assert.equal(physical.aborted, false);
  finish(Response.json({ price: 5 }));
  assert.deepEqual(await second, { price: 5 });
  assert.equal(calls, 1);
});

test('market result sharing is scoped to fetch identity, URL and response budget', async () => {
  let calls = 0;
  const pending: ((value: Response) => void)[] = [];
  const fetcher = async () => { calls++; return new Promise<Response>(resolve => pending.push(resolve)); };
  const other = async () => { calls++; return Response.json({}); };
  const owner = new AbortController().signal;
  const first = readPublicMarketJson(fetcher, url, 1024, owner);
  const second = readPublicMarketJson(fetcher, url.replace('usd', 'eur'), 1024, owner);
  const third = readPublicMarketJson(fetcher, url, 2048, owner);
  const fourth = readPublicMarketJson(other, url, 1024, owner);
  pending.forEach(resolve => resolve(Response.json({})));
  await Promise.all([first, second, third, fourth]);
  assert.equal(calls, 4);
});

test('last cancellation aborts transport and permits a fresh read without adopting the old result', async () => {
  const pending: ((value: Response) => void)[] = [];
  const signals: AbortSignal[] = [];
  const fetcher = async (_url: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal);
    return new Promise<Response>(resolve => pending.push(resolve));
  };
  const owner = new AbortController();
  const first = readPublicMarketJson(fetcher, url, 1024, owner.signal);
  owner.abort();
  await assert.rejects(first);
  assert.equal(signals[0]!.aborted, true);
  const second = readPublicMarketJson(fetcher, url, 1024, new AbortController().signal);
  pending[0]!(Response.json({ old: true }));
  pending[1]!(Response.json({ current: true }));
  assert.deepEqual(await second, { current: true });
  assert.equal(signals.length, 2);
});

test('non-market endpoints are refused before transport', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}); };
  await assert.rejects(readPublicMarketJson(fetcher, 'https://rpc.invalid/address/0x123', 1024, new AbortController().signal));
  assert.equal(calls, 0);
});

test('shared JSON consumers cannot mutate one another’s decoded result', async () => {
  let finish!: (response: Response) => void;
  const fetcher = async () => new Promise<Response>(resolve => { finish = resolve; });
  const owner = new AbortController().signal;
  const first = readPublicMarketJson(fetcher, url, 1024, owner);
  const second = readPublicMarketJson(fetcher, url, 1024, owner);
  finish(Response.json({ price: { value: 5 } }));
  const a = await first as { price: { value: number } };
  a.price.value = 0;
  assert.deepEqual(await second, { price: { value: 5 } });
});

test('cancelled physical reads still count toward the global market cap until they drain', async () => {
  const responses: ((response: Response) => void)[] = [];
  const fetcher = async () => new Promise<Response>(resolve => responses.push(resolve));
  for (let i = 0; i < 64; i++) {
    const owner = new AbortController();
    const read = readPublicMarketJson(fetcher, `${url}&page=${i}`, 1024, owner.signal);
    owner.abort();
    await assert.rejects(read);
  }
  await assert.rejects(readPublicMarketJson(fetcher, url, 1024, new AbortController().signal), /Too many/);
  responses.forEach(resolve => resolve(Response.json({})));
  await new Promise(resolve => setTimeout(resolve, 0));
  const final = readPublicMarketJson(fetcher, url, 1024, new AbortController().signal);
  responses.at(-1)!(Response.json({ done: true }));
  assert.deepEqual(await final, { done: true });
});
