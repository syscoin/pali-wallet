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
