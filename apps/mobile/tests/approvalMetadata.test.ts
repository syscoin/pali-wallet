import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder } from 'ethers/abi';
import { readNativeApprovalMetadata } from '../src/connections/approvalMetadata.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';

const contract = '0x' + '11'.repeat(20), owner = '0x' + '22'.repeat(20);
const abi = AbiCoder.defaultAbiCoder();
function fixture(standard: 'ERC-721' | 'ERC-1155' | 'ERC-20' | 'unknown') {
  const controller = new AbortController();
  const calls: string[] = [];
  let onRead = () => {};
  const fetcher = async (_url: string, init: RequestInit) => {
    const { id, method, params } = JSON.parse(String(init.body));
    onRead();
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x' + '33'.repeat(32) };
    else if (method === 'eth_getCode') result = '0x6000';
    else {
      const data = String(params[0].data); calls.push(data);
      if (data.startsWith('0x01ffc9a7')) result = abi.encode(['bool'], [
        standard === 'ERC-721' && data.includes('80ac58cd') || standard === 'ERC-1155' && data.includes('d9b67a26'),
      ]);
      else if (standard === 'ERC-20') result = data === '0x06fdde03' ? abi.encode(['string'], ['Example'])
        : data === '0x95d89b41' ? abi.encode(['string'], ['TOK'])
        : abi.encode(['uint256'], [data === '0x313ce567' ? 255 : 1]);
      else result = '0x';
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, controller, onRead(fn: () => void) { onRead = fn; }, read: () => readNativeApprovalMetadata({
    network: getNativeNetwork('ethereum'), owner, contract, signal: controller.signal,
    assertCurrent() { if (controller.signal.aborted) throw new Error('CANCELLED'); }, fetch: fetcher,
  }) };
}

for (const standard of ['ERC-721', 'ERC-1155'] as const) test(`native approval metadata reuses bounded ${standard} interface reads`, async () => {
  const f = fixture(standard);
  assert.deepEqual(await f.read(), { standard });
  assert.equal(f.calls.length, standard === 'ERC-721' ? 1 : 2);
});

test('ERC20 approval metadata preserves the full uint8 precision', async () => {
  const f = fixture('ERC-20');
  assert.deepEqual(await f.read(), { standard: 'ERC-20', token: { contractAddress: contract, name: 'Example', symbol: 'TOK', decimals: 255 } });
});

test('unknown contract metadata stays unavailable without claiming a token standard', async () => {
  assert.equal(await fixture('unknown').read(), undefined);
});

test('revocation during optional metadata still rejects the owning operation', async () => {
  const f = fixture('ERC-20');
  f.onRead(() => f.controller.abort());
  await assert.rejects(f.read(), /CANCELLED/);
});
