import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createOwnedTokenReader } from '../src/portfolio/ownedTokenReader.ts';

const address = '0x1111111111111111111111111111111111111111';
const contract = (id: number) => `0x${id.toString(16).padStart(40, '0')}`;
const routescan =
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const scope = { apiUrl: routescan, address, chainId: 1 };
const current = () => undefined;
const token = {
  chainId: 1,
  tokenAddress: contract(1),
  tokenName: 'Public fixture',
  tokenSymbol: 'FIX',
  tokenDecimals: '255',
  tokenQuantity: '9007199254740993',
};

test('registered Routescan request keeps provider cursors on the captured chain and returns only safe suggestions', async () => {
  const requests: URL[] = [];
  const reader = createOwnedTokenReader(async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('apikey'), 'example');
    requests.push(new URL(url));
    if (requests.length === 1)
      return Response.json({
        items: [token, { ...token, tokenAddress: contract(2), chainId: 2 }],
        link: {
          next: 'https://untrusted.invalid/ignored',
          nextToken: 'a/b?test=1',
        },
      });
    return Response.json({
      items: [
        token,
        { ...token, tokenAddress: contract(3), tokenQuantity: '0' },
      ],
    });
  });
  assert.deepEqual(
    await reader(
      { ...scope, apiUrl: `${routescan}?apiKey=example` },
      new Set(),
      new AbortController().signal,
      current
    ),
    {
      tokens: [
        { contractAddress: contract(1), name: 'Public fixture', symbol: 'FIX' },
      ],
      limited: false,
    }
  );
  assert.equal(requests.length, 2);
  for (const url of requests) {
    assert.equal(url.origin, 'https://api.routescan.io');
    assert.equal(
      url.pathname,
      `/v2/network/mainnet/evm/1/address/${address}/erc20-holdings`
    );
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.has('apiKey'), false);
  }
  assert.equal(requests[0]?.searchParams.has('next'), false);
  assert.equal(requests[1]?.searchParams.get('next'), 'a/b?test=1');
});

test('collectibles reuse the registered holdings reader without ERC20 or media requests', async () => {
  const requests: string[] = [];
  const reader = createOwnedTokenReader(async (url, init) => {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer');
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, 'https://api.routescan.io');
    const type = endpoint.pathname.split('/').at(-1);
    requests.push(type!);
    const item = {
      chainId: 1,
      tokenAddress: contract(1),
      collectionName: 'Paper foxes',
      image: 'https://untrusted.invalid/pixel',
    };
    if (type === 'erc721-holdings')
      return Response.json({
        items: [
          { ...item, tokenId: '7' },
          { ...item, tokenId: '0007' },
          { ...item, tokenId: (1n << 256n).toString() },
          { ...item, chainId: 2, tokenId: '9' },
        ],
      });
    assert.equal(type, 'erc1155-holdings');
    return Response.json({
      items: [
        {
          ...item,
          tokenAddress: contract(2),
          tokenId: '0',
          balance: '900719925474099312345',
        },
        { ...item, tokenAddress: contract(2), tokenId: '9', balance: '0' },
      ],
    });
  });
  const result = await reader(
    { ...scope, collectiblesOnly: true },
    new Set(),
    new AbortController().signal,
    current
  );
  assert.deepEqual(requests, ['erc721-holdings', 'erc1155-holdings']);
  assert.deepEqual(result.tokens, []);
  assert.deepEqual(result.collectibles, [
    {
      contractAddress: contract(2),
      name: 'NFT Collection',
      tokenStandard: 'ERC-1155',
      tokenId: '0',
      units: '900719925474099312345',
    },
    {
      contractAddress: contract(1),
      name: 'Paper foxes',
      tokenStandard: 'ERC-721',
      tokenId: undefined,
      units: '1',
    },
  ]);
  assert.equal(result.limited, false);
});

test('untyped explorer quantities cannot be coerced into collectible counts', async () => {
  const apiUrl = 'https://explorer.invalid/api';
  const reader = createOwnedTokenReader(async (url) => {
    assert.equal(new URL(url).origin, new URL(apiUrl).origin);
    return Response.json({
      status: '1',
      result: [
        true,
        [1],
        '1e2',
        '1.00000000000000001',
        Number.MAX_SAFE_INTEGER + 1,
        '3',
      ].map((balance, index) => ({
        contractAddress: contract(index + 1),
        type: 'ERC-721',
        balance,
      })),
    });
  });
  const result = await reader(
    { ...scope, apiUrl, collectiblesOnly: true },
    new Set(),
    new AbortController().signal,
    current
  );
  assert.deepEqual(
    result.collectibles?.map(({ contractAddress, units }) => [
      contractAddress,
      units,
    ]),
    [[contract(6), '3']]
  );
});

for (const cursor of [false, 0]) {
  test(`an owned Routescan lookup rejects a ${cursor} cursor instead of returning partial results`, async () => {
    let requests = 0;
    const reader = createOwnedTokenReader(async () => {
      requests++;
      return Response.json({ items: [token], link: { nextToken: cursor } });
    });
    await assert.rejects(
      reader(scope, new Set(), new AbortController().signal, current),
      /pagination limit/
    );
    assert.equal(requests, 1);
  });
}

test('Blockscout uses the shared tokenlist URL and excludes saved, malformed, NFT and excess suggestions', async () => {
  let requests = 0;
  const row = { name: 'Fixture', symbol: 'T', decimals: '0', balance: '1' };
  const reader = createOwnedTokenReader(async (url) => {
    requests++;
    assert.equal(
      url,
      `https://explorer.invalid/custom?chainid=1&apikey=example&module=account&action=tokenlist&address=${address}`
    );
    return Response.json({
      status: '1',
      result: [
        { ...row, contractAddress: contract(1), type: 'ERC-721' },
        { ...row, contractAddress: contract(2), name: 'Fake\u202E' },
        { ...row, contractAddress: contract(3), decimals: '256' },
        { ...row, contractAddress: contract(4), balance: 9007199254740992 },
        { ...row, contractAddress: contract(5), balance: '0' },
        ...Array.from({ length: 22 }, (_, i) => ({
          ...row,
          contractAddress: contract(i + 6),
        })),
      ],
    });
  });
  const options = {
    ...scope,
    apiUrl: 'https://explorer.invalid/custom?chainid=1&apiKey=example',
  };
  const saved = new Set([contract(6)]);
  const signal = new AbortController().signal;
  const result = await reader(options, saved, signal, current);
  assert.equal(result.tokens.length, 20);
  assert.equal(result.tokens[0]?.contractAddress, contract(7));
  assert.equal(result.limited, true);
  await reader(options, saved, signal, current);
  assert.equal(
    requests,
    2,
    'native lookups do not share the extension promise cache'
  );
});

test('size, origin and chain failures cannot yield partial holdings or follow another URL', async () => {
  let requests = 0;
  const reader = createOwnedTokenReader(async () => {
    requests++;
    return Response.json({
      items: [token],
      link: { nextToken: String(requests) },
      padding: 'x'.repeat(180 * 1024),
    });
  });
  await assert.rejects(
    reader(
      { ...scope, chainId: 2 },
      new Set(),
      new AbortController().signal,
      current
    ),
    /does not match network/
  );
  assert.equal(requests, 0);
  await assert.rejects(
    reader(scope, new Set(), new AbortController().signal, current),
    /size limit/
  );
  assert.equal(
    requests,
    3,
    'aggregate limit stops pagination before a fourth request'
  );

  const apiUrl = 'https://explorer.invalid/api';
  const redirected = createOwnedTokenReader(async () => {
    const result = Response.json({ status: '0', message: 'No tokens found' });
    Object.defineProperty(result, 'url', {
      value: 'https://untrusted.invalid/api',
    });
    return result;
  });
  await assert.rejects(
    redirected(
      { ...scope, apiUrl },
      new Set(),
      new AbortController().signal,
      current
    ),
    /API changed/
  );
  const tooLarge = createOwnedTokenReader(
    async () => new Response('', { headers: { 'content-length': '262145' } })
  );
  await assert.rejects(
    tooLarge(
      { ...scope, apiUrl },
      new Set(),
      new AbortController().signal,
      current
    ),
    /size limit/
  );
});

test('a cancelled Routescan fetch releases the pacing queue even if its transport never settles', async () => {
  let requests = 0;
  const started = Promise.withResolvers<void>();
  const reader = createOwnedTokenReader(async () => {
    if (++requests === 1) {
      started.resolve();
      return new Promise<Response>(() => undefined);
    }
    return Response.json({ items: [] });
  });
  const abort = new AbortController();
  const pending = reader(scope, new Set(), abort.signal, current);
  await started.promise;
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(
    await reader(scope, new Set(), new AbortController().signal, current),
    { tokens: [], limited: false }
  );
  assert.equal(requests, 2);
});

test('pacing checks the captured scope again before dispatching a queued request', async () => {
  let requests = 0;
  const reader = createOwnedTokenReader(async () => {
    requests++;
    return Response.json({ items: [] });
  });
  const signal = new AbortController().signal;
  await reader(scope, new Set(), signal, current);
  let live = true;
  const queued = reader(scope, new Set(), signal, () => {
    if (!live) throw new Error('Stale account');
  });
  const rejected = assert.rejects(queued, /Stale account/);
  await setImmediate();
  live = false;
  await rejected;
  assert.equal(requests, 1);
});
