import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBalanceReader,
  parseRpcQuantity,
  parseRpcResult,
  RPC_ENDPOINTS,
  utf8ByteLength,
} from '../src/platformRpc.ts';

const address = '0x52908400098527886E0F7030069857D2E4169EE7';
const json = (id: number, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json' },
  });

test('balance reader verifies the chain before sending the public address', async () => {
  const requests: any[] = [];
  const reader = createBalanceReader({
    fetch: async (url, init) => {
      const request = JSON.parse(String(init.body));
      requests.push({ url, init, request });
      return json(
        request.id,
        request.method === 'eth_chainId' ? '0x1' : '0x20000000000001'
      );
    },
  });
  const result = await reader.readBalance(
    'ethereum',
    address.toLowerCase(),
    new AbortController().signal
  );
  assert.deepEqual(result, { chainId: 1, units: '9007199254740993' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, RPC_ENDPOINTS.ethereum);
  assert.deepEqual(requests[0].request.params, []);
  assert.equal(requests[0].request.method, 'eth_chainId');
  assert.deepEqual(requests[1].request.params, [address, 'latest']);
  assert.notEqual(requests[0].request.id, requests[1].request.id);
  assert.equal(requests[1].init.credentials, 'omit');
  assert.equal(requests[1].init.redirect, 'error');
});

test('wrong-chain response stops before any address or balance request is sent', async () => {
  let requests = 0;
  const reader = createBalanceReader({
    fetch: async (_, init) => {
      requests++;
      const { id } = JSON.parse(String(init.body));
      return json(id, '0x2105');
    },
  });
  await assert.rejects(
    reader.readBalance('ethereum', address, new AbortController().signal),
    /different network/
  );
  assert.equal(requests, 1);
});

test('JSON-RPC parsing rejects mismatched IDs, errors, arrays, nested values and malformed quantities', () => {
  assert.equal(
    parseRpcResult('{"jsonrpc":"2.0","id":7,"result":"0x0"}', 7),
    0n
  );
  const bad = [
    '{"jsonrpc":"2.0","id":8,"result":"0x0"}',
    '{"jsonrpc":"2.0","id":"7","result":"0x0"}',
    '{"jsonrpc":"1.0","id":7,"result":"0x0"}',
    '{"jsonrpc":"2.0","id":7,"error":{"message":"offline"}}',
    '{"jsonrpc":"2.0","id":7,"result":"0x0","error":null}',
    '[{"jsonrpc":"2.0","id":7,"result":"0x0"}]',
    '{"jsonrpc":"2.0","id":7,"result":{"value":"0x0"}}',
    '{"jsonrpc":"2.0","id":7,"result":null}',
    'not JSON',
  ];
  for (const body of bad) assert.throws(() => parseRpcResult(body, 7));
  for (const value of [
    '0x',
    '0x00',
    '0x01',
    '1',
    '-0x1',
    '0X1',
    '0xNaN',
    '0x' + 'f'.repeat(65),
    0,
    null,
  ]) {
    assert.throws(() => parseRpcQuantity(value));
  }
  assert.equal(parseRpcQuantity('0x' + 'f'.repeat(64)), (1n << 256n) - 1n);
});

test('HTTP, content-type and oversized body errors do not turn into a zero balance', async () => {
  const responses = [
    new Response('offline', { status: 503 }),
    new Response('<html>gateway</html>', {
      headers: { 'Content-Type': 'text/html' },
    }),
    new Response(' ', { headers: { 'Content-Length': '32768' } }),
    new Response(' '.repeat(16385), {
      headers: { 'Content-Type': 'application/json' },
    }),
  ];
  for (const response of responses) {
    const reader = createBalanceReader({ fetch: async () => response });
    await assert.rejects(
      reader.readBalance('ethereum', address, new AbortController().signal)
    );
  }
});

test('cancelled calls never start and in-flight cancellation settles even if fetch ignores the signal', async () => {
  let requests = 0;
  const reader = createBalanceReader({
    fetch: async () => {
      requests++;
      return new Promise(() => undefined);
    },
  });
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(
    reader.readBalance('ethereum', address, alreadyCancelled.signal),
    { name: 'AbortError' }
  );
  assert.equal(requests, 0);
  const controller = new AbortController();
  const pending = reader.readBalance('ethereum', address, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('one bounded deadline covers the entire balance lookup', async () => {
  const reader = createBalanceReader({
    timeoutMs: 10,
    fetch: async () => new Promise(() => undefined),
  });
  await assert.rejects(
    reader.readBalance('ethereum', address, new AbortController().signal),
    { name: 'AbortError' }
  );
  assert.throws(() => createBalanceReader({ timeoutMs: 0 }));
  assert.throws(() => createBalanceReader({ timeoutMs: 30001 }));
});

test('unsupported networks and invalid addresses cannot trigger a request', async () => {
  let requests = 0;
  const reader = createBalanceReader({
    fetch: async () => {
      requests++;
      return json(1, '0x1');
    },
  });
  await assert.rejects(
    reader.readBalance('bitcoin', address, new AbortController().signal)
  );
  await assert.rejects(
    reader.readBalance(
      'ethereum',
      'not-an-address',
      new AbortController().signal
    )
  );
  assert.equal(requests, 0);
});

test('UTF-8 budgets count bytes rather than UTF-16 code units', () => {
  assert.equal(utf8ByteLength('aé€😀'), 10);
  assert.throws(() => parseRpcResult('é'.repeat(8193), 1), /size limit/);
});
