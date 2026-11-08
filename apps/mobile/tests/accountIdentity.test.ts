import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeAccountId, parseNativeAccountId } from '../src/custody/accountIdentity.ts';

for (const type of ['HDAccount', 'Imported', 'Trezor'] as const) test(`${type} preserves exact canonical SDK account IDs above the old mobile cap`, () => {
  for (const index of [0, 4095, 4096, 2147483647, Number.MAX_SAFE_INTEGER]) {
    const id = nativeAccountId(type, index);
    assert.deepEqual(parseNativeAccountId(id), {id, type, index, slip44: 60});
  }
  for (const index of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => nativeAccountId(type, index));
});
test('account ID parsing rejects lossy numbers and noncanonical spellings', () => {
  for (const id of ['hd:60:00','hd:60:01','hd:60:9007199254740992','hd:60:1e3','hd:60:1.0','hd:60:-1','imported:01:4096','imported:1:04096','imported:9007199254740992:0','HDAccount:60:4096','imported:60:999999999999999999999']) assert.throws(() => parseNativeAccountId(id));
});

test('account IDs separate HD and imported identities across Bitcoin, Syscoin, testnet and EVM', () => {
  for (const [type, prefix] of [['HDAccount', 'hd'], ['Imported', 'imported'], ['Trezor', 'trezor']] as const) {
    for (const slip44 of [0, 1, 57, 60]) {
      for (const index of [0, 4096]) {
        const id = nativeAccountId(type, index, slip44);
        assert.equal(id, `${prefix}:${slip44}:${index}`);
        assert.deepEqual(parseNativeAccountId(id), { id, type, index, slip44 });
      }
    }
  }
  assert.throws(() => parseNativeAccountId('hd:00:0'));
});
