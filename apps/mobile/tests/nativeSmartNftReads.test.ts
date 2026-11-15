import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { isCallException } from 'ethers/utils';
import { readEvmAssetBalance } from '../../../source/shared/evmAssetState.ts';
import { createNativeSmartAccountProvider } from '../src/smartAccount/provider.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';

const owner = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const abi = new Interface(['function ownerOf(uint256) view returns(address)']);
const revertData = new Interface(['error Error(string)']).encodeErrorResult('Error', ['ERC721: invalid token ID']);
const asset = { standard: 'ERC721' as const, contractAddress: token, tokenId: '3', amountUnits: '1' };
type RpcError = { code?: unknown; message?: unknown; data?: unknown };

function fixture(error: RpcError = { code: 3, message: 'execution reverted: ERC721: invalid token ID', data: revertData },
  options: { beforeReply?(method: string): void; transportError?: unknown; chain?: string; codeError?: boolean } = {}) {
  const lifetime = new AbortController();
  const ids: bigint[] = [];
  const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
    if (options.transportError) throw options.transportError;
    const request = JSON.parse(String(init.body));
    let result: unknown;
    let failure: RpcError | undefined;
    if (request.method === 'eth_chainId') result = options.chain ?? '0x1';
    else if (request.method === 'eth_getCode') {
      if (options.codeError) failure = error;
      else result = '0x6000';
    }
    else {
      assert.equal(request.method, 'eth_call');
      assert.equal(request.params[0].to, token);
      assert.equal(request.params[1], 'pending');
      const call = abi.parseTransaction({ data: request.params[0].data });
      assert(call);
      const id = call.args[0] as bigint;
      ids.push(id);
      if (id === 3n) result = AbiCoder.defaultAbiCoder().encode(['address'], [owner]);
      else failure = error;
    }
    options.beforeReply?.(request.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(failure ? { error: failure } : { result }) }),
      { headers: { 'content-type': 'application/json' } });
  } });
  const provider = createNativeSmartAccountProvider(getNativeNetwork('ethereum'), rpc, lifetime.signal, () => undefined);
  return { rpc, provider, lifetime, ids,
    balance: () => readEvmAssetBalance((method, params) => provider.send(method, params), owner, asset, 'pending'),
  };
}

for (const code of [3, -32000]) test(`native Smart ERC721 ownership preserves the explicit missing-ID revert (${code})`, async () => {
  const f = fixture({ code, message: 'execution reverted: ERC721: invalid token ID', data: revertData });
  assert.equal(await f.balance(), 1n);
  assert.equal(f.ids.length, 2);
  assert.notEqual(f.ids[0], 3n, 'ownership verification must first make its independent negative probe');
  assert.equal(f.ids[1], 3n);
});

for (const [name, error] of [
  ['missing data', { code: 3, message: 'execution reverted' }],
  ['malformed data', { code: 3, message: 'execution reverted', data: '0x0' }],
  ['oversized data', { code: 3, message: 'execution reverted', data: '0x' + 'ab'.repeat(4097) }],
  ['unrelated code', { code: -32603, message: 'execution reverted', data: revertData }],
  ['transport message', { code: -32000, message: 'upstream unavailable', data: revertData }],
  ['forged normalized error', { code: 'CALL_EXCEPTION', message: 'execution reverted', data: revertData }],
] as const) test(`native Smart ERC721 ownership refuses ${name}`, async () => {
  const f = fixture(error);
  await assert.rejects(f.balance(), { code: 'INVALID_RESPONSE' });
  assert.equal(f.ids.length, 1);
  assert.notEqual(f.ids[0], 3n, 'an invalid negative probe cannot attest the requested token');
});

test('native Smart revert normalization remains local to the eth_call response operation', async () => {
  const f = fixture();
  let normalized: unknown;
  await assert.rejects(f.provider.send('eth_call', [{ to: token, data: abi.encodeFunctionData('ownerOf', [4]) }, 'pending']), error => {
    assert(isCallException(error));
    assert.equal(error.data, revertData);
    normalized = error;
    return true;
  });
  const reused = fixture(undefined, { transportError: normalized });
  await assert.rejects(reused.balance(), { code: 'UNAVAILABLE' });
  const rawTransport = fixture(undefined, { transportError: { code: 3, message: 'execution reverted', data: revertData } });
  await assert.rejects(rawTransport.balance(), { code: 'INVALID_RESPONSE' });
  const nonCall = fixture(undefined, { codeError: true });
  await assert.rejects(nonCall.balance(), { code: 'INVALID_RESPONSE' });
  assert.equal(nonCall.ids.length, 0);
});

test('native Smart explicit revert data keeps the shared four-KiB limit', async () => {
  const data = '0x' + 'ab'.repeat(4096);
  const f = fixture({ code: 3, message: 'execution reverted', data });
  await assert.rejects(f.provider.send('eth_call', [{ to: token, data: abi.encodeFunctionData('ownerOf', [4]) }, 'pending']), error => {
    assert(isCallException(error));
    assert.equal(error.data, data);
    return true;
  });
});

test('native Smart NFT reads preserve wrong-chain and cancellation refusals', async () => {
  const wrong = fixture(undefined, { chain: '0x2' });
  await assert.rejects(wrong.balance(), { code: 'PROFILE_CHANGED' });
  assert.equal(wrong.ids.length, 0);
  let abort = () => {};
  const cancelled = fixture(undefined, { beforeReply: method => { if (method === 'eth_call') abort(); } });
  abort = () => cancelled.lifetime.abort();
  await assert.rejects(cancelled.provider.send('eth_call', [{ to: token, data: abi.encodeFunctionData('ownerOf', [4]) }, 'pending']), { code: 'CANCELLED' });
  assert.equal(cancelled.ids.length, 1);
  assert.notEqual(cancelled.ids[0], 3n, 'a cancelled negative probe cannot authorize an ownership read');
});

test('a native Smart Account phase brackets nested reads once and preserves explicit selectors', async () => {
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body));
    calls.push(request);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result:
      request.method === 'eth_chainId' ? '0x1' : request.method === 'eth_getBalance' ? '0x12' : '0x6000' }),
      { headers: { 'content-type': 'application/json' } });
  } });
  const provider = createNativeSmartAccountProvider(getNativeNetwork('ethereum'), rpc, new AbortController().signal, () => undefined);
  await provider.verifyConfiguredChainId();
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId']);
  calls.length = 0;
  await provider.withReadPhase(async phase => {
    await phase.verifyConfiguredChainId();
    await phase.send('eth_getBalance', [owner, 'pending']);
    await phase.withReadPhase(async nested => {
      await nested.verifyConfiguredChainId();
      await nested.send('eth_getBalance', [owner, '0x12']);
    });
  });
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_getBalance', 'eth_getBalance', 'eth_chainId']);
  assert.equal(calls[1]!.params[1], 'pending');
  assert.equal(calls[2]!.params[1], '0x12');
});

test('native Smart Account phases reject wrong chains and late escaped readers', async () => {
  for (const failAt of [1, 2]) {
    let chains = 0;
    const calls: string[] = [];
    const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body)); calls.push(request.method);
      const result = request.method === 'eth_chainId' ? (++chains === failAt ? '0x2' : '0x1') : '0x12';
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
    } });
    const provider = createNativeSmartAccountProvider(getNativeNetwork('ethereum'), rpc, new AbortController().signal, () => undefined);
    await assert.rejects(provider.withReadPhase(phase => phase.send('eth_getBalance', [owner, 'pending'])), { code: 'PROFILE_CHANGED' });
    if (failAt === 1) assert.deepEqual(calls, ['eth_chainId']);
  }
  const f = fixture();
  let escaped: Parameters<Parameters<typeof f.provider.withReadPhase>[0]>[0] | undefined;
  await f.provider.withReadPhase(async phase => { escaped = phase; });
  await assert.rejects(escaped!.send('eth_getBalance', [owner, 'pending']), { code: 'CANCELLED' });
});

test('shared native phase sends mixed reads in one HTTP batch with two chain probes', async () => {
  const { withEvmReadPhase } = await import('../../../source/shared/evmReadPhase.ts');
  const bodies: { method: string; params: unknown[] }[][] = [];
  const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const rows = Array.isArray(body) ? body : [body];
    bodies.push(rows);
    const response = rows.map((request: { method: string; id: number }) => ({ jsonrpc: '2.0', id: request.id,
      result: request.method === 'eth_chainId' ? '0x1' : request.method === 'eth_getCode' ? '0x6000' : '0x1',
    }));
    return Response.json(Array.isArray(body) ? response : response[0]);
  } });
  const provider = createNativeSmartAccountProvider(getNativeNetwork('ethereum'), rpc, new AbortController().signal, () => undefined);
  await withEvmReadPhase(provider, () => undefined, async phase => {
    assert.deepEqual(await Promise.all([
      phase.send('eth_getCode', [token, 'pending']),
      phase.send('eth_getBalance', [owner, 'pending']),
      phase.send('eth_getTransactionCount', [owner, 'pending']),
    ]), ['0x6000', '0x1', '0x1']);
  });
  assert.deepEqual(bodies.map(rows => rows.map(row => row.method)), [
    ['eth_chainId'], ['eth_getCode', 'eth_getBalance', 'eth_getTransactionCount'], ['eth_chainId'],
  ]);
});

test('native phase preserves an actual shared pending-state refusal without accepting a remote impersonation', async () => {
  const { createSmartAccountPendingState, isSmartAccountPendingStateError } = await import('../../../source/utils/smartAccount/pendingState.ts');
  const { paliEntryPointInterface } = await import('../../../source/utils/smartAccount/contracts.ts');
  const calls: string[] = [];
  let remote = false;
  const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
    const payload = JSON.parse(String(init.body));
    const rows = Array.isArray(payload) ? payload : [payload];
    const replies = rows.map(request => {
      calls.push(request.method);
      let result: unknown = '0x0';
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getBlockByNumber') result = { number: '0x1', hash: `0x${'12'.repeat(32)}` };
      else if (request.method === 'eth_getTransactionReceipt' || request.method === 'eth_getTransactionByHash') result = null;
      else if (request.method === 'eth_call') {
        const decoded = paliEntryPointInterface.parseTransaction({ data: request.params[0].data });
        assert(decoded);
        result = paliEntryPointInterface.encodeFunctionResult(decoded.fragment, [0]);
      }
      return { jsonrpc: '2.0', id: request.id, ...(remote
        ? { error: { code: -32000, message: 'SMART_ACCOUNT_PENDING_STATE', transactionNotBroadcast: true } }
        : { result }) };
    });
    return Response.json(Array.isArray(payload) ? replies : replies[0]);
  } });
  const provider = createNativeSmartAccountProvider(getNativeNetwork('ethereum'), rpc, new AbortController().signal, () => undefined);
  const hash = `0x${'ab'.repeat(32)}`;
  const pending = createSmartAccountPendingState(provider, {
    profileId: `0x${'33'.repeat(32)}`,
    read: async () => [{ account: owner, chainId: '1', hash, operationHash: hash, operationNonce: '0', payer: token, payerNonce: 0 }],
  }, 1, owner, () => undefined);
  await assert.rejects(pending.withReadPhase(phase => phase.readNonce(0n)), error => {
    assert(isSmartAccountPendingStateError(error));
    assert.equal((error as { transactionNotBroadcast: boolean }).transactionNotBroadcast, true);
    return true;
  });
  assert(calls.includes('eth_getTransactionReceipt'));
  remote = true;
  await assert.rejects(provider.withReadPhase(phase => phase.send('eth_getBalance', [owner, 'pending'])), error => {
    assert.equal(isSmartAccountPendingStateError(error), false);
    assert.equal((error as { transactionNotBroadcast?: boolean }).transactionNotBroadcast, undefined);
    return true;
  });
});

for (const failure of ['content-type', 'authority'] as const) test(`native transfer cleans streaming bodies after ${failure} rejects headers`, async () => {
  let current = true, cancelled = 0;
  const signals: AbortSignal[] = [];
  const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
    signals.push(init.signal as AbortSignal);
    if (failure === 'authority') current = false;
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': failure === 'content-type' ? 'text/html' : 'application/json' } });
  } });
  for (let index = 0; index < 6; index++) {
    current = true;
    await assert.rejects(rpc.smartAccountRead('eth_chainId', [], new AbortController().signal, () => { if (!current) throw Error('revoked'); }));
  }
  assert.equal(cancelled, 6);
  assert(signals.every(signal => signal.aborted));
});

test('native infrastructure status reuses only a canonically observed same-head code vector', async () => {
  const { SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES, createSmartAccountInfrastructureReader } = await import('../../../source/utils/smartAccount/infrastructureObservation.ts');
  const infrastructureReader = createSmartAccountInfrastructureReader();
  const requests: { method: string; params: any[] }[] = [];
  let height = '0x1', hash = `0x${'12'.repeat(32)}`;
  const readStatus = () => new EvmTransferReadRpc(getNativeNetwork('ethereum'), { infrastructureReader, fetch: async (_url, init) => {
    const payload = JSON.parse(String(init.body));
    const rows = Array.isArray(payload) ? payload : [payload];
    const replies = rows.map(request => {
      requests.push(request);
      const result = request.method === 'eth_chainId' ? '0x1' : request.method === 'eth_getCode' ? '0x6000' : { number: height, hash };
      if (request.method === 'eth_getCode') assert.equal(request.params[1], height);
      return { jsonrpc: '2.0', id: request.id, result };
    });
    return Response.json(Array.isArray(payload) ? replies : replies[0]);
  } }).readSmartAccountInfrastructureStatus(new AbortController().signal, () => undefined);
  await readStatus();
  assert.equal(requests.filter(request => request.method === 'eth_getCode').length, SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.length);
  requests.length = 0;
  await readStatus();
  assert.deepEqual(requests.map(request => request.method), ['eth_chainId', 'eth_getBlockByNumber', 'eth_chainId', 'eth_getBlockByNumber']);
  height = '0x2'; hash = `0x${'13'.repeat(32)}`; requests.length = 0;
  await readStatus();
  assert.equal(requests.filter(request => request.method === 'eth_getCode').length, SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.length);
});

test('fresh native transfer readers share only host-owned endpoint capabilities', async () => {
  const { createRpcReadCapabilitiesOwner } = await import('../../../source/shared/rpcReadCapabilities.ts');
  const capabilities = createRpcReadCapabilitiesOwner();
  const network = getNativeNetwork('ethereum');
  const widths: number[] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    widths.push(Array.isArray(payload) ? payload.length : 1);
    if (Array.isArray(payload)) return Response.json({ jsonrpc: '2.0', id: null,
      error: { code: -32600, message: 'Batch unsupported' } });
    return Response.json({ jsonrpc: '2.0', id: payload.id,
      result: payload.method === 'eth_chainId' ? '0x1' : '0x0' });
  };
  const observe = async (scope: string) => {
    const rpc = new EvmTransferReadRpc(network, { fetch,
      capabilities: capabilities.get(scope, network.rpcUrl) });
    await rpc.smartAccountReadPhase(new AbortController().signal, () => undefined,
      phase => phase.readMany([{ method: 'eth_getBalance', params: [token, 'pending'] },
        { method: 'eth_getBalance', params: [token, 'latest'] }]));
  };
  await observe(network.registrationHash);
  assert.equal(widths.filter(width => width > 1).length, 1);
  widths.length = 0;
  await observe(network.registrationHash);
  assert.deepEqual(widths, [1, 1, 1, 1]);
  widths.length = 0;
  await observe('another-registration');
  assert.equal(widths.filter(width => width > 1).length, 1);
});

test('native rejected response cleanup keeps queued reads from opening more bodies', async () => {
  let opened = 0, cancelled = 0;
  const releases: (() => void)[] = [];
  const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body));
    if (request.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x1' });
    opened++;
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      body: { cancel: () => { cancelled++; return new Promise<void>(resolve => releases.push(resolve)); } },
    } as unknown as Response;
  } });
  await assert.rejects(rpc.smartAccountReadPhase(new AbortController().signal, () => undefined,
    phase => phase.readMany(Array.from({ length: 200 }, () => ({ method: 'eth_getBalance' as const, params: [token, 'pending'] })))));
  await new Promise(resolve => setImmediate(resolve));
  assert(opened > 0 && opened <= 4);
  assert.equal(cancelled, opened);
  const before = opened;
  releases.forEach(release => release());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, before);
});

test('bounded RPC normalization preserves the explicit unsupported priority-fee fallback', async () => {
  const methods: string[] = [];
  const rpc = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body));
    methods.push(request.method);
    const error = request.method === 'eth_maxPriorityFeePerGas'
      ? { code: -32601, message: 'Method not found' } : undefined;
    const result = request.method === 'eth_chainId' ? '0x1'
      : request.method === 'eth_getBlockByNumber' ? { number: '0x1', hash: `0x${'12'.repeat(32)}`, gasLimit: '0x1c9c380', baseFeePerGas: '0x4' }
      : request.method === 'eth_feeHistory' ? { reward: [['0x2', '0x2', '0x2']] } : '0xa';
    return Response.json({ jsonrpc: '2.0', id: request.id, ...(error ? { error } : { result }) });
  } });
  const fees = await rpc.smartAccountFeeData(new AbortController().signal, () => undefined);
  assert.equal(fees.maxPriorityFeePerGas, 3n);
  assert(methods.includes('eth_feeHistory'));
});

test('fresh native readers share four physical slots while rejected body cancellation is held', async () => {
  const { createBoundedRpcFetch } = await import('../src/custody/boundedRpcFetch.ts');
  let opened = 0;
  const releases: (() => void)[] = [];
  const fetch = createBoundedRpcFetch(async () => {
    opened++;
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      body: { cancel: () => new Promise<void>(resolve => releases.push(resolve)) },
    } as unknown as Response;
  });
  for (let index = 0; index < 4; index++) {
    await assert.rejects(new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch }).verifyNetwork(new AbortController().signal, () => undefined));
  }
  assert.equal(opened, 4);
  const later = new AbortController();
  const waiting = new EvmTransferReadRpc(getNativeNetwork('ethereum'), { fetch }).verifyNetwork(later.signal, () => undefined);
  const rejected = assert.rejects(waiting);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 4);
  later.abort(); await rejected;
  releases.forEach(release => release());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 4);
});
