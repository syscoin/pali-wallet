import assert from 'node:assert/strict';
import test from 'node:test';
import { createErc20Reader } from '../src/portfolio/erc20ReadRpc.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { EvmNetworkId } from '../src/custody/networkContext.ts';

const holder = '0x52908400098527886E0F7030069857D2E4169EE7';
const contractAddress = '0x1111111111111111111111111111111111111111';
const metadata = {
  contractAddress,
  name: 'Example token',
  symbol: 'EXAMPLE',
  decimals: 18,
};
type Request = { jsonrpc: string; id: number; method: string; params: any[] };
const uint = (value: bigint | number) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const abiText = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return (
    uint(32) +
    uint(bytes.length).slice(2) +
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .padEnd(Math.ceil(bytes.length / 32) * 64, '0')
  );
};
const json = (id: number, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json' },
  });
function result(request: Request): unknown {
  if (request.method === 'eth_chainId') return '0x1';
  if (request.method === 'eth_getBlockByNumber')
    return { number: '0x123', hash: '0x' + 'a'.repeat(64) };
  if (request.method === 'eth_getCode') return '0x6000';
  const selector = request.params[0].data.slice(0, 10);
  return selector === '0x06fdde03'
    ? abiText(metadata.name)
    : selector === '0x95d89b41'
    ? abiText(metadata.symbol)
    : selector === '0x313ce567'
    ? uint(18)
    : uint((1n << 256n) - 1n);
}
function readerWith(rewrite?: (request: Request) => unknown) {
  const requests: { request: Request; init: RequestInit; url: string }[] = [];
  const reader = createErc20Reader({
    fetch: async (url, init) => {
      const request = JSON.parse(String(init.body)) as Request;
      requests.push({ request, init, url });
      return json(request.id, rewrite ? rewrite(request) : result(request));
    },
  });
  return { reader, requests };
}
test('import verifies chain first, sends only bounded read calls and uses one observed block', async () => {
  const { reader, requests } = readerWith();
  const actual = await reader.readToken(
    'ethereum',
    holder.toLowerCase(),
    contractAddress,
    new AbortController().signal
  );
  assert.deepEqual(actual, { metadata, units: ((1n << 256n) - 1n).toString() });
  assert.equal(Object.isFrozen(actual), true);
  assert.deepEqual(
    requests.map(({ request }) => request.method),
    [
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_getCode',
      'eth_call',
      'eth_call',
      'eth_call',
      'eth_call',
      'eth_getBlockByNumber',
      'eth_chainId',
    ]
  );
  assert.deepEqual(requests[0]!.request.params, []);
  assert.deepEqual(requests[2]!.request.params, [contractAddress, '0x123']);
  const ids = new Set<number>();
  for (const { request, init, url } of requests) {
    ids.add(request.id);
    assert.equal(url, getNativeNetwork('ethereum').rpcUrl);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    if (request.method === 'eth_call') assert.equal(request.params[1], '0x123');
  }
  assert.equal(ids.size, 9);
  assert.equal(
    requests[6]!.request.params[0].data,
    `0x70a08231${holder.slice(2).toLowerCase().padStart(64, '0')}`
  );
});
test('balance refresh preserves known zero and verifies stored precision without metadata fallback', async () => {
  const { reader, requests } = readerWith((request) =>
    request.method === 'eth_call' &&
    request.params[0].data.startsWith('0x70a08231')
      ? uint(0)
      : result(request)
  );
  assert.deepEqual(
    await reader.readBalance(
      'ethereum',
      holder,
      metadata,
      new AbortController().signal
    ),
    { units: '0' }
  );
  assert.equal(requests.length, 6);
  const changed = readerWith((request) =>
    request.method === 'eth_call' && request.params[0].data === '0x313ce567'
      ? uint(6)
      : result(request)
  );
  await assert.rejects(
    changed.reader.readBalance(
      'ethereum',
      holder,
      metadata,
      new AbortController().signal
    ),
    { code: 'CHANGED_PRECISION' }
  );
});
test('a changed final chain, block number or block hash invalidates the entire observation', async () => {
  for (const change of ['chain', 'number', 'hash']) {
    let chains = 0;
    let blocks = 0;
    const { reader } = readerWith((request) => {
      if (
        request.method === 'eth_chainId' &&
        ++chains > 1 &&
        change === 'chain'
      )
        return '0x2';
      if (request.method === 'eth_getBlockByNumber' && ++blocks > 1) {
        if (change === 'number')
          return { number: '0x124', hash: '0x' + 'a'.repeat(64) };
        if (change === 'hash')
          return { number: '0x123', hash: '0x' + 'b'.repeat(64) };
      }
      return result(request);
    });
    await assert.rejects(
      reader.readToken(
        'ethereum',
        holder,
        contractAddress,
        new AbortController().signal
      ),
      { code: change === 'chain' ? 'WRONG_CHAIN' : 'INVALID_RESPONSE' }
    );
  }
});
test('wrong chain stops before account disclosure and every supported selected network uses its own registration', async () => {
  const wrong = readerWith((request) =>
    request.method === 'eth_chainId' ? '0x2' : result(request)
  );
  await assert.rejects(
    wrong.reader.readToken(
      'ethereum',
      holder,
      contractAddress,
      new AbortController().signal
    ),
    { code: 'WRONG_CHAIN' }
  );
  assert.equal(wrong.requests.length, 1);
  for (const id of [
    'base',
    'rollux',
    'syscoin-nevm-testnet',
  ] as EvmNetworkId[]) {
    const network = getNativeNetwork(id);
    const seen: string[] = [];
    const reader = createErc20Reader({
      fetch: async (url, init) => {
        seen.push(url);
        const request = JSON.parse(String(init.body)) as Request;
        return json(
          request.id,
          request.method === 'eth_chainId'
            ? `0x${BigInt(network.chainId).toString(16)}`
            : result(request)
        );
      },
    });
    await reader.readBalance(
      id,
      holder,
      metadata,
      new AbortController().signal
    );
    assert.deepEqual(new Set(seen), new Set([network.rpcUrl]));
  }
});
test('hostile ABI offsets, lengths, padding, strings, units and non-contracts fail without exposing error text', async () => {
  const badNames = [
    uint(64) + abiText('x').slice(66),
    uint(32) + uint((1n << 256n) - 1n).slice(2),
    abiText('x').slice(0, -1) + '1',
    abiText('x\u202e'),
    abiText('x'.repeat(129)),
    uint(32) + uint(1).slice(2) + 'ff'.padEnd(64, '0'),
    '0x' + '0'.repeat(16384),
  ];
  for (const bad of badNames) {
    const { reader } = readerWith((request) =>
      request.method === 'eth_call' && request.params[0].data === '0x06fdde03'
        ? bad
        : result(request)
    );
    await assert.rejects(
      reader.readToken(
        'ethereum',
        holder,
        contractAddress,
        new AbortController().signal
      ),
      { code: 'INVALID_RESPONSE' }
    );
  }
  for (const bad of ['0x', '0x0', '0x123', '0x' + 'ff'.repeat(32769)]) {
    const { reader } = readerWith((request) =>
      request.method === 'eth_getCode' ? bad : result(request)
    );
    await assert.rejects(
      reader.readToken(
        'ethereum',
        holder,
        contractAddress,
        new AbortController().signal
      )
    );
  }
  for (const bad of [uint(256), '0x12', uint(18) + '00']) {
    const { reader } = readerWith((request) =>
      request.method === 'eth_call' && request.params[0].data === '0x313ce567'
        ? bad
        : result(request)
    );
    await assert.rejects(
      reader.readToken(
        'ethereum',
        holder,
        contractAddress,
        new AbortController().signal
      ),
      { code: 'INVALID_RESPONSE' }
    );
  }
});
test('transport rejects mismatched ids, error responses, arrays, invalid content and oversized bodies', async () => {
  const factories = [
    (id: number) => json(id + 1, '0x1'),
    (id: number) =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: '0x1',
          error: { message: 'PRIVATE_RPC_ERROR' },
        })
      ),
    (id: number) =>
      new Response(JSON.stringify([{ jsonrpc: '2.0', id, result: '0x1' }])),
    () =>
      new Response('<html>PRIVATE_RPC_ERROR</html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    () => new Response(' '.repeat(16 * 1024 + 1)),
  ];
  for (const factory of factories) {
    const reader = createErc20Reader({
      fetch: async (_, init) => factory(JSON.parse(String(init.body)).id),
    });
    await assert.rejects(
      reader.readToken(
        'ethereum',
        holder,
        contractAddress,
        new AbortController().signal
      ),
      (error: Error) => !error.message.includes('PRIVATE_RPC_ERROR')
    );
  }
});
test('cancellation settles ignored transport and one deadline bounds the complete operation', async () => {
  let calls = 0;
  const reader = createErc20Reader({
    fetch: async () => {
      calls++;
      return new Promise(() => undefined);
    },
  });
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    reader.readToken('ethereum', holder, contractAddress, stopped.signal),
    { code: 'CANCELLED' }
  );
  assert.equal(calls, 0);
  const signal = new AbortController();
  const pending = reader.readToken(
    'ethereum',
    holder,
    contractAddress,
    signal.signal
  );
  await Promise.resolve();
  signal.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(calls, 1);
  const timeout = createErc20Reader({
    timeoutMs: 5,
    fetch: async () => new Promise(() => undefined),
  });
  await assert.rejects(
    timeout.readBalance(
      'ethereum',
      holder,
      metadata,
      new AbortController().signal
    ),
    { code: 'CANCELLED' }
  );
  assert.throws(() => createErc20Reader({ timeoutMs: 0 }));
  assert.throws(() => createErc20Reader({ timeoutMs: 30001 }));
});
test('ABI reads fan out to at most four calls and late successful transport after abort cannot return an observation', async () => {
  let active = 0;
  let maximum = 0;
  const reader = createErc20Reader({
    fetch: async (_, init) => {
      const request = JSON.parse(String(init.body)) as Request;
      active++;
      maximum = Math.max(active, maximum);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return json(request.id, result(request));
    },
  });
  await reader.readToken(
    'ethereum',
    holder,
    contractAddress,
    new AbortController().signal
  );
  assert.equal(maximum, 4);
  maximum = 0;
  await Promise.all(
    Array.from({ length: 3 }, () =>
      reader.readToken(
        'ethereum',
        holder,
        contractAddress,
        new AbortController().signal
      )
    )
  );
  assert.equal(maximum, 4);
  let release!: (value: Response) => void;
  const lateReader = createErc20Reader({
    fetch: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const controller = new AbortController();
  const pending = lateReader.readToken(
    'ethereum',
    holder,
    contractAddress,
    controller.signal
  );
  await Promise.resolve();
  controller.abort();
  release(json(1, '0x1'));
  await assert.rejects(pending, { code: 'CANCELLED' });
});
