import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeAccountId, parseNativeAccountId } from '../src/custody/accountIdentity.ts';

for (const type of ['HDAccount', 'Imported'] as const) test(`${type} preserves exact canonical SDK account IDs above the old mobile cap`, () => {
  for (const index of [0, 4095, 4096, 2147483647, Number.MAX_SAFE_INTEGER]) {
    const id = nativeAccountId(type, index);
    assert.deepEqual(parseNativeAccountId(id), {id, type, index, slip44: 60});
  }
  for (const index of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => nativeAccountId(type, index));
});
test('account ID parsing rejects lossy numbers and noncanonical spellings', () => {
  for (const id of ['hd:60:00','hd:60:01','hd:60:9007199254740992','hd:60:1e3','hd:60:1.0','hd:60:-1','imported:1:4096','HDAccount:60:4096','imported:60:999999999999999999999']) assert.throws(() => parseNativeAccountId(id));
});


test('HD identity separates Bitcoin, Syscoin, testnet and EVM account zero', () => {
  for (const slip44 of [0, 1, 57, 60]) {
    const id = nativeAccountId('HDAccount', 0, slip44);
    assert.equal(id, `hd:${slip44}:0`);
    assert.deepEqual(parseNativeAccountId(id), { id, type: 'HDAccount', index: 0, slip44 });
  }
  assert.throws(() => parseNativeAccountId('hd:00:0'));
  assert.throws(() => parseNativeAccountId('imported:0:0'));
});
