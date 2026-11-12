import assert from 'node:assert/strict';
import test from 'node:test';
import { findRetainedSignerAccount } from '../src/custody/sharedSignedRecords.ts';
import type { NativeAccountType } from '../src/custody/accountIdentity.ts';

const address = '0x1111111111111111111111111111111111111111';
const account = (type: NativeAccountType, index: number) => ({ type, index, slip44: 60, address });

for (const type of ['Ledger', 'Trezor', 'Imported'] as const) {
  test(`retained ${type} signer wins over an earlier software address alias`, () => {
    const software = account('HDAccount', 0), original = account(type, 3);
    assert.equal(findRetainedSignerAccount([software, original], { from: address, signer: { type, id: 3 } }), original);
    assert.equal(findRetainedSignerAccount([original, software], { from: address, signer: { type, id: 3 } }), original);
    assert.equal(findRetainedSignerAccount([software, account(type, 4)], { from: address, signer: { type, id: 3 } }), undefined,
      'a missing original signer must not fall back to any address alias');
    assert.equal(findRetainedSignerAccount([{ ...original, address: '0x2222222222222222222222222222222222222222' }],
      { from: address, signer: { type, id: 3 } }), undefined, 'the retained signer must still match its address');
  });
}
