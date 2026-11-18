import { PALI_INFRASTRUCTURE_BY_ID } from '../../../source/utils/smartAccount/deployment.ts';
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
const abiBytes32 = (value: string) =>
  `0x${Buffer.from(value, 'utf8').toString('hex').padEnd(64, '0')}`;
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
  let posts = 0;
  const reader = createErc20Reader({
    fetch: async (url, init) => {
      posts++;
      const body = JSON.parse(String(init.body)) as Request | Request[];
      const rows = Array.isArray(body) ? body : [body];
      const responses = rows.map(request => {
        requests.push({ request, init, url });
        return { jsonrpc: '2.0', id: request.id, result: rewrite ? rewrite(request) : result(request) };
      });
      return Response.json(Array.isArray(body) ? responses : responses[0]);
    },
  });
  return { reader, requests, posts: () => posts };
}

for (const legacy of ['name', 'symbol', 'both'] as const) {
  test(`import accepts bounded legacy bytes32 ${legacy} metadata at the existing read boundary`, async () => {
    const expected = { ...metadata, name: 'Maker', symbol: 'MKR' };
    const { reader, requests } = readerWith(request => {
      if (request.method !== 'eth_call') return result(request);
      const selector = request.params[0].data.slice(0, 10);
      if (selector === '0x06fdde03')
        return legacy === 'symbol' ? abiText(expected.name) : abiBytes32(expected.name);
      if (selector === '0x95d89b41')
        return legacy === 'name' ? abiText(expected.symbol) : abiBytes32(expected.symbol);
      return result(request);
    });
    assert.deepEqual(await reader.readToken('ethereum', holder, contractAddress, new AbortController().signal), {
      metadata: expected, units: ((1n << 256n) - 1n).toString(),
    });
    assert.equal(requests.filter(({ request }) => request.method === 'eth_call').length, 4);
  });
}

test('legacy bytes32 permits bounded full-width and UTF-8 metadata with no alternate RPCs', async () => {
  for (const text of ['N'.repeat(32), '雪MKR']) {
    const { reader, requests } = readerWith(request =>
      request.method === 'eth_call' && ['0x06fdde03', '0x95d89b41'].includes(request.params[0].data.slice(0, 10))
        ? abiBytes32(text) : result(request)
    );
    const actual = await reader.readToken('ethereum', holder, contractAddress, new AbortController().signal);
    assert.equal(actual.metadata.name, text);
    assert.equal(actual.metadata.symbol, text);
    assert.equal(requests.length, 9);
  }
});

test('legacy metadata rejects malformed size, padding, UTF-8 and invalid text for either field', async () => {
  const invalid = [
    '0x' + '00'.repeat(32),
    '0x' + 'ff'.repeat(32),
    '0x' + '610062'.padEnd(64, '0'),
    abiBytes32(' '),
    abiBytes32('MKR\u202e'),
    abiBytes32('MKR\u0001'),
    '0x' + '61'.repeat(31),
    '0x' + '61'.repeat(33),
  ];
  for (const selector of ['0x06fdde03', '0x95d89b41']) {
    for (const data of invalid) {
      const { reader } = readerWith(request =>
        request.method === 'eth_call' && request.params[0].data.slice(0, 10) === selector ? data : result(request)
      );
      await assert.rejects(reader.readToken('ethereum', holder, contractAddress, new AbortController().signal), { code: 'INVALID_RESPONSE' });
    }
  }
});
test('import verifies chain first and batches nine bounded reads into four envelopes at one block', async () => {
  const { reader, requests, posts } = readerWith();
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
  assert.equal(posts(), 4);
  assert.equal(
    requests[6]!.request.params[0].data,
    `0x70a08231${holder.slice(2).toLowerCase().padStart(64, '0')}`
  );
});
test('balance refresh preserves known zero and verifies stored precision without metadata fallback', async () => {
  const { reader, requests, posts } = readerWith((request) =>
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
  assert.equal(posts(), 3);
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
  assert.deepEqual(wrong.requests.map(({ request }) => request.method), [
    'eth_chainId', 'eth_getBlockByNumber',
  ]);
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
        const payload = JSON.parse(String(init.body)) as Request | Request[];
        const reply = (request: Request) => ({ jsonrpc: '2.0', id: request.id,
          result: request.method === 'eth_chainId' ? `0x${BigInt(network.chainId).toString(16)}` : result(request),
        });
        return Response.json(Array.isArray(payload) ? payload.map(reply) : reply(payload));
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
    const { reader, requests } = readerWith((request) =>
      request.method === 'eth_getCode' ? bad : result(request)
    );
    assert(!requests.some(({ request }) => request.method === 'eth_call'));
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
  while (calls === 0) await new Promise(resolve => setImmediate(resolve));
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
test('scalar-only ABI reads fan out to at most four calls and late success after abort cannot return an observation', async () => {
  let active = 0;
  let maximum = 0;
  const reader = createErc20Reader({
    fetch: async (_, init) => {
      const payload = JSON.parse(String(init.body)) as Request | Request[];
      if (Array.isArray(payload)) return Response.json({
        jsonrpc: '2.0', id: null,
        error: { code: -32600, message: 'Batch requests are not supported' },
      });
      const request = payload;
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
  while (!release) await new Promise<void>(resolve => setImmediate(resolve));
  controller.abort();
  release(json(1, '0x1'));
  await assert.rejects(pending, { code: 'CANCELLED' });
});

test('one rejected metadata batch member refuses import without repeating getters', async () => {
  const methods: string[] = [];
  const reader = createErc20Reader({
    fetch: async (_url, init) => {
      const payload = JSON.parse(String(init.body)) as Request | Request[];
      const reply = (request: Request) => {
        methods.push(request.method);
        if (request.method === 'eth_call' && request.params[0].data === '0x95d89b41')
          return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'reverted' } };
        return { jsonrpc: '2.0', id: request.id, result: result(request) };
      };
      return Response.json(Array.isArray(payload) ? payload.map(reply) : reply(payload));
    },
  });
  await assert.rejects(reader.readToken('ethereum', holder, contractAddress, new AbortController().signal));
  assert.equal(methods.filter(method => method === 'eth_call').length, 4);
  assert.equal(methods.filter(method => method === 'eth_chainId').length, 1);
});

test('twenty saved balances share one canonical envelope while preserving every precision check', async () => {
  const { reader, requests, posts } = readerWith();
  const tokens = Array.from({ length: 20 }, (_, index) => ({ ...metadata,
    contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}` }));
  const balances = await reader.readBalances!('ethereum', holder, tokens, new AbortController().signal);
  assert.equal(balances.length, tokens.length);
  assert(balances.every(balance => balance.status === 'available' && balance.units === ((1n << 256n) - 1n).toString()));
  assert.equal(requests.length, 46);
  assert.equal(posts(), 5);
  requests.length = 0;
  const beforeWarm = posts();
  await reader.readBalances!('ethereum', holder, tokens, new AbortController().signal);
  assert.equal(requests.length, 44);
  assert.equal(posts() - beforeWarm, 3);
  assert.equal(requests.filter(({ request }) => request.method === 'eth_chainId').length, 2);
  assert.equal(requests.filter(({ request }) => request.method === 'eth_getBlockByNumber').length, 2);
  assert(requests.filter(({ request }) => request.method === 'eth_call').every(({ request }) => request.params[1] === '0x123'));
});

test('saved balance groups isolate precision failures and reject a changed common anchor', async () => {
  const second = { ...metadata, contractAddress: '0x2222222222222222222222222222222222222222' };
  const partial = readerWith(request => request.method === 'eth_call' && request.params[0].to === second.contractAddress &&
    request.params[0].data === '0x313ce567' ? uint(6) : result(request));
  assert.deepEqual((await partial.reader.readBalances!('ethereum', holder, [metadata, second], new AbortController().signal)).map(value => value.status), ['available', 'error']);
  let blocks = 0;
  const reorg = readerWith(request => request.method === 'eth_getBlockByNumber' && ++blocks === 2 ?
    { number: '0x123', hash: '0x' + 'b'.repeat(64) } : result(request));
  await assert.rejects(reorg.reader.readBalances!('ethereum', holder, [metadata, second], new AbortController().signal), { code: 'INVALID_RESPONSE' });
});

test('verified Multicall3 serves twenty warm saved balances in five wire methods', async () => {
  const { Interface } = await import('ethers/abi');

  const creation = `0x${PALI_INFRASTRUCTURE_BY_ID.multicall3.deployCalldata!.slice(
    2 + 0x20 * 2
  )}`;
  const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
  const abi = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
  const requests: Request[] = [];
  let posts = 0;
  const reader = createErc20Reader({ fetch: async (_url, init) => {
    posts++;
    const body = JSON.parse(String(init.body));
    const rows = Array.isArray(body) ? body : [body];
    const responses = rows.map((request: Request) => {
      requests.push(request);
      let value = result(request);
      if (request.method === 'eth_getCode') value = runtime;
      if (request.method === 'eth_call' && request.params[0].data.startsWith(abi.getFunction('aggregate3')!.selector)) {
        const calls = abi.decodeFunctionData('aggregate3', request.params[0].data)[0];
        value = abi.encodeFunctionResult('aggregate3', [Array.from(calls, (call: { callData: string }) => ({ success: true,
          returnData: call.callData === '0x313ce567' ? uint(18) : uint(123) }))]);
      }
      return { jsonrpc: '2.0', id: request.id, result: value };
    });
    return Response.json(Array.isArray(body) ? responses : responses[0]);
  } });
  const tokens = Array.from({ length: 20 }, (_, index) => ({ ...metadata, contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}` }));
  await reader.readBalances!('ethereum', holder, tokens, new AbortController().signal);
  requests.length = 0; posts = 0;
  const balances = await reader.readBalances!('ethereum', holder, tokens, new AbortController().signal);
  assert.equal(requests.length, 5);
  assert.equal(posts, 3);
  assert(balances.every(balance => balance.status === 'available' && balance.units === '123'));
  requests.length = 0; posts = 0;
  const maximum = Array.from({ length: 256 }, (_, index) => ({ ...metadata,
    contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}` }));
  const full = await reader.readBalances!('ethereum', holder, maximum, new AbortController().signal);
  assert.equal(full.length, 256);
  assert(full.every(balance => balance.status === 'available' && balance.units === '123'));
  assert.equal(requests.length, 17);
  assert.equal(posts, 4);
});

test('one oversized aggregate member leaves a healthy token available at the same block', async () => {
  const { Interface } = await import('ethers/abi');

  const creation = `0x${PALI_INFRASTRUCTURE_BY_ID.multicall3.deployCalldata!.slice(
    2 + 0x20 * 2
  )}`;
  const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
  const aggregate = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
  const bad = { ...metadata, contractAddress: `0x${'22'.repeat(20)}` };
  const reader = createErc20Reader({ fetch: async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const rows = Array.isArray(body) ? body : [body];
    const responses = rows.map((request: Request) => {
      let value = result(request);
      if (request.method === 'eth_getCode') value = runtime;
      if (request.method === 'eth_call') {
        assert.equal(request.params[1], '0x123');
        const input = request.params[0];
        if (input.data.startsWith(aggregate.getFunction('aggregate3')!.selector)) {
          const calls = aggregate.decodeFunctionData('aggregate3', input.data)[0];
          value = aggregate.encodeFunctionResult('aggregate3', [Array.from(calls, (call: { target: string; callData: string }) => ({
            success: true, returnData: call.callData === '0x313ce567' ? uint(18)
              : call.target.toLowerCase() === bad.contractAddress ? `0x${'00'.repeat(20 * 1024)}` : uint(5),
          }))]);
        } else if (input.data !== '0x313ce567') value = input.to === bad.contractAddress ? `0x${'00'.repeat(20 * 1024)}` : uint(5);
      }
      return { jsonrpc: '2.0', id: request.id, result: value };
    });
    return Response.json(Array.isArray(body) ? responses : responses[0]);
  } });
  const values = await reader.readBalances!('ethereum', holder, [metadata, bad], new AbortController().signal);
  assert.deepEqual(values, [{ status: 'available', units: '5' }, { status: 'error', units: null }]);
});

test('cross-operation admission retains its four slots until response bodies finish', async () => {
  let active = 0, maximum = 0;
  const releases: (() => void)[] = [];
  const reader = createErc20Reader({ timeoutMs: 1000, fetch: async (_url, init) => {
    active++; maximum = Math.max(maximum, active);
    const payload = JSON.parse(String(init.body)) as Request | Request[];
    const reply = (request: Request) => ({ jsonrpc: '2.0', id: request.id, result: result(request) });
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      text: () => new Promise<string>(resolve => releases.push(() => {
        active--; resolve(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)));
      })),
    } as Response;
  } });
  const reads = Array.from({ length: 8 }, () => reader.readBalance('ethereum', holder, metadata, new AbortController().signal));
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(active, 4);
  let complete = false;
  const finished = Promise.all(reads).then(() => { complete = true; });
  while (!complete) {
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setImmediate(resolve));
  }
  await finished;
  assert.equal(maximum, 4);
});

test('invalid response headers retain slots until asynchronous body cancellation finishes', async () => {
  let opened = 0;
  const releases: (() => void)[] = [];
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const reader = createErc20Reader({ fetch: async () => {
    opened++;
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      body: { cancel: () => new Promise<void>(resolve => releases.push(resolve)) },
    } as unknown as Response;
  } });
  const reads = controllers.map(controller => reader.readBalance('ethereum', holder, metadata, controller.signal));
  const settled = Promise.allSettled(reads);
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 4);
  controllers.forEach(controller => controller.abort());
  assert((await settled).every(result => result.status === 'rejected'));
  releases.splice(0).forEach(release => release());
});

test('stream completion retains physical capacity until reader cancellation drains', async () => {
  let active = 0, maximum = 0;
  const releases: (() => void)[] = [];
  const reader = createErc20Reader({ timeoutMs: 2000, fetch: async (_url, init) => {
    active++; maximum = Math.max(maximum, active);
    const payload = JSON.parse(String(init.body)) as Request | Request[];
    const reply = (request: Request) => ({ jsonrpc: '2.0', id: request.id, result: result(request) });
    const bytes = new TextEncoder().encode(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)));
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader() {
        let read = false;
        return { read: async () => read ? { done: true } : (read = true, { done: false, value: bytes }),
          cancel: () => new Promise<void>(resolve => releases.push(() => { active--; resolve(); })), releaseLock() {} };
      } },
    } as unknown as Response;
  } });
  const work = Promise.all(Array.from({ length: 8 }, () => reader.readBalance('ethereum', holder, metadata, new AbortController().signal)));
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(active, 4);
  let complete = false;
  const done = work.then(() => { complete = true; });
  while (!complete) {
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setImmediate(resolve));
  }
  await done;
  assert.equal(maximum, 4);
});

test('independent observations reuse only the selected endpoint batch capability', async () => {
  const widths: number[] = [];
  const reader = createErc20Reader({ fetch: async (_url, init) => {
    const payload = JSON.parse(String(init.body)) as Request | Request[];
    widths.push(Array.isArray(payload) ? payload.length : 1);
    if (Array.isArray(payload)) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch unsupported' } });
    return json(payload.id, result(payload));
  } });
  const signal = () => new AbortController().signal;
  assert.deepEqual(await reader.readBalance('ethereum', holder, metadata, signal()), { units: ((1n << 256n) - 1n).toString() });
  assert.deepEqual(widths, [2, 1, 1, 1, 1, 1, 1]);
  widths.length = 0;
  await reader.readBalance('ethereum', holder, metadata, signal());
  assert.deepEqual(widths, [1, 1, 1, 1, 1, 1]);
});

test('a failed buffered body holds physical capacity until its cancellation settles', async () => {
  let opened = 0;
  const releases: (() => void)[] = [];
  const reader = createErc20Reader({ fetch: async () => {
    opened++;
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => { throw Error('broken body'); },
      body: { cancel: () => new Promise<void>(resolve => releases.push(resolve)) },
    } as unknown as Response;
  } });
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const work = Promise.allSettled(controllers.map(controller => reader.readBalance('ethereum', holder, metadata, controller.signal)));
  for (let index = 0; index < 10; index++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 4);
  controllers.forEach(controller => controller.abort());
  await work;
  releases.forEach(release => release());
});

for (const scenario of [
  'scalar-stall',
  'scalar-unresponsive',
  'scalar-750',
  'canonical-change',
  'chain-change',
] as const) {
  test(`saved ERC20 groups retain healthy rows and final validation (${scenario})`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const tokens = Array.from(
      { length: scenario === 'scalar-750' ? 40 : 10 },
      (_, index) => ({
        ...metadata,
        contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      })
    );
    let finalBlocks = 0,
      chains = 0;
    const reader = createErc20Reader({
      fetch: async (_url, init) => {
        const payload = JSON.parse(String(init.body)) as Request | Request[];
        if (Array.isArray(payload))
          return Response.json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Batch unsupported' },
          });
        const request = payload;
        if (
          scenario.startsWith('scalar-') &&
          scenario !== 'scalar-750' &&
          request.method === 'eth_call' &&
          request.params[0].to === tokens[0]!.contractAddress &&
          request.params[0].data.startsWith('0x70a08231')
        ) {
          return new Promise<Response>((_resolve, reject) => {
            if (scenario === 'scalar-unresponsive') return;
            init.signal!.addEventListener(
              'abort',
              () => reject(new Error('stalled token aborted')),
              { once: true }
            );
          });
        }
        await new Promise((resolve) =>
          setTimeout(resolve, scenario === 'scalar-750' ? 750 : 50)
        );
        let value = result(request);
        if (
          request.method === 'eth_chainId' &&
          ++chains === 2 &&
          scenario === 'chain-change'
        )
          value = '0x2';
        if (
          request.method === 'eth_getBlockByNumber' &&
          request.params[0] === '0x123'
        ) {
          finalBlocks++;
          if (scenario === 'canonical-change')
            value = { number: '0x123', hash: '0x' + 'b'.repeat(64) };
        }
        return json(request.id, value);
      },
    });
    let complete = false;
    const pending = reader.readBalances!(
      'ethereum',
      holder,
      tokens,
      new AbortController().signal
    )
      .then(
        (value) => ({ value }),
        (error) => ({ error })
      )
      .finally(() => {
        complete = true;
      });
    for (let elapsed = 0; !complete && elapsed < 35000; elapsed += 50) {
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(50);
    }
    assert(complete, 'bounded refresh must finish');
    const outcome = await pending;
    assert.equal(finalBlocks, 1);
    assert.equal(chains, 2);
    if ('error' in outcome) {
      assert(
        ['canonical-change', 'chain-change'].includes(scenario),
        String(outcome.error)
      );
      assert.equal(
        outcome.error.code,
        scenario === 'chain-change' ? 'WRONG_CHAIN' : 'INVALID_RESPONSE'
      );
    } else {
      assert(!['canonical-change', 'chain-change'].includes(scenario));
      assert.equal(
        outcome.value.filter((row) => row.status === 'available').length,
        scenario === 'scalar-750' ? tokens.length : tokens.length - 1
      );
    }
  });
}

for (const broken of ['revert', 'malformed', 'healthy-scalar'] as const) {
  test(`broken Multicall ${broken} preserves direct batching for twenty tokens`, async () => {
    const { Interface } = await import('ethers/abi');

    const creation = `0x${PALI_INFRASTRUCTURE_BY_ID.multicall3.deployCalldata!.slice(
      2 + 0x20 * 2
    )}`;
    const runtime = `0x${creation.slice(2 + 0x20 * 2, 2 + (0x20 + 0xee0) * 2)}`;
    const aggregate = new Interface([
      'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
    ]);
    const requests: Request[] = [];
    let posts = 0;
    const reader = createErc20Reader({
      fetch: async (_url, init) => {
        posts++;
        const payload = JSON.parse(String(init.body)) as Request | Request[];
        if (broken === 'healthy-scalar' && Array.isArray(payload)) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch unsupported' } });
      const rows = Array.isArray(payload) ? payload : [payload];
        const replies = rows.map((request) => {
          requests.push(request);
          if (
            request.method === 'eth_call' &&
            request.params[0].data.startsWith(
              aggregate.getFunction('aggregate3')!.selector
            )
          ) {
            if (broken === 'healthy-scalar') {
            const calls = aggregate.decodeFunctionData('aggregate3', request.params[0].data)[0];
            return { jsonrpc: '2.0', id: request.id, result: aggregate.encodeFunctionResult('aggregate3', [Array.from(calls, (call: { callData: string }) => ({ success: true, returnData: call.callData === '0x313ce567' ? uint(18) : uint(5) }))]) };
          }
          return broken === 'revert'
              ? {
                  jsonrpc: '2.0',
                  id: request.id,
                  error: { code: -32000, message: 'execution reverted' },
                }
              : { jsonrpc: '2.0', id: request.id, result: '0x00' };
          }
          return {
            jsonrpc: '2.0',
            id: request.id,
            result:
              request.method === 'eth_getCode' ? runtime : result(request),
          };
        });
        return Response.json(Array.isArray(payload) ? replies : replies[0]);
      },
    });
    const tokens = Array.from({ length: 20 }, (_, index) => ({
      ...metadata,
      contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    }));
    const balances = await reader.readBalances!(
      'ethereum',
      holder,
      tokens,
      new AbortController().signal
    );
    assert(balances.every((balance) => balance.status === 'available'));
    assert.equal(requests.length, broken === 'healthy-scalar' ? 6 : 46);
    assert.equal(posts, broken === 'healthy-scalar' ? 7 : 5);
    assert(
      requests
        .filter((request) => request.method === 'eth_call')
        .every((request) => request.params[1] === '0x123')
    );
  });
}
