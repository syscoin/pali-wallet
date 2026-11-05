import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { createErc20Reader } from '../src/portfolio/erc20ReadRpc.ts';
import { createNftOwnershipReader } from '../src/portfolio/nftOwnershipReadRpc.ts';

const owner = '0x52908400098527886E0F7030069857D2E4169EE7';
const other = '0x0000000000000000000000000000000000000002';
const target = '0x0000000000000000000000000000000000000721';
const tokenId = ((1n << 256n) - 1n).toString();
const registration = {
  id: 'fixture-evm',
  name: 'Selected EVM',
  kind: 'evm',
  chainId: '1234',
  slip44: 60,
  rpcUrl: 'https://selected.invalid/rpc',
  symbol: 'TST',
  decimals: 18,
  testnet: true,
} as const;
const network = createNativeNetwork(registration);
const selection = {
  networkId: network.id,
  owner: owner.toLowerCase(),
  contractAddress: target,
  tokenStandard: 'ERC-721',
  tokenId,
} as const;
const abi = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  'error ERC721NonexistentToken(uint256)',
]);
const block = { number: '0x123', hash: '0x' + 'a'.repeat(64) };
const reverted = {
  code: 3,
  message: 'execution reverted',
  data: abi.encodeErrorResult('ERC721NonexistentToken', [42]),
};
type Wire = { jsonrpc: string; id: number; method: string; params: unknown[] };
type Envelope = Record<string, unknown>;
type Rewrite = (wire: Wire, reply: Envelope) => Envelope | Promise<Envelope>;

function fixture({
  rewrite = (_wire, reply) => reply,
  reportedOwner = owner,
  quantity = tokenId,
}: { rewrite?: Rewrite; reportedOwner?: string; quantity?: string } = {}) {
  let registrations: readonly ReturnType<typeof createNativeNetwork>[] = [
    network,
  ];
  const requests: { wire: Wire; url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const wire: Wire = JSON.parse(String(init.body));
    requests.push({ wire, url, init });
    const envelope = { jsonrpc: '2.0', id: wire.id };
    let reply: Envelope;
    switch (wire.method) {
      case 'eth_chainId':
        reply = { ...envelope, result: '0x4d2' };
        break;
      case 'eth_getBlockByNumber':
        reply = { ...envelope, result: block };
        break;
      case 'eth_getCode':
        assert.deepEqual(wire.params, [target, block.number]);
        reply = { ...envelope, result: '0x6000' };
        break;
      case 'eth_call': {
        const call = wire.params[0] as { to: string; data: string };
        assert.equal(wire.params[1], block.number);
        assert.deepEqual(Object.keys(call).sort(), ['data', 'to']);
        assert.equal(call.to, target);
        const { name, args } = abi.parseTransaction(call)!;
        if (name === 'ownerOf') {
          reply =
            args[0].toString() === tokenId
              ? {
                  ...envelope,
                  result: abi.encodeFunctionResult(name, [reportedOwner]),
                }
              : { ...envelope, error: reverted };
        } else if (name === 'balanceOf') {
          assert.equal(args[0], owner);
          assert.notEqual(args[1].toString(), tokenId);
          reply = { ...envelope, result: abi.encodeFunctionResult(name, [0]) };
        } else {
          assert.equal(args[0].length, 1);
          assert.equal(args[0][0], owner);
          assert.equal(args[1].length, 1);
          assert.equal(args[1][0].toString(), tokenId);
          reply = {
            ...envelope,
            result: abi.encodeFunctionResult(name, [[quantity]]),
          };
        }
        break;
      }
      default:
        assert.fail('Unowned RPC method');
    }
    return new Response(JSON.stringify(await rewrite(wire, reply)), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const read = createNftOwnershipReader({
    fetch,
    registrations: () => registrations,
  });
  return {
    read,
    requests,
    setRegistrations: (next: typeof registrations) => {
      registrations = next;
    },
  };
}
const signal = () => new AbortController().signal;
const current = () => undefined;

test('selected ERC721 uses the registered endpoint and one block for exact probe and ownership', async () => {
  const { read, requests } = fixture();
  const observation = await read(selection, signal(), current);
  assert.deepEqual(observation, { tokenId, units: '1' });
  assert.equal(Object.isFrozen(observation), true);
  assert.deepEqual(
    requests.map(({ wire }) => wire.method),
    [
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_getCode',
      'eth_call',
      'eth_call',
      'eth_getBlockByNumber',
      'eth_chainId',
    ]
  );
  assert.deepEqual(requests[1]!.wire.params, ['latest', false]);
  assert.deepEqual(requests[5]!.wire.params, [block.number, false]);
  assert.equal(
    new Set(requests.map(({ wire }) => wire.id)).size,
    requests.length
  );
  for (const { url, init } of requests) {
    assert.equal(url, network.rpcUrl);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
  }
});

test('successful different ERC721 owner and exact ERC1155 amounts retain their meaning', async () => {
  assert.deepEqual(
    await fixture({ reportedOwner: other }).read(selection, signal(), current),
    { tokenId, units: '0' }
  );
  for (const quantity of ['0', tokenId]) {
    const { read, requests } = fixture({ quantity });
    assert.deepEqual(
      await read(
        {
          ...selection,
          tokenStandard: 'ERC-1155',
          tokenId: '0x' + 'f'.repeat(64),
        },
        signal(),
        current
      ),
      { tokenId, units: quantity }
    );
    assert.equal(
      requests.filter(({ wire }) => wire.method === 'eth_call').length,
      2
    );
  }
});

test('a zero ERC721 owner leaves selected ownership unavailable', async () => {
  const { read, requests } = fixture({
    reportedOwner: '0x0000000000000000000000000000000000000000',
  });
  await assert.rejects(read(selection, signal(), current), {
    code: 'UNAVAILABLE',
  });
  assert.equal(
    requests.filter(({ wire }) => wire.method === 'eth_call').length,
    2
  );
});

test('unvetted probe errors, result/error mixtures and mismatched IDs cannot trigger selected reads', async () => {
  const mutations: Rewrite[] = [
    (_wire, reply) => ({
      ...reply,
      error: { code: 3, message: 'execution reverted' },
    }),
    (_wire, reply) => ({
      ...reply,
      error: { ...reverted, message: 'RPC unavailable' },
    }),
    (_wire, reply) => ({ ...reply, error: { ...reverted, data: '0x123' } }),
    (_wire, reply) => ({
      ...reply,
      error: { ...reverted, data: '0x08c379a0' },
    }),
    (_wire, reply) => ({
      ...reply,
      error: { ...reverted, data: '0x' + 'aa'.repeat(4100) },
    }),
    (_wire, reply) => ({ ...reply, result: '0x' }),
    (wire) => ({ jsonrpc: '2.0', id: wire.id, result: '0x' }),
    (wire, reply) => ({ ...reply, id: wire.id + 1 }),
    () => {
      throw new Error('Synthetic transport failure');
    },
  ];
  for (const mutate of mutations) {
    const { read, requests } = fixture({
      rewrite: (wire, reply) =>
        wire.method === 'eth_call' ? mutate(wire, reply) : reply,
    });
    await assert.rejects(read(selection, signal(), current), {
      name: 'Erc20ReadError',
    });
    assert.equal(
      requests.filter(({ wire }) => wire.method === 'eth_call').length,
      1
    );
  }
});

test('malformed selected ERC1155 batch cannot fall back or publish a quantity', async () => {
  for (const corrupt of [
    '0x',
    abi.encodeFunctionResult('balanceOfBatch', [[]]),
  ]) {
    let calls = 0;
    const { read, requests } = fixture({
      rewrite: (wire, reply) =>
        wire.method === 'eth_call' && ++calls === 2
          ? { ...reply, result: corrupt }
          : reply,
    });
    await assert.rejects(
      read({ ...selection, tokenStandard: 'ERC-1155' }, signal(), current),
      { name: 'Erc20ReadError' }
    );
    assert.equal(
      requests.filter(({ wire }) => wire.method === 'eth_call').length,
      2
    );
  }
});

test('wrong initial or final chain, a reorg and missing contract code fail closed', async () => {
  for (const failure of ['first chain', 'last chain', 'reorg', 'no code']) {
    let chains = 0;
    const { read, requests } = fixture({
      rewrite(wire, reply) {
        if (
          wire.method === 'eth_chainId' &&
          ++chains === (failure === 'first chain' ? 1 : 2) &&
          failure.endsWith('chain')
        )
          return { ...reply, result: '0x1' };
        if (
          failure === 'reorg' &&
          wire.method === 'eth_getBlockByNumber' &&
          wire.params[0] !== 'latest'
        )
          return {
            ...reply,
            result: { ...block, hash: '0x' + 'b'.repeat(64) },
          };
        if (failure === 'no code' && wire.method === 'eth_getCode')
          return { ...reply, result: '0x' };
        return reply;
      },
    });
    await assert.rejects(read(selection, signal(), current), {
      code: failure.endsWith('chain') ? 'WRONG_CHAIN' : 'INVALID_RESPONSE',
    });
    if (failure === 'first chain' || failure === 'no code')
      assert.equal(
        requests.some(({ wire }) => wire.method === 'eth_call'),
        false
      );
  }
});

test('late response after account A-B-A, registration replacement or abort is discarded', async () => {
  for (const failure of ['account A-B-A', 'registration', 'abort']) {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const controller = new AbortController();
    let revision = 0;
    const { read, requests, setRegistrations } = fixture({
      async rewrite(wire, reply) {
        if (wire.method === 'eth_call') {
          started.resolve();
          await release.promise;
        }
        return reply;
      },
    });
    const selected = { ...selection };
    const pending = read(selected, controller.signal, () => {
      if (revision !== 0) throw new Error('Old owner');
    });
    await started.promise;
    if (failure === 'account A-B-A') {
      selected.owner = other;
      revision++;
      selected.owner = selection.owner;
      revision++;
    } else if (failure === 'registration')
      setRegistrations([
        createNativeNetwork({
          ...registration,
          rpcUrl: 'https://replacement.invalid/rpc',
        }),
      ]);
    else controller.abort();
    release.resolve();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(
      requests.filter(({ wire }) => wire.method === 'eth_call').length,
      1
    );
    assert.ok(requests.every(({ url }) => url === network.rpcUrl));
  }
});

test('invalid selection, async guard or unavailable registrations disclose no owner', async () => {
  const { read, requests, setRegistrations } = fixture();
  await assert.rejects(
    read({ ...selection, tokenId: '-1' }, signal(), current),
    { code: 'INVALID_INPUT' }
  );
  await assert.rejects(
    read(selection, signal(), async () => {
      throw new Error('Async guard');
    }),
    { code: 'CANCELLED' }
  );
  setRegistrations([]);
  await assert.rejects(read(selection, signal(), current), {
    code: 'INVALID_INPUT',
  });
  assert.deepEqual(requests, []);
});

test('ordinary ERC20 readers still reject an otherwise recognized RPC revert', async () => {
  const reader = createErc20Reader({
    registrations: () => [network],
    fetch: async (_url, init) => {
      const wire: Wire = JSON.parse(String(init.body));
      const base = { jsonrpc: '2.0', id: wire.id };
      return Response.json(
        wire.method === 'eth_call'
          ? { ...base, error: reverted }
          : {
              ...base,
              result: wire.method === 'eth_chainId' ? '0x4d2' : block,
            }
      );
    },
  });
  await assert.rejects(
    reader.readBalance(
      network.id,
      owner,
      {
        contractAddress: target,
        name: 'Fixture',
        symbol: 'FIX',
        decimals: 18,
      },
      signal()
    ),
    { code: 'INVALID_RESPONSE' }
  );
});
