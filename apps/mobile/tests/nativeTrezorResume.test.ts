import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction, Wallet } from 'ethers';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { encodeNftTransferData } from '../../../source/shared/nftTransfer.ts';
import { trezorResumeDraft } from '../src/screens/trezorResumeDraft.ts';
import type { NativeTrezorResumeIntent } from '../src/custody/trezorAccounts.ts';
import { AUTOMATIC_FEE } from '../../../source/shared/transactionFeeChoice.ts';

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
    feeChoice: { kind: 'custom', type: 2, maxFeePerGas: '9', maxPriorityFeePerGas: '1', gasLimit: '50000' },
  } });
});

test('Trezor token resume keeps 255-decimal precision without ethers formatUnits', () => {
  const intent = { kind: 'erc20-transfer' as const, chainId: '1', recipient,
    amountUnits: '1', token: { contractAddress: tokenAddress, name: 'Precise', symbol: 'P', decimals: 255 } };
  const result = trezorResumeDraft({ ...scope, kind: 'evm', intent,
    unsignedTransaction: wire({ to: tokenAddress, value: 0, data: encodeErc20Transfer(recipient, '1') }) });
  assert.equal(result.kind, 'token');
  assert.equal(result.draft.amount, '0.' + '0'.repeat(254) + '1');
  assert.deepEqual(result.draft.feeChoice, { kind: 'custom', type: 2, maxFeePerGas: '9', maxPriorityFeePerGas: '1', gasLimit: '50000' });
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
  assert.deepEqual(result.draft.feeChoice, { kind: 'custom', type: 2, maxFeePerGas: '9', maxPriorityFeePerGas: '1', gasLimit: '50000' });
});

test('Trezor resume refuses signed bytes and a mismatched asset interpretation', async () => {
  const signed = await sender.signTransaction(Transaction.from(wire()).toJSON());
  assert.throws(() => trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: signed }));
  const intent = { kind: 'erc20-transfer' as const, chainId: '1', recipient,
    amountUnits: '1', token: { contractAddress: tokenAddress, name: 'Token', symbol: 'T', decimals: 18 } };
  assert.throws(() => trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire(), intent }));
});

test('Trezor replacement and UTXO drafts retain the corresponding normal review path', () => {
  const replacement = { operation: 'speed-up' as const, originalHash: '0x' + 'ab'.repeat(32) };
  const evm = trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire(), replacement });
  assert.equal(evm.kind, 'replacement');
  if (evm.kind === 'replacement') assert.deepEqual(evm.replacement, replacement);
  const utxo: NativeTrezorResumeIntent = { ...scope, kind: 'utxo', recipient: 'public-utxo-address',
    amount: '0.00000001', max: false, feeChoice: AUTOMATIC_FEE };
  assert.deepEqual(trezorResumeDraft(utxo), { kind: 'utxo', asset: undefined,
    draft: { recipient: utxo.recipient, amount: utxo.amount, max: false, rbf: true, feeChoice: AUTOMATIC_FEE } });
  const retainedOption = trezorResumeDraft({ ...utxo, rbf: false });
  assert.equal(retainedOption.kind, 'utxo');
  if (retainedOption.kind === 'utxo') assert.equal(retainedOption.draft.rbf, false);
});

test('Trezor legacy gas and UTXO custom fee snapshots remain exact and independent', () => {
  const legacy = trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire({ type: 0,
    gasPrice: 7, maxFeePerGas: null, maxPriorityFeePerGas: null, gasLimit: 65000 }) });
  assert.deepEqual(legacy.draft.feeChoice, { kind: 'custom', type: 0, gasPrice: '7', gasLimit: '65000' });
  const feeChoice = { kind: 'custom' as const, satPerVbyte: '7' };
  const input = { ...scope, kind: 'utxo' as const, recipient: 'public-utxo-address', amount: '', max: true, rbf: false, feeChoice };
  const resumed = trezorResumeDraft(input);
  feeChoice.satPerVbyte = '8';
  assert.equal(resumed.kind, 'utxo');
  assert.deepEqual(resumed.draft, { recipient: input.recipient, amount: '', max: true, rbf: false,
    feeChoice: { kind: 'custom', satPerVbyte: '7' } });
  assert.throws(() => trezorResumeDraft({ ...input, feeChoice: { kind: 'custom', satPerVbyte: '0' } }));
  const { feeChoice: _feeChoice, ...missing } = input;
  assert.throws(() => trezorResumeDraft(missing as NativeTrezorResumeIntent), /Invalid Trezor resume fees/);
  assert.throws(() => trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire({ gasLimit: 0 }) }));
  assert.throws(() => trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction: wire({ maxFeePerGas: 0, maxPriorityFeePerGas: 0 }) }));
});

test('Smart operation resume IDs cannot be interpreted as a transfer draft', () => {
  const resume: NativeTrezorResumeIntent = Object.freeze({...scope, kind: 'smart-operation'});
  assert.throws(() => trezorResumeDraft(resume), /fresh operation review/);
  assert.deepEqual(Object.keys(resume).sort(), ['accountId', 'id', 'kind', 'networkId']);
});

test('infrastructure resume IDs require their original setup route and cannot become ordinary transfer drafts', () => {
  const resume: NativeTrezorResumeIntent = Object.freeze({ ...scope, kind: 'infrastructure' });
  assert.throws(() => trezorResumeDraft(resume), /original setup review/);
  assert.deepEqual(Object.keys(resume).sort(), ['accountId', 'id', 'kind', 'networkId']);
});

for (const type of [0, 2] as const) {
  for (const creation of [false, true]) {
    test(`Trezor type ${type} ${creation ? 'creation' : 'contract call'} replacement refills a fresh retained-hash review`, () => {
      const unsignedTransaction = wire({ to: creation ? null : recipient, data: '0x6001600055',
        ...(type === 0 ? { type, gasPrice: 7, maxFeePerGas: null, maxPriorityFeePerGas: null } : {}) });
      const replacement = { operation: 'speed-up' as const, originalHash: '0x' + 'ab'.repeat(32) };
      const input = { ...scope, kind: 'evm' as const, unsignedTransaction, replacement };
      const result = trezorResumeDraft(input);
      assert.equal(result.kind, 'replacement');
      if (result.kind !== 'replacement') return;
      assert.deepEqual(result.replacement, replacement);
      assert.equal(result.draft.recipient, creation ? '' : recipient);
      assert.equal(result.draft.amount, '1.000000000000000001');
      assert.equal(result.draft.nonce, '7');
      assert.deepEqual(result.draft.feeChoice, type === 0
        ? { kind: 'custom', type: 0, gasPrice: '7', gasLimit: '50000' }
        : { kind: 'custom', type: 2, maxFeePerGas: '9', maxPriorityFeePerGas: '1', gasLimit: '50000' });
      assert.equal(input.unsignedTransaction, unsignedTransaction);
      assert.equal(Object.isFrozen(result.replacement), true);
      replacement.originalHash = '0x' + 'cd'.repeat(32);
      assert.equal(result.replacement.originalHash, '0x' + 'ab'.repeat(32));
      assert.throws(() => trezorResumeDraft({ ...scope, kind: 'evm', unsignedTransaction }));
    });
  }
}

test('Trezor replacement resume preserves saved cancellation and rejects invalid routing or envelope data', async () => {
  const replacement = { operation: 'cancel-saved' as const, originalHash: '0x' + 'ab'.repeat(32) };
  const input = { ...scope, kind: 'evm' as const, unsignedTransaction: wire({ to: sender.address, value: 0 }), replacement };
  const resumed = trezorResumeDraft(input);
  assert.equal(resumed.kind, 'replacement');
  if (resumed.kind === 'replacement') assert.deepEqual(resumed.replacement, replacement);
  for (const invalid of [
    { ...replacement, operation: 'send' },
    { mode: 'cancel', originalHash: replacement.originalHash },
    { ...replacement, originalHash: '0x1234' },
    { ...replacement, originalHash: null },
  ]) assert.throws(() => trezorResumeDraft({ ...input, replacement: invalid } as NativeTrezorResumeIntent));
  for (const unsignedTransaction of [wire({ chainId: 0 }), wire({ type: 1, gasPrice: 7, maxFeePerGas: null, maxPriorityFeePerGas: null }),
    wire({ gasLimit: 0 }), wire({ maxFeePerGas: 0, maxPriorityFeePerGas: 0 })])
    assert.throws(() => trezorResumeDraft({ ...input, unsignedTransaction }));
  const signed = await sender.signTransaction(Transaction.from(wire()).toJSON());
  assert.throws(() => trezorResumeDraft({ ...input, unsignedTransaction: signed }));
  const intent = { kind: 'erc20-transfer' as const, chainId: '1', recipient, amountUnits: '1',
    token: { contractAddress: tokenAddress, name: 'Token', symbol: 'T', decimals: 18 } };
  assert.throws(() => trezorResumeDraft({ ...input, intent }));
});
