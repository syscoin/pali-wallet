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
const abi = new Interface(['function balanceOfBatch(address[],uint256[]) view returns (uint256[])']);
type Wire = { id: number; method: string; params: any[] };

function fixture(inventory: NativeTokenInventory) {
  const requests: Wire[] = [], urls: string[] = [], loads: NativeTokenPortfolioScope[] = [];
  let current = true, invalidateOnFetch = false, failToken = false;
  const read = createScopedPortfolioAssetReader({
    async load(target, check) { check(); loads.push(target); return inventory; },
    async fetch(url, init) {
      const request = JSON.parse(String(init.body)) as Wire; requests.push(request); urls.push(url);
      if (invalidateOnFetch) current = false;
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x' + 'a'.repeat(64) };
      else if (request.method === 'eth_getCode') result = '0x6000';
      else if (request.method === 'eth_call') {
        const call = request.params[0] as { to: string; data: string };
        assert.equal(request.params[1], '0x10');
        const selector = call.data.slice(0, 10);
        result = selector === '0x313ce567' ? uint(failToken ? 18 : 6)
          : selector === '0x01ffc9a7' ? uint(1)
          : selector === '0x4e1273f4' ? abi.encodeFunctionResult('balanceOfBatch', [[5]])
          : selector === '0x00fdd58e' ? uint(0)
          : uint(call.to === collectionAddress ? 3 : 1234567);
      } else assert.fail('No discovery or transaction RPC is permitted');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
    },
  });
  const check = () => { if (!current) throw Error('Changed visible scope'); };
  return { read: () => read(scope, new AbortController().signal, check), requests, urls, loads,
    invalidateOnFetch() { invalidateOnFetch = true; }, failToken() { failToken = true; } };
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
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]!.method, 'eth_chainId');
});
