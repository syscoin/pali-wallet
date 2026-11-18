import { PALI_INFRASTRUCTURE_BY_ID } from '../../../source/utils/smartAccount/deployment.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { createScopedPortfolioAssetReader } from '../src/portfolio/scopedPortfolioAssets.ts';
import type { NativeTokenInventory, NativeTokenPortfolioScope } from '../src/portfolio/tokenRegistry.ts';
import type { NativeNotificationScope } from '../src/notifications/types.ts';

const owner = '0x1111111111111111111111111111111111111111';
const token = { contractAddress: '0x2222222222222222222222222222222222222222', name: 'Saved token', symbol: 'SAVE', decimals: 6 };
const collectionAddress = '0x3333333333333333333333333333333333333333';
const network = createNativeNetwork({ id: 'selected', name: 'Selected', kind: 'evm', chainId: '1', slip44: 60,
  rpcUrl: 'https://selected.example', symbol: 'ETH', decimals: 18, testnet: false });
const scope: NativeNotificationScope = { id: 'native:hd:60:0:selected', accountId: 'hd:60:0', accountType: 'HDAccount', accountAddress: owner, network, guardian: false };
const uint = (value: bigint | number) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const abi = new Interface(['function balanceOfBatch(address[],uint256[]) view returns (uint256[])', 'function balanceOf(address,uint256) view returns (uint256)']);
type Wire = { id: number; method: string; params: any[] };

function fixture(inventory: NativeTokenInventory, multicall = false) {
  const creation = `0x${PALI_INFRASTRUCTURE_BY_ID.multicall3.deployCalldata!.slice(
    2 + 0x20 * 2
  )}`;
  const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
  const aggregate = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
  const requests: Wire[] = [], widths: number[] = [], urls: string[] = [], loads: NativeTokenPortfolioScope[] = [];
  let current = true, invalidateOnFetch = false, failToken = false, failedCollection: string | undefined;
  const read = createScopedPortfolioAssetReader({
    async load(target, check) { check(); loads.push(target); return inventory; },
    async fetch(url, init) {
      const body = JSON.parse(String(init.body)) as Wire | Wire[];
      const rows = Array.isArray(body) ? body : [body];
      widths.push(rows.length);
      const responses = rows.map(request => {
      requests.push(request); urls.push(url);
      if (invalidateOnFetch) current = false;
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x' + 'a'.repeat(64) };
      else if (request.method === 'eth_getCode') result = request.params[0] === failedCollection ? '0x' : multicall ? runtime : '0x6000';
      else if (request.method === 'eth_call') {
        const call = request.params[0] as { to: string; data: string };
        assert.equal(request.params[1], '0x10');
        const selector = call.data.slice(0, 10);
        result = selector === aggregate.getFunction('aggregate3')!.selector ? aggregate.encodeFunctionResult('aggregate3', [Array.from(aggregate.decodeFunctionData('aggregate3', call.data)[0],
          (entry: { callData: string }) => ({ success: true, returnData: uint(entry.callData === '0x313ce567' ? 6 : 1234567) }))])
          : selector === '0x313ce567' ? uint(failToken ? 18 : 6)
          : selector === '0x01ffc9a7' ? uint(1)
          : selector === '0x4e1273f4' ? abi.encodeFunctionResult('balanceOfBatch', [abi.decodeFunctionData('balanceOfBatch', call.data)[1].map(() => 5)])
          : selector === '0x00fdd58e' ? uint(0)
          : uint(call.to === collectionAddress ? 3 : 1234567);
      } else assert.fail('No discovery or transaction RPC is permitted');
      return { jsonrpc: '2.0', id: request.id, result };
      });
      return Response.json(Array.isArray(body) ? responses : responses[0]);
    },
  });
  const check = () => { if (!current) throw Error('Changed visible scope'); };
  return { read: () => read(scope, new AbortController().signal, check), requests, widths, urls, loads,
    invalidateOnFetch() { invalidateOnFetch = true; }, failToken() { failToken = true; }, failCollection(address: string) { failedCollection = address; } };
}

test('saved assets read only the requested visible account and endpoint using existing anchored readers', async () => {
  const collectible = { contractAddress: collectionAddress, tokenStandard: 'ERC-721' as const };
  const multi = { contractAddress: '0x4444444444444444444444444444444444444444', tokenStandard: 'ERC-1155' as const, tokenId: '7' };
  const f = fixture({ revision: 1, items: [token], collectibles: [collectible, multi] });
  const result = await f.read();
  assert.deepEqual(f.loads, [{ accountId: 'hd:60:0', address: owner, networkId: network.id, registrationHash: network.registrationHash }]);
  assert(f.urls.every(url => url === network.rpcUrl));
  assert.deepEqual(result.tokens, [{ metadata: token, status: 'available', units: '1234567' }]);
  assert.deepEqual(result.collectibles, [
    { collectible, status: 'available', units: '3' }, { collectible: multi, status: 'available', units: '5' },
  ]);
  for (const request of f.requests.filter(request => request.method === 'eth_call')) {
    const data = request.params[0].data as string;
    assert(!data.startsWith('0x06fdde03') && !data.startsWith('0x95d89b41'), 'saved labels do not trigger metadata discovery');
    if (data.startsWith('0x70a08231')) assert(data.toLowerCase().endsWith(owner.slice(2)));
  }
  assert(Object.isFrozen(result) && Object.isFrozen(result.tokens));
});

test('an empty saved registry performs no asset RPC and one failed token does not invent a zero balance', async () => {
  const empty = fixture({ revision: 0, items: [] });
  assert.deepEqual(await empty.read(), { tokens: [], collectibles: [] });
  assert.equal(empty.requests.length, 0);
  const f = fixture({ revision: 1, items: [token] }); f.failToken();
  assert.deepEqual((await f.read()).tokens, [{ metadata: token, status: 'error', units: null }]);
});

test('scope retirement stops later RPCs and refuses publishing a held result', async () => {
  const f = fixture({ revision: 1, items: [token] }); f.invalidateOnFetch();
  await assert.rejects(f.read(), /Changed visible scope/);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0]!.method, 'eth_chainId');
});

for (const multicall of [false, true]) test(`repeated scoped snapshots retain endpoint capability without retaining an old guard (Multicall ${multicall})`, async () => {
  const tokens = Array.from({ length: 20 }, (_, index) => ({ ...token,
    contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}` }));
  const f = fixture({ revision: 1, items: tokens }, multicall);
  const first = await f.read();
  assert(first.tokens.every(row => row.status === 'available'));
  assert.equal(f.requests.filter(row => row.method === 'eth_getCode').length, multicall ? 1 : 2);
  f.requests.length = 0;
  const second = await f.read();
  assert(second.tokens.every(row => row.status === 'available'));
  assert.equal(f.requests.filter(row => row.method === 'eth_getCode').length, 0);
  assert.equal(f.requests.length, multicall ? 5 : 44);
  f.invalidateOnFetch();
  await assert.rejects(f.read(), /Changed visible scope/);
});

test('ten saved ERC721 collections share one canonical observation and isolate failed collections', async () => {
  const collectibles = Array.from({ length: 10 }, (_, index) => ({ contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`, tokenStandard: 'ERC-721' as const }));
  const f = fixture({ revision: 1, items: [], collectibles });
  const healthy = await f.read();
  assert(healthy.collectibles.every(row => row.status === 'available'));
  assert.equal(f.requests.length, 34);
  f.requests.length = 0;
  f.failCollection(collectibles[3]!.contractAddress);
  const result = await f.read();
  assert.equal(result.collectibles.filter(row => row.status === 'available').length, 9);
  assert.equal(result.collectibles[3]!.status, 'error');
  assert.equal(f.requests.filter(row => row.method === 'eth_chainId').length, 2);
  assert.equal(f.requests.filter(row => row.method === 'eth_getBlockByNumber').length, 2);
  assert.equal(f.requests.filter(row => row.method === 'eth_getCode').length, 10);
  assert.equal(f.requests.length, 34);
});

test('ten saved ERC1155 IDs share contract code, negative probe and balanceOfBatch', async () => {
  const collectibles = Array.from({ length: 10 }, (_, tokenId) => ({ contractAddress: collectionAddress, tokenStandard: 'ERC-1155' as const, tokenId: String(tokenId) }));
  const f = fixture({ revision: 1, items: [], collectibles });
  const result = await f.read();
  assert(result.collectibles.every(row => row.status === 'available' && row.units === '5'));
  assert.equal(f.requests.length, 7);
  assert.equal(f.requests.filter(row => row.method === 'eth_getCode').length, 1);
  assert.equal(f.requests.filter(row => row.method === 'eth_call' && row.params[0].data.startsWith('0x4e1273f4')).length, 1);
  assert.equal(f.widths.length, 5);
});

for (const failure of ['content-type', 'authority'] as const) test(`scoped NFT ${failure} rejection cancels the streaming body and fetch`, async () => {
  let current = true, cancelled = 0;
  let fetchSignal: AbortSignal | undefined;
  const read = createScopedPortfolioAssetReader({
    async load() { return { revision: 1, items: [], collectibles: [{ contractAddress: collectionAddress, tokenStandard: 'ERC-721' }] }; },
    async fetch(_url, init) {
      fetchSignal = init.signal as AbortSignal;
      if (failure === 'authority') current = false;
      return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': failure === 'content-type' ? 'text/html' : 'application/json' } });
    },
  });
  const result = read(scope, new AbortController().signal, () => { if (!current) throw Error('retired'); });
  if (failure === 'authority') await assert.rejects(result);
  else assert.equal((await result).collectibles[0]!.status, 'error');
  assert.equal(cancelled, 1);
  assert.equal(fetchSignal?.aborted, true);
});


test('grouped ERC1155 fallback isolates one failed ID under the same selected block', async () => {
  const collectibles = ['1', '2', '3'].map(tokenId => ({ contractAddress: collectionAddress, tokenStandard: 'ERC-1155' as const, tokenId }));
  const calls: string[] = [];
  const read = createScopedPortfolioAssetReader({
    async load() { return { revision: 1, items: [], collectibles }; },
    async fetch(_url, init) {
      const payload = JSON.parse(String(init.body));
      const rows = Array.isArray(payload) ? payload : [payload];
      const replies = rows.map((request: Wire) => {
        let result: unknown = '0x6000';
        let error: { code: number; message: string } | undefined;
        if (request.method === 'eth_chainId') result = '0x1';
        else if (request.method === 'eth_getBlockByNumber') result = { number: '0x10', hash: `0x${'ab'.repeat(32)}` };
        else if (request.method === 'eth_call') {
          assert.equal(request.params[1], '0x10');
          const decoded = abi.parseTransaction(request.params[0]);
          assert(decoded);
          calls.push(decoded.name);
          if (decoded.name === 'balanceOfBatch' || decoded.args[1] === 2n)
            error = { code: -32000, message: 'Read unavailable' };
          else result = uint(['1', '3'].includes(String(decoded.args[1])) ? 5 : 0);
        }
        return { jsonrpc: '2.0', id: request.id, ...(error ? { error } : { result }) };
      });
      return Response.json(Array.isArray(payload) ? replies : replies[0]);
    },
  });
  const result = await read(scope, new AbortController().signal, () => undefined);
  assert.deepEqual(result.collectibles.map(row => [row.status, row.units]), [
    ['available', '5'], ['error', null], ['available', '5'],
  ]);
  assert.equal(calls.filter(method => method === 'balanceOfBatch').length, 1);
  assert.equal(calls.filter(method => method === 'balanceOf').length, 4);
});


test('the maximum saved ERC1155 group fits one bounded balanceOfBatch response', async () => {
  const collectibles = Array.from({ length: 256 }, (_, id) => ({ contractAddress: collectionAddress,
    tokenStandard: 'ERC-1155' as const, tokenId: String(id) }));
  const f = fixture({ revision: 1, items: [], collectibles });
  const result = await f.read();
  assert.equal(result.collectibles.length, 256);
  assert(result.collectibles.every(row => row.status === 'available' && row.units === '5'));
  assert.equal(f.requests.length, 7);
});

for (const scenario of ['one-stalled', 'one-stalled-scalar', 'one-stalled-unresponsive-scalar', 'forty-batched', 'forty-scalar', 'forty-batched-750', 'forty-scalar-750', 'canonical-change'] as const) test(`grouped NFT deadlines preserve healthy rows (${scenario})`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const count = scenario.startsWith('one-stalled') || scenario === 'canonical-change' ? 10 : 40;
  const collectibles = Array.from({ length: count }, (_, index) => ({
    contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    tokenStandard: 'ERC-721' as const,
  }));
  const requests: Wire[] = [];
  let active = 0, peak = 0, finalChecks = 0;
  const read = createScopedPortfolioAssetReader({
    async load() { return { revision: 1, items: [], collectibles }; },
    async fetch(_url, init) {
      const payload = JSON.parse(String(init.body)) as Wire | Wire[];
      const rows = Array.isArray(payload) ? payload : [payload];
      requests.push(...rows);
      active++; peak = Math.max(peak, active);
      const stalled = scenario.startsWith('one-stalled') && rows.some(row =>
        row.params[0] === collectibles[0]!.contractAddress || row.params[0]?.to === collectibles[0]!.contractAddress);
      if (scenario.includes('scalar') && Array.isArray(payload)) {
        active--;
        return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch unsupported' } });
      }
      if (stalled) return new Promise<Response>((_resolve, reject) => {
        if (scenario === 'one-stalled-unresponsive-scalar') return;
        init.signal!.addEventListener('abort', () => { active--; reject(new Error('aborted stalled collection')); }, { once: true });
      });
      await new Promise(resolve => setTimeout(resolve, scenario.endsWith('750') ? 750 : 450));
      active--;
      const replies = rows.map(row => {
        if (row.method === 'eth_getBlockByNumber' && row.params[0] === '0x10') finalChecks++;
        return { jsonrpc: '2.0', id: row.id, result: row.method === 'eth_chainId' ? '0x1'
          : row.method === 'eth_getBlockByNumber' ? { number: '0x10', hash: `0x${(scenario === 'canonical-change' && row.params[0] === '0x10' ? 'b' : 'a').repeat(64)}` }
          : row.method === 'eth_getCode' ? '0x6000' : uint(row.params[0].data.startsWith('0x01ffc9a7') ? 1 : 3) };
      });
      return Response.json(Array.isArray(payload) ? replies : replies[0]);
    },
  });
  let completed = false;
  const pending = read(scope, new AbortController().signal, () => undefined).then(value => { completed = true; return value; });
  for (let elapsed = 0; !completed && elapsed < 35000; elapsed += 50) {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(50);
  }
  const result = await pending;
  assert.equal(result.collectibles.filter(row => row.status === 'available').length, scenario === 'canonical-change' ? 0 : count - (scenario.startsWith('one-stalled') ? 1 : 0));
  assert.equal(finalChecks, 1);
  assert(peak <= 4, `physical peak ${peak}`);
  assert(requests.some(row => row.method === 'eth_call'));
});

test('external cancellation immediately aborts each active collection read', async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  const active: AbortSignal[] = [];
  const read = createScopedPortfolioAssetReader({
    async load() { return { revision: 1, items: [], collectibles: [{ contractAddress: collectionAddress, tokenStandard: 'ERC-721' }] }; },
    async fetch(_url, init) {
      const payload = JSON.parse(String(init.body)) as Wire | Wire[];
      const rows = Array.isArray(payload) ? payload : [payload];
      if (rows.some(row => row.method === 'eth_getCode')) {
        active.push(init.signal as AbortSignal); started.resolve();
        return new Promise<Response>(() => undefined);
      }
      return Response.json(rows.map(row => ({ jsonrpc: '2.0', id: row.id,
        result: row.method === 'eth_chainId' ? '0x1' : { number: '0x10', hash: `0x${'a'.repeat(64)}` } })));
    },
  });
  const result = read(scope, controller.signal, () => undefined);
  await started.promise;
  controller.abort();
  await assert.rejects(result);
  assert.equal(active.length, 1);
  assert(active.every(signal => signal.aborted));
});

for (const standard of ['ERC-721', 'ERC-1155', 'ERC-1155 fallback'] as const) test(`healthy 750ms scalar ${standard} group fits its sequential work budget`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const collectible = standard === 'ERC-721' ? { contractAddress: collectionAddress, tokenStandard: standard }
    : { contractAddress: collectionAddress, tokenStandard: 'ERC-1155' as const, tokenId: '1' };
  const read = createScopedPortfolioAssetReader({
    async load() { return { revision: 1, items: [], collectibles: [collectible] }; },
    async fetch(_url, init) {
      const payload = JSON.parse(String(init.body)) as Wire | Wire[];
      if (Array.isArray(payload)) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch unsupported' } });
      await new Promise(resolve => setTimeout(resolve, 750));
      const data = payload.params[0]?.data as string | undefined;
      let result: unknown = payload.method === 'eth_chainId' ? '0x1'
        : payload.method === 'eth_getBlockByNumber' ? { number: '0x10', hash: `0x${'a'.repeat(64)}` }
        : payload.method === 'eth_getCode' ? '0x6000'
        : data?.startsWith('0x01ffc9a7') ? uint(1) : uint(3);
      if (data?.startsWith('0x00fdd58e')) result = uint(abi.decodeFunctionData('balanceOf', data)[1] === 1n ? 3 : 0);
      if (data?.startsWith('0x4e1273f4') && standard === 'ERC-1155 fallback')
        return Response.json({ jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'Batch balance unavailable' } });
      if (data?.startsWith('0x4e1273f4')) result = abi.encodeFunctionResult('balanceOfBatch', [[3]]);
      return Response.json({ jsonrpc: '2.0', id: payload.id, result });
    },
  });
  let complete = false;
  const pending = read(scope, new AbortController().signal, () => undefined).then(result => { complete = true; return result; });
  for (let elapsed = 0; !complete && elapsed < 15000; elapsed += 50) {
    await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(50);
  }
  assert.equal((await pending).collectibles[0]!.status, 'available');
});

test('mixed saved assets share one identity and canonical block envelope', async () => {
  const collectible = { contractAddress: collectionAddress, tokenStandard: 'ERC-721' as const };
  const f = fixture({ revision: 1, items: [token], collectibles: [collectible] });
  const result = await f.read();
  assert.equal(result.tokens[0]?.status, 'available'); assert.equal(result.collectibles[0]?.status, 'available');
  assert.equal(f.requests.filter(row => row.method === 'eth_chainId').length, 2);
  assert.equal(f.requests.filter(row => row.method === 'eth_getBlockByNumber').length, 2);
  assert.equal(f.requests.length, 9); assert.equal(f.widths.length, 4);
});

for (const failure of ['precision', 'code', 'canonical', 'chain'] as const) test(`mixed portfolio keeps its shared final barrier and member isolation (${failure})`, async () => {
  const collectible = { contractAddress: collectionAddress, tokenStandard: 'ERC-721' as const };
  let chainReads = 0;
  const requests: Wire[] = [];
  const read = createScopedPortfolioAssetReader({
    async load() { return { revision: 1, items: [token], collectibles: [collectible] }; },
    async fetch(_url, init) {
      const payload = JSON.parse(String(init.body)) as Wire | Wire[];
      const rows = Array.isArray(payload) ? payload : [payload]; requests.push(...rows);
      const replies = rows.map(row => ({ jsonrpc: '2.0', id: row.id, result:
        row.method === 'eth_chainId' ? (++chainReads > 1 && failure === 'chain' ? '0x2' : '0x1') :
        row.method === 'eth_getBlockByNumber' ? { number: '0x10', hash: '0x' + (failure === 'canonical' && row.params[0] !== 'latest' ? 'b' : 'a').repeat(64) } :
        row.method === 'eth_getCode' ? failure === 'code' ? '0x' : '0x6000' :
        uint(row.params[0].data === '0x313ce567' ? failure === 'precision' ? 18 : 6 : row.params[0].data.startsWith('0x01ffc9a7') ? 1 : 123) }));
      return Response.json(Array.isArray(payload) ? replies : replies[0]);
    },
  });
  const result = await read(scope, new AbortController().signal, () => {});
  assert.equal(result.tokens[0]?.status, ['precision', 'canonical', 'chain'].includes(failure) ? 'error' : 'available');
  assert.equal(result.collectibles[0]?.status, ['code', 'canonical', 'chain'].includes(failure) ? 'error' : 'available');
  assert.equal(chainReads, 2);
  assert.equal(requests.filter(row => row.method === 'eth_getBlockByNumber').length, 2);
});

for (const stalled of ['token', 'collection'] as const) test(`mixed portfolio preserves the healthy family when ${stalled} stalls`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const signals: AbortSignal[] = [];
  const read = createScopedPortfolioAssetReader({
    async load() { return { revision: 1, items: [token], collectibles: [{ contractAddress: collectionAddress, tokenStandard: 'ERC-721' }] }; },
    async fetch(_url, init) {
      const payload = JSON.parse(String(init.body)) as Wire | Wire[];
      const rows = Array.isArray(payload) ? payload : [payload];
      if (rows.some(row => row.params[0] === (stalled === 'collection' ? collectionAddress : token.contractAddress) || row.params[0]?.to === (stalled === 'collection' ? collectionAddress : token.contractAddress))) {
        signals.push(init.signal!);
        return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
      }
      const replies = rows.map(row => ({ jsonrpc: '2.0', id: row.id, result:
        row.method === 'eth_chainId' ? '0x1' : row.method === 'eth_getBlockByNumber' ? { number: '0x10', hash: '0x' + 'a'.repeat(64) } :
        row.method === 'eth_getCode' ? '0x6000' : uint(row.params[0].data === '0x313ce567' ? 6 : row.params[0].data.startsWith('0x01ffc9a7') ? 1 : 123) }));
      return Response.json(Array.isArray(payload) ? replies : replies[0]);
    },
  });
  let settled = false;
  const pending = read(scope, new AbortController().signal, () => {}).finally(() => { settled = true; });
  for (let elapsed = 0; !settled && elapsed < 15000; elapsed += 50) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(50); }
  const result = await pending;
  assert.equal(result.tokens[0]?.status, stalled === 'token' ? 'error' : 'available');
  assert.equal(result.collectibles[0]?.status, stalled === 'collection' ? 'error' : 'available');
  assert(signals.every(signal => signal.aborted));
});

test('a retired mixed portfolio phase cannot be reused by another operation or account', async () => {
  const { createErc20Reader, createPortfolioReadOperation } = await import('../src/portfolio/erc20ReadRpc.ts');
  let retained: import('../src/portfolio/erc20ReadRpc.ts').PortfolioReadPhase | undefined;
  const fetch = async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as Wire | Wire[];
    const rows = Array.isArray(payload) ? payload : [payload];
    const replies = rows.map(row => ({ jsonrpc: '2.0', id: row.id, result: row.method === 'eth_chainId' ? '0x1' :
      row.method === 'eth_getBlockByNumber' ? { number: '0x10', hash: '0x' + 'a'.repeat(64) } : uint(row.params[0].data === '0x313ce567' ? 6 : 123) }));
    return Response.json(Array.isArray(payload) ? replies : replies[0]);
  };
  const options = { fetch, registrations: () => [network] }, parent = createPortfolioReadOperation(options), reader = createErc20Reader(options);
  const signal = new AbortController().signal;
  await parent(network.id, owner, 2, signal, () => {}, async phase => {
    retained = phase;
    const values = await reader.readBalances!(network.id, owner, [token], signal, () => {}, phase);
    assert.equal(values[0]?.status, 'available');
    await assert.rejects(reader.readBalances!(network.id, collectionAddress, [token], signal, () => {}, phase), { code: 'INVALID_INPUT' });
  });
  await assert.rejects(reader.readBalances!(network.id, owner, [token], signal, () => {}, retained), { code: 'INVALID_INPUT' });
});
