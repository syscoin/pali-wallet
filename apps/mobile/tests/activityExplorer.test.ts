import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountHistoryUrl } from '../../../source/shared/evmExplorer.ts';
import { ActivityExplorerReader, decodeActivityPage, ACTIVITY_PAGE_SIZE } from '../src/activity/explorerReader.ts';
import { createActivityScope } from '../src/activity/types.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const fingerprint = 'a'.repeat(64);
const hash = (index = 1) => `0x${index.toString(16).padStart(64, '0')}`;
const scope = createActivityScope(fingerprint, 'hd:60:0', OWNER, 'ethereum');
const signal = () => new AbortController().signal;
const row = (fields: Record<string, unknown> = {}) => ({ hash: hash(), from: OTHER, to: OWNER, blockNumber: '123', timeStamp: '1700000000', ...fields });
const envelope = (rows: unknown[] = [row()], fields: Record<string, unknown> = {}) => ({ status: '1', message: 'OK', result: rows, ...fields });

test('shared account URL preserves configured query identity and extension defaults', () => {
  const result = buildAccountHistoryUrl('https://explorer.example/custom/api?chainid=1&apiKey=fixture-key&custom=x', OWNER, 'tokentx', 3, 20);
  assert.equal(result.origin, 'https://explorer.example'); assert.equal(result.pathname, '/custom/api');
  assert.deepEqual(Object.fromEntries(result.searchParams), { chainid: '1', apiKey: 'fixture-key', custom: 'x',
    module: 'account', action: 'tokentx', address: OWNER, sort: 'desc', page: '3', offset: '20', apikey: 'fixture-key' });
  const ordinary = buildAccountHistoryUrl('https://explorer.example/api', OWNER, 'txlist');
  assert.equal(ordinary.searchParams.has('page'), false); assert.equal(ordinary.searchParams.has('offset'), false);
  const pending = buildAccountHistoryUrl('https://explorer.example/api?sort=asc', OWNER, 'pendingtxlist');
  assert.equal(pending.searchParams.get('sort'), 'asc');
});

test('candidate codec preserves exact hash/block identity while discarding untrusted transaction facts', () => {
  const [candidate] = decodeActivityPage(envelope([row({ hash: hash(10).toUpperCase().replace('0X', '0x'), value: '999',
    isError: '0', confirmations: '999999', tokenSymbol: 'FAKE', input: '0xabcdef' })]), 'tokentx', OWNER);
  assert.deepEqual(candidate, { hash: hash(10), blockNumber: '123', timestamp: 1700000000000, tokenHint: true });
  assert.equal(Object.isFrozen(candidate), true);
  assert.deepEqual(decodeActivityPage({ status: '0', message: 'No transactions found', result: [] }, 'txlist', OWNER), []);
});

test('candidate codec rejects malformed status, unrelated owners, inexact integers and excessive rows', () => {
  const invalid: unknown[] = [null, [], { status: '1', result: 'no data' }, { status: '0', message: 'NOTOK', result: [] },
    envelope([], { message: 'NOTOK' }), envelope([row()], { status: 1 }),
    { status: '0', message: 'No transactions found', result: [row()] },
    envelope([row({ from: OTHER, to: OTHER })]), envelope([row({ from: '0x123' })]), envelope([row({ hash: '0x123' })]),
    envelope([row({ blockNumber: '01' })]), envelope([row({ blockNumber: '-1' })]), envelope([row({ blockNumber: '9'.repeat(79) })]),
    envelope(Array.from({ length: ACTIVITY_PAGE_SIZE + 1 }, () => row())),
  ];
  for (const value of invalid) assert.throws(() => decodeActivityPage(value, 'txlist', OWNER), { code: 'INVALID' });
});

test('invalid and implausibly future explorer timestamps stay unknown instead of becoming now', () => {
  for (const timeStamp of [undefined, 'bad', '-1', '01', '999999999999']) {
    assert.equal(decodeActivityPage(envelope([row({ timeStamp })]), 'txlist', OWNER)[0]?.timestamp, null);
  }
});

test('registered Activity scope distinguishes wallet, account, address, endpoint and chain registration', () => {
  const another = createActivityScope(fingerprint, 'hd:60:1', OWNER, 'ethereum');
  assert.notEqual(another.key, scope.key); assert.notEqual(another.sourceId, scope.sourceId);
  assert.notEqual(createActivityScope('b'.repeat(64), 'hd:60:0', OWNER, 'ethereum').key, scope.key);
  assert.notEqual(createActivityScope(fingerprint, 'hd:60:0', OTHER, 'ethereum').key, scope.key);
  assert.throws(() => createActivityScope(fingerprint, 'hd:60:0', OWNER, 'base'), { code: 'UNAVAILABLE' });
  assert.throws(() => createActivityScope('bad', 'hd:60:0', OWNER, 'ethereum'), { code: 'INVALID' });
  assert.equal(scope.apiUrl, 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api');
});

test('reader verifies the registered RPC chain before returning a bounded head', async () => {
  const methods: string[] = [];
  const reader = new ActivityExplorerReader(async (url, init) => {
    assert.equal(url, scope.network.rpcUrl); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(String(init.body)); methods.push(body.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x1' : '0x100' }));
  });
  assert.equal(await reader.head(scope, signal(), () => undefined), '256');
  assert.equal(methods[0], 'eth_chainId');
  assert(methods.includes('eth_blockNumber'));
  const wrong = new ActivityExplorerReader(async (_url, init) => {
    const body = JSON.parse(String(init.body)); assert.equal(body.method, 'eth_chainId');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x2' }));
  });
  await assert.rejects(wrong.head(scope, signal(), () => undefined), { code: 'CHANGED' });
});

test('reader pins API path, account, page size and sampled end block without exposing an RPC method', async () => {
  const reader = new ActivityExplorerReader(async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, scope.apiUrl);
    assert.equal(parsed.searchParams.get('module'), 'account'); assert.equal(parsed.searchParams.get('action'), 'tokentx');
    assert.equal(parsed.searchParams.get('address'), OWNER); assert.equal(parsed.searchParams.get('page'), '2');
    assert.equal(parsed.searchParams.get('offset'), '20'); assert.equal(parsed.searchParams.get('startblock'), '0');
    assert.equal(parsed.searchParams.get('endblock'), '256'); assert.equal(parsed.searchParams.get('sort'), 'desc');
    assert.equal(init.body, undefined); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify(envelope()));
  });
  assert.equal((await reader.page(scope, 'tokentx', 2, '256', signal(), () => undefined))[0]?.tokenHint, true);
});

test('invalid pages and end blocks reject before requesting an address', async () => {
  let requests = 0;
  const reader = new ActivityExplorerReader(async () => { requests++; return new Response('{}'); });
  for (const page of [0, -1, 1.5, 10001, Infinity]) await assert.rejects(reader.page(scope, 'txlist', page, '256', signal(), () => undefined), { code: 'INVALID' });
  assert.throws(() => reader.page(scope, 'txlist', 1, '01', signal(), () => undefined), { code: 'INVALID' });
  assert.equal(requests, 0);
});

test('HTTP failures, malformed JSON and oversized bodies never become empty history', async () => {
  for (const response of [new Response('rate limited', { status: 429 }), new Response('{bad'),
    new Response(JSON.stringify(envelope([row({ padding: 'x'.repeat(256 * 1024) })])))]) {
    const reader = new ActivityExplorerReader(async () => response);
    await assert.rejects(reader.page(scope, 'txlist', 1, '256', signal(), () => undefined));
  }
});

test('aborting a never-settling fetch completes the request without waiting for the transport', async () => {
  const abort = new AbortController();
  const reader = new ActivityExplorerReader(async () => new Promise(() => undefined));
  const pending = reader.head(scope, abort.signal, () => undefined).then(() => 'resolved', () => 'rejected');
  await new Promise((resolve) => setTimeout(resolve, 0)); abort.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([pending, new Promise<string>((resolve) => { timeout = setTimeout(() => resolve('stalled'), 100); })]);
  if (timeout) clearTimeout(timeout);
  assert.equal(outcome, 'rejected');
});
