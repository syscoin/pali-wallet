import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeOperationDrain } from '../src/custody/operationDrain.ts';

test('operation drain revokes synchronously, denies new work and joins nested operations', async () => {
  const drain = new NativeOperationDrain();
  const finishOuter = drain.begin(),
    finishInner = drain.begin();
  let revoked = false,
    completed = false;
  const closing = drain.close(() => {
    revoked = true;
  }, []);
  assert.equal(revoked, true);
  assert.throws(() => drain.begin(), /NATIVE_OPERATION_CLOSED/);
  void closing.then(() => {
    completed = true;
  });
  finishInner();
  await Promise.resolve();
  assert.equal(completed, false);
  finishOuter();
  await closing;
  assert.equal(completed, true);
  assert.equal(
    drain.close(() => assert.fail('Retired twice'), []),
    closing
  );
});

test('operation drain reserves close before reentrant retirement and cleanup', async () => {
  const drain = new NativeOperationDrain();
  let inner!: Promise<void>;
  const closing = drain.close(() => {
    inner = drain.close(() => assert.fail('Recursive retire'), []);
  }, [() => drain.close(() => assert.fail('Recursive cleanup'), [])]);
  assert.equal(inner, closing);
  await closing;
});

test('cleanup failure still starts every cleanup and drains active work', async () => {
  const drain = new NativeOperationDrain();
  const finish = drain.begin();
  const events: string[] = [];
  let rejected = false;
  const closing = drain.close(() => {
    events.push('retire');
  }, [
    () => {
      events.push('failed');
      throw Error('cleanup failed');
    },
    () => {
      events.push('last');
    },
  ]);
  const failure = assert.rejects(closing, /cleanup failed/).then(() => {
    rejected = true;
  });
  assert.deepEqual(events, ['retire', 'failed', 'last']);
  await Promise.resolve();
  assert.equal(rejected, false);
  finish();
  await failure;
});
