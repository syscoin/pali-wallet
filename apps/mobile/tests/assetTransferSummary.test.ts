import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { decodeAssetTransfer } from '../../../source/shared/assetTransfer.ts';
import { createAssetTransferDisplay, resolveAssetTransferDisplay } from '../../../source/shared/assetTransferDisplay.ts';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
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

test('shared transfer display formats all 255 decimals without losing raw units', () => {
  const units = (2n ** 255n).toString();
  const transfer = decodeAssetTransfer(encode('transfer(address,uint256)', [to, units]), contract,
    { standard: 'ERC-20', token: { contractAddress: contract, name: 'Exact token', symbol: 'TOK', decimals: 255 } });
  assert(transfer);
  const display = createAssetTransferDisplay(transfer);
  assert.equal(display.heading, 'token-transfer');
  assert.equal(display.items[0]?.value, formatTokenUnits(units, 255));
  assert.equal(display.items[0]?.units, units);
  assert.equal(display.items[0]?.symbol, 'TOK');
});

test('shared transfer display preserves zero and maximum NFT IDs with paired quantities', () => {
  const id = (2n ** 256n - 1n).toString();
  const display = resolveAssetTransferDisplay({ data: encode('safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', [from, to, ['0', id], [2, 3], '0x']), contract });
  assert.equal(display?.heading, 'transfer-call');
  assert.equal(display?.standardVerified, false);
  assert.deepEqual(display?.items.map(item => [item.value, item.units]), [['#0', '2'], [`#${id}`, '3']]);
});

test('changed contract, recipient or amount cannot reuse prior transfer metadata', () => {
  const data = encode('transfer(address,uint256)', [to, 123]);
  const transfer = decodeAssetTransfer(data, contract, { standard: 'ERC-20', token: { contractAddress: contract, name: 'Exact token', symbol: 'TOK', decimals: 6 } });
  assert(transfer);
  assert.equal(resolveAssetTransferDisplay({ data, contract, transfer })?.items[0]?.value, '0.000123');
  for (const input of [
    { data, contract: from },
    { data: encode('transfer(address,uint256)', [from, 123]), contract },
    { data: encode('transfer(address,uint256)', [to, 456]), contract },
  ]) {
    const display = resolveAssetTransferDisplay({ ...input, transfer });
    assert.equal(display?.standard, 'Unknown');
    assert.equal(display?.standardVerified, false);
    assert.equal(display?.items[0]?.symbol, null);
  }
  assert.equal(resolveAssetTransferDisplay({ data: `${data}00`, contract, transfer }), null);
});

test('malformed or conflicting optional metadata never replaces exact raw values', () => {
  const data = encode('transfer(address,uint256)', [to, 123]);
  const transfer = decodeAssetTransfer(data, contract)!;
  const invalid = { ...transfer, standard: 'ERC-20' as const, standardVerified: true,
    token: { contractAddress: contract, name: 'Broken token', symbol: 'TOK', decimals: 256 } };
  const display = resolveAssetTransferDisplay({ data, contract, transfer: invalid });
  assert.equal(display?.items[0]?.value, '123');
  assert.equal(display?.standardVerified, false);
  const conflict = { ...transfer, standard: 'ERC-721' as const, standardVerified: true };
  assert.equal(resolveAssetTransferDisplay({ data, contract, transfer: conflict })?.standard, 'Unknown');
});
