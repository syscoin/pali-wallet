import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { decodeAssetTransfer } from '../../../source/shared/assetTransfer.ts';
const contract = '0x1111111111111111111111111111111111111111';
const from = '0x2222222222222222222222222222222222222222';
const to = '0x3333333333333333333333333333333333333333';
const encode = (signature: string, values: unknown[]) => new Interface([`function ${signature}`]).encodeFunctionData(signature.split('(')[0]!, values);

test('dapp ERC20 transfer summary retains exact recipient and 255-decimal raw amount', () => {
  const raw = '123456789012345678901234567890';
  const data = encode('transfer(address,uint256)', [to, raw]);
  const result = decodeAssetTransfer(data, contract, { standard: 'ERC-20', token: { contractAddress: contract, name: 'Token', symbol: 'TOK', decimals: 255 } });
  assert(result); assert.equal(result.recipient, to); assert.equal(result.contract, contract);
  assert.equal(result.items[0]?.units, raw); assert.equal(result.token?.decimals, 255);
  assert.equal(result.standardVerified, true); assert.equal(result.decoded.method, 'transfer');
});

test('ERC721 transferFrom and safeTransferFrom show real owner, recipient and token ID', () => {
  for (const sig of ['transferFrom(address,address,uint256)', 'safeTransferFrom(address,address,uint256)', 'safeTransferFrom(address,address,uint256,bytes)']) {
    const args = [from, to, (2n ** 255n).toString(), ...(sig.includes('bytes') ? ['0x'] : [])];
    const result = decodeAssetTransfer(encode(sig, args), contract, { standard: 'ERC-721' });
    assert(result); assert.equal(result.recipient, to); assert.equal(result.from, from);
    assert.equal(result.items[0]?.tokenId, args[2]); assert.equal(result.items[0]?.units, '1');
  }
});

test('ERC1155 batch keeps IDs and quantities paired and bounds item count', () => {
  const sig = 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)';
  const result = decodeAssetTransfer(encode(sig, [from, to, [1, 9], [2, 3], '0x']), contract, { standard: 'ERC-1155' });
  assert.deepEqual(result?.items, [{ tokenId: '1', units: '2' }, { tokenId: '9', units: '3' }]);
  assert.equal(decodeAssetTransfer(encode(sig, [from, to, [1, 9], [2], '0x']), contract), null);
  assert.equal(decodeAssetTransfer(encode(sig, [from, to, Array(129).fill(1), Array(129).fill(1), '0x']), contract), null);
});

test('unknown standard stays explicit; malformed or contradictory calls are not called asset transfers', () => {
  const data = encode('transferFrom(address,address,uint256)', [from, to, 4]);
  assert.equal(decodeAssetTransfer(data, contract)?.standard, 'Unknown');
  assert.equal(decodeAssetTransfer(data, contract)?.standardVerified, false);
  for (const broken of ['0x', data.slice(0, -2), `${data}00`, '0x12345678']) assert.equal(decodeAssetTransfer(broken, contract), null);
  const contradictory = decodeAssetTransfer(encode('transfer(address,uint256)', [to, 4]), contract, { standard: 'ERC-721' });
  assert.equal(contradictory?.standardVerified, false);
  assert.equal(contradictory?.recipient, to);
  assert.equal(contradictory?.items[0]?.units, '4');
});
