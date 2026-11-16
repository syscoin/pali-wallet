import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, Interface } from 'ethers/abi';
import { readNativeApprovalMetadata } from '../src/connections/approvalMetadata.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { decodeAssetTransfer } from '../../../source/shared/assetTransfer.ts';
import { summarizeApproval } from '../../../source/shared/approval.ts';

const contract = '0x' + '11'.repeat(20), owner = '0x' + '22'.repeat(20);
const abi = AbiCoder.defaultAbiCoder();
function fixture(standard: 'ERC-721' | 'ERC-1155' | 'ERC-20' | 'ambiguous' | 'unknown') {
  const controller = new AbortController();
  const calls: string[] = [];
  const methods: string[] = [];
  let posts = 0;
  let onRead = () => {};
  let alter = (_method: string, _params: unknown[], result: unknown) => result;
  const fetcher = async (_url: string, init: RequestInit) => {
    posts++;
    const payload = JSON.parse(String(init.body));
    const reply = ({ id, method, params }: { id: number; method: string; params: unknown[] }) => {
    onRead();
    methods.push(method);
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x' + '33'.repeat(32) };
    else if (method === 'eth_getCode') result = '0x6000';
    else {
      const data = String((params[0] as { data: string }).data); calls.push(data);
      if (data.startsWith('0x01ffc9a7')) result = abi.encode(['bool'], [
        standard === 'ambiguous' || standard === 'ERC-721' && data.includes('80ac58cd') || standard === 'ERC-1155' && data.includes('d9b67a26'),
      ]);
      else if (standard === 'ERC-20') result = data === '0x06fdde03' ? abi.encode(['string'], ['Example'])
        : data === '0x95d89b41' ? abi.encode(['string'], ['TOK'])
        : abi.encode(['uint256'], [data === '0x313ce567' ? 255 : 1]);
      else result = '0x';
    }
    return { jsonrpc: '2.0', id, result: alter(method, params, result) };
    };
    return Response.json(Array.isArray(payload) ? payload.map(reply) : reply(payload));
  };
  return { calls, methods, posts: () => posts, controller,
    alter(fn: typeof alter) { alter = fn; },
    onRead(fn: () => void) { onRead = fn; }, read: () => readNativeApprovalMetadata({
    network: getNativeNetwork('ethereum'), owner, contract, signal: controller.signal,
    assertCurrent() { if (controller.signal.aborted) throw new Error('CANCELLED'); }, fetch: fetcher,
  }) };
}

for (const standard of ['ERC-721', 'ERC-1155'] as const) test(`native approval metadata reuses bounded ${standard} interface reads`, async () => {
  const f = fixture(standard);
  assert.deepEqual(await f.read(), { standard });
  assert.equal(f.calls.length, 2);
  assert.equal(f.methods.length, 7);
  assert.equal(f.posts(), 4);
});

test('ERC20 approval metadata preserves the full uint8 precision', async () => {
  const f = fixture('ERC-20');
  assert.deepEqual(await f.read(), { standard: 'ERC-20', token: { contractAddress: contract, name: 'Example', symbol: 'TOK', decimals: 255 } });
  assert.equal(f.methods.length, 11);
  assert.equal(f.posts(), 5);
});

test('unknown contract metadata stays unavailable without claiming a token standard', async () => {
  assert.equal(await fixture('unknown').read(), undefined);
});

test('revocation during optional metadata still rejects the owning operation', async () => {
  const f = fixture('ERC-20');
  f.onRead(() => f.controller.abort());
  await assert.rejects(f.read(), /CANCELLED/);
});

test('conflicting NFT interface claims stay unverified without an ERC20 fallback', async () => {
  const f = fixture('ambiguous');
  assert.equal(await f.read(), undefined);
  assert.equal(f.calls.length, 2);
  assert(f.calls.every(data => data.startsWith('0x01ffc9a7')));
});

test('metadata shares one canonical block and retains independent allowance and transfer values', async () => {
  const f = fixture('ERC-20');
  const blocks: unknown[] = [];
  f.alter((method, params, result) => {
    if (method === 'eth_call' || method === 'eth_getCode') blocks.push(params[1]);
    return result;
  });
  const metadata = await f.read();
  assert(metadata);
  assert(blocks.every(block => block === '0x10'));
  const abi = new Interface(['function approve(address,uint256)', 'function transfer(address,uint256)']);
  const approval = summarizeApproval(abi.encodeFunctionData('approve', [owner, 7]), contract, metadata);
  const transfer = decodeAssetTransfer(abi.encodeFunctionData('transfer', [owner, 9]), contract, metadata);
  assert.equal(approval?.amountUnits, '7');
  assert.equal(transfer?.items[0]?.units, '9');
});

test('malformed balance proof cannot certify an ERC20 approval', async () => {
  const f = fixture('ERC-20');
  f.alter((method, params, result) => method === 'eth_call' && String((params[0] as { data: string }).data).startsWith('0x70a08231') ? '0x' : result);
  assert.equal(await f.read(), undefined);
});

test('a changed final block retires optional metadata', async () => {
  const f = fixture('ERC-20');
  let headers = 0;
  f.alter((method, _params, result) => method === 'eth_getBlockByNumber' && ++headers > 1
    ? { number: '0x10', hash: '0x' + '44'.repeat(32) } : result);
  assert.equal(await f.read(), undefined);
});
