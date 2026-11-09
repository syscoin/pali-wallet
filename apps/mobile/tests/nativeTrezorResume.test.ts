import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction, Wallet } from 'ethers';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { encodeNftTransferData } from '../../../source/shared/nftTransfer.ts';
import { trezorResumeDraft } from '../src/screens/trezorResumeDraft.ts';
import type { NativeTrezorResumeIntent } from '../src/custody/trezorAccounts.ts';

const recipient = '0x2222222222222222222222222222222222222222';
const tokenAddress = '0x3333333333333333333333333333333333333333';
const sender = new Wallet('0x' + '11'.repeat(32));
const scope = { id: 'public-request', accountId: 'Trezor:0', networkId: 'ethereum' };
const wire = (overrides: object = {}) => Transaction.from({
  type: 2, chainId: 1, nonce: 7, gasLimit: 50_000, maxFeePerGas: 9,
  maxPriorityFeePerGas: 1, to: recipient, value: 1_000_000_000_000_000_001n,
  ...overrides,
}).unsignedSerialized;

test('Trezor resume refills exact native units and the original nonce for fresh review', () => {
  const result = trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire() });
  assert.deepEqual(result, { kind: 'native', draft: {
    recipient, amount: '1.000000000000000001', tokenId: undefined, nonce: '7',
  } });
});

test('Trezor token resume keeps 255-decimal precision without ethers formatUnits', () => {
  const intent = { kind: 'erc20-transfer' as const, chainId: '1', recipient,
    amountUnits: '1', token: { contractAddress: tokenAddress, name: 'Precise', symbol: 'P', decimals: 255 } };
  const result = trezorResumeDraft({ ...scope, kind: 'evm', intent,
    unsignedTransaction: wire({ to: tokenAddress, value: 0, data: encodeErc20Transfer(recipient, '1') }) });
  assert.equal(result.kind, 'token');
  assert.equal(result.draft.amount, '0.' + '0'.repeat(254) + '1');
});

test('Trezor NFT resume retains ID and integer quantity for fresh ownership checks', () => {
  const intent = { kind: 'nft-transfer' as const, chainId: '1', contractAddress: tokenAddress,
    from: sender.address, recipient, tokenStandard: 'ERC-1155' as const, tokenId: '123',
    amountUnits: '9007199254740993' };
  const result = trezorResumeDraft({ ...scope, kind: 'evm', intent,
    unsignedTransaction: wire({ to: tokenAddress, value: 0, data: encodeNftTransferData(intent) }) });
  assert.equal(result.kind, 'collectible');
  assert.equal(result.draft.amount, intent.amountUnits);
  assert.equal(result.draft.tokenId, '123');
});

test('Trezor resume refuses signed bytes and a mismatched asset interpretation', async () => {
  const signed = await sender.signTransaction(Transaction.from(wire()).toJSON());
  assert.throws(() => trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: signed }));
  const intent = { kind: 'erc20-transfer' as const, chainId: '1', recipient,
    amountUnits: '1', token: { contractAddress: tokenAddress, name: 'Token', symbol: 'T', decimals: 18 } };
  assert.throws(() => trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire(), intent }));
});

test('Trezor replacement and UTXO drafts retain the corresponding normal review path', () => {
  const replacement = { mode: 'speed-up' as const, originalHash: '0x' + 'ab'.repeat(32) };
  const evm = trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire(), replacement });
  assert.equal(evm.kind, 'replacement');
  if (evm.kind === 'replacement') assert.deepEqual(evm.replacement, replacement);
  const utxo: NativeTrezorResumeIntent = { ...scope, kind: 'utxo', recipient: 'public-utxo-address',
    amount: '0.00000001', max: false };
  assert.deepEqual(trezorResumeDraft(utxo), { kind: 'utxo', asset: undefined,
    draft: { recipient: utxo.recipient, amount: utxo.amount, max: false, rbf: true } });
  const retainedOption = trezorResumeDraft({ ...utxo, rbf: false });
  assert.equal(retainedOption.kind, 'utxo');
  if (retainedOption.kind === 'utxo') assert.equal(retainedOption.draft.rbf, false);
});
