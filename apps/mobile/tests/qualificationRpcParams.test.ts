import assert from 'node:assert/strict';
import test from 'node:test';
import { sameJsonRpcParameters } from '../qualification/rpc-parameters.ts';

test('qualification compares exact JSON values independently of object key order', () => {
  const expected = [{ type: '0x2', nonce: '0x0', accessList: [] }, 'pending'];
  assert(sameJsonRpcParameters([{ accessList: [], nonce: '0x0', type: '0x2' }, 'pending'], expected));
  assert(!sameJsonRpcParameters([{ type: '0x2', nonce: '0x1', accessList: [] }, 'pending'], expected));
  assert(!sameJsonRpcParameters([{ type: '0x2', nonce: '0x0', accessList: [], gas: '0x1' }, 'pending'], expected));
  assert(!sameJsonRpcParameters(['pending', expected[0]], expected));
  assert(!sameJsonRpcParameters([{ type: '0x2', nonce: '0x0' }, 'pending'], expected));
});
