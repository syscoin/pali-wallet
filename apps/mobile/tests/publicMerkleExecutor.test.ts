import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicMerkleExecutor } from '../src/crypto/publicMerkleExecutor.ts';

test('the executor captures the native capability and receiver', async () => {
  const result = new Uint8Array(32);
  const module = {
    calls: 0,
    async publicMerkleBatch() { this.calls++; return result; },
  };
  const execute = createPublicMerkleExecutor(module);
  module.publicMerkleBatch = async () => { throw new Error('replaced'); };
  assert.equal(await execute(new Uint8Array(3), new AbortController().signal, () => {}), result);
  assert.equal(module.calls, 1);
});

test('a cancelled native operation drains before its result is rejected', async () => {
  let finish!: (value: Uint8Array) => void;
  const native = new Promise<Uint8Array>(resolve => { finish = resolve; });
  const execute = createPublicMerkleExecutor({ publicMerkleBatch: () => native });
  const owner = new AbortController();
  let settled = false;
  const result = execute(new Uint8Array(3), owner.signal, () => {});
  void result.then(() => { settled = true; }, () => { settled = true; });
  owner.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  finish(new Uint8Array(32));
  await assert.rejects(result, { message: 'privacy_cancelled' });
});

test('an asynchronous owner check never dispatches native work', async () => {
  let calls = 0;
  const execute = createPublicMerkleExecutor({ async publicMerkleBatch() { calls++; return new Uint8Array(32); } });
  await assert.rejects(execute(new Uint8Array(3), new AbortController().signal, async () => {
    throw new Error('retired');
  }), { message: 'privacy_cancelled' });
  assert.equal(calls, 0);
});
