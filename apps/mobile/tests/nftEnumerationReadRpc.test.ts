import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { MAX_ENUMERATED_NFTS } from '../../../source/shared/nftReads.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { createNftEnumerationReader } from '../src/portfolio/nftOwnershipReadRpc.ts';

const owner = '0x1111111111111111111111111111111111111111';
const contractAddress = '0x2222222222222222222222222222222222222222';
const maximum = (2n ** 256n - 1n).toString();
const network = createNativeNetwork({ id: 'enumeration-fixture', kind: 'evm', name: 'Enumeration fixture',
  chainId: '1234', slip44: 60, rpcUrl: 'https://enumeration.invalid/rpc', symbol: 'TST', decimals: 18, testnet: true });
const selection = { networkId: network.id, owner, contractAddress, tokenStandard: 'ERC-721' as const };
const block = { number: '0x123', hash: '0x' + 'a'.repeat(64) };
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
]);
type Wire = { id: number; method: string; params: unknown[] };
type Rewrite = (wire: Wire, reply: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;

function fixture({ enumerable = true, balance = maximum, rewrite = (_wire, reply) => reply }: {
  enumerable?: boolean; balance?: string; rewrite?: Rewrite;
} = {}) {
  let registrations = [network], active = 0, maximumActive = 0;
  const requests: { wire: Wire; url: string; init: RequestInit }[] = [];
  const read = createNftEnumerationReader({ registrations: () => registrations,
    async fetch(url, init) {
      const wire: Wire = JSON.parse(String(init.body));
      requests.push({ wire, url, init });
      maximumActive = Math.max(maximumActive, ++active);
      try {
        let result: unknown;
        if (wire.method === 'eth_chainId') result = '0x4d2';
        else if (wire.method === 'eth_getBlockByNumber') result = block;
        else if (wire.method === 'eth_getCode') {
          assert.deepEqual(wire.params, [contractAddress, block.number]); result = '0x6000';
        } else {
          assert.equal(wire.method, 'eth_call');
          const call = wire.params[0] as { to: string; data: string };
          assert.equal(call.to, contractAddress);
          assert.equal(wire.params[1], block.number);
          const { name, args } = abi.parseTransaction(call)!;
          if (name === 'supportsInterface') {
            assert.equal(args[0], '0x780e9d63'); result = abi.encodeFunctionResult(name, [enumerable]);
          } else if (name === 'balanceOf') {
            assert.equal(args[0], owner); result = abi.encodeFunctionResult(name, [balance]);
          } else {
            assert.equal(name, 'tokenOfOwnerByIndex'); assert.equal(args[0], owner);
            assert(args[1] < BigInt(MAX_ENUMERATED_NFTS));
            result = abi.encodeFunctionResult(name, [args[1] === 0n ? '0' : args[1] === 1n ? maximum : args[1]]);
          }
        }
        return Response.json(await rewrite(wire, { jsonrpc: '2.0', id: wire.id, result }));
      } finally { active--; }
    },
  });
  return { read, requests, maximumActive: () => maximumActive,
    replaceNetwork() { registrations = [createNativeNetwork({ ...network, rpcUrl: 'https://changed.invalid/rpc' })]; } };
}

test('enumeration uses the selected RPC and one block, caps ten IDs, and returns no ownership authority', async () => {
  const f = fixture();
  const result = await f.read(selection, new AbortController().signal, () => undefined);
  assert.deepEqual(result, { tokenIds: ['0', maximum, '2', '3', '4', '5', '6', '7', '8', '9'], totalOwned: maximum, hasMore: true, method: 'enumeration' });
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.tokenIds));
  assert.equal(f.requests.filter(({ wire }) => wire.method === 'eth_call').length, 12);
  assert(f.maximumActive() <= 4);
  assert.equal(f.requests.length, 17);
  for (const { url, init } of f.requests) {
    assert.equal(url, network.rpcUrl); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
  }
  assert.deepEqual(f.requests.at(-2)!.wire.params, [block.number, false]);
  assert.equal(f.requests.at(-1)!.wire.method, 'eth_chainId');
});

test('non-enumerable, empty and failed enumeration retain manual entry without fabricated IDs', async () => {
  const unsupported = fixture({ enumerable: false });
  assert.deepEqual(await unsupported.read(selection, new AbortController().signal, () => undefined),
    { tokenIds: [], totalOwned: maximum, hasMore: false, method: 'manual' });
  assert.equal(unsupported.requests.filter(({ wire }) => wire.method === 'eth_call').length, 2);
  const empty = fixture({ balance: '0' });
  assert.deepEqual(await empty.read(selection, new AbortController().signal, () => undefined),
    { tokenIds: [], totalOwned: '0', hasMore: false, method: 'enumeration' });
  const failed = fixture({ rewrite(wire, reply) {
    if (wire.method === 'eth_call' && abi.parseTransaction(wire.params[0] as { data: string })?.name === 'tokenOfOwnerByIndex')
      return { jsonrpc: '2.0', id: wire.id, error: { code: -32000, message: 'Network unavailable' } };
    return reply;
  } });
  assert.deepEqual(await failed.read(selection, new AbortController().signal, () => undefined),
    { tokenIds: [], totalOwned: maximum, hasMore: false, method: 'manual' });
});

test('an unavailable collection balance remains absent rather than becoming zero', async () => {
  const f = fixture({ rewrite(wire, reply) {
    if (wire.method === 'eth_call' && abi.parseTransaction(wire.params[0] as { data: string })?.name === 'balanceOf')
      return { jsonrpc: '2.0', id: wire.id, error: { code: -32000, message: 'Network unavailable' } };
    return reply;
  } });
  const result = await f.read(selection, new AbortController().signal, () => undefined);
  assert.deepEqual(result, { tokenIds: [], hasMore: false, method: 'manual' });
  assert(!Object.hasOwn(result, 'totalOwned'));
});

test('wrong chain and a changed anchor reject enumeration instead of returning suggestions', async () => {
  for (const failure of ['chain', 'anchor']) {
    const f = fixture({ balance: '1', rewrite(wire, reply) {
      if (failure === 'chain' && wire.method === 'eth_chainId') return { ...reply, result: '0x1' };
      if (failure === 'anchor' && wire.method === 'eth_getBlockByNumber' && wire.params[0] !== 'latest')
        return { ...reply, result: { ...block, hash: '0x' + 'b'.repeat(64) } };
      return reply;
    } });
    await assert.rejects(f.read(selection, new AbortController().signal, () => undefined),
      { code: failure === 'chain' ? 'WRONG_CHAIN' : 'INVALID_RESPONSE' });
  }
});

test('aborted, changed-account and replaced-network enumeration cannot release late IDs', async () => {
  for (const change of ['abort', 'account', 'network']) {
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const request = new AbortController(); let current = true;
    const f = fixture({ rewrite: async (wire, reply) => {
      if (wire.method === 'eth_call') { started.resolve(); await release.promise; }
      return reply;
    } });
    const pending = f.read(selection, request.signal, () => { if (!current) throw Error('Changed'); });
    await started.promise;
    if (change === 'abort') request.abort();
    else if (change === 'account') current = false;
    else f.replaceNetwork();
    release.resolve();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(f.requests.filter(({ wire }) => wire.method === 'eth_call').length, 1);
  }
});

test('enumeration rejects unsupported selection and asynchronous guards before disclosing the owner', async () => {
  const f = fixture();
  await assert.rejects(f.read({ ...selection, tokenStandard: 'ERC-1155' as never }, new AbortController().signal, () => undefined), { code: 'INVALID_INPUT' });
  await assert.rejects(f.read(selection, new AbortController().signal, async () => {}), { code: 'CANCELLED' });
  assert.deepEqual(f.requests, []);
});

test('one deadline cancels enumeration even when the transport ignores its signal', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = fixture({ rewrite: async (wire, reply) => {
    if (wire.method === 'eth_call') { started.resolve(); await release.promise; }
    return reply;
  } });
  try {
    const pending = f.read(selection, new AbortController().signal, () => undefined);
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    await started.promise;
    context.mock.timers.tick(12_000);
    await rejected;
    assert(f.requests.every(({ init }) => init.signal?.aborted));
    assert.equal(f.requests.filter(({ wire }) => wire.method === 'eth_call').length, 1);
  } finally { release.resolve(); context.mock.timers.reset(); }
});
