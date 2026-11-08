import assert from 'node:assert/strict';
import test from 'node:test';
import { createSentryShakeExecutor } from '../src/crypto/sentryShakeExecutor.ts';

const scheme = 'slh-dsa-shake-128s' as const;
const invalid = { message: 'SENTRY_SHAKE_VALIDATION_FAILED' };

test('only a registered native method and a whole SHAKE key reach validation', async () => {
  assert.throws(() => createSentryShakeExecutor({} as never), {
    message: 'SENTRY_SHAKE_UNAVAILABLE',
  });
  let calls = 0;
  const native = {
    async validateSentryShake128sKey(buffer: ArrayBuffer) {
      assert.equal(this, native);
      assert.equal(buffer.byteLength, 64);
      calls++;
      return Uint8Array.from({ length: 32 }, () => 0x19).buffer;
    },
  };
  const derive = createSentryShakeExecutor(native);
  const owner = new AbortController();
  await assert.rejects(
    derive('collateral', scheme, new Uint8Array(64), owner.signal),
    invalid
  );
  await assert.rejects(
    derive('operator', 'bls-basic', new Uint8Array(32), owner.signal),
    invalid
  );
  await assert.rejects(
    derive('operator', scheme, new Uint8Array(63), owner.signal),
    invalid
  );
  await assert.rejects(
    derive('operator', scheme, new Uint8Array(65).subarray(1), owner.signal),
    invalid
  );
  await assert.rejects(
    derive(
      'operator',
      scheme,
      new Uint8Array(65).subarray(0, 64),
      owner.signal
    ),
    invalid
  );
  assert.equal(calls, 0);
  assert.equal(
    await derive('operator', scheme, new Uint8Array(64), owner.signal),
    '19'.repeat(32)
  );
  assert.equal(calls, 1);
});

test('retirement drops the result only after the synchronous native copy drains', async () => {
  const pending = Promise.withResolvers<ArrayBuffer>();
  let copied: Uint8Array<ArrayBuffer> | undefined;
  const derive = createSentryShakeExecutor({
    validateSentryShake128sKey(input) {
      copied = new Uint8Array(input).slice();
      return pending.promise;
    },
  });
  const owner = new AbortController();
  const bytes = new Uint8Array(64).fill(0x42);
  let settled = false;
  const work = derive('voting', scheme, bytes, owner.signal).finally(() => {
    settled = true;
  });
  const retired = assert.rejects(work, { message: 'CANCELLED' });
  assert(copied);
  bytes.fill(0);
  assert(copied.every((value) => value === 0x42));
  owner.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  copied.fill(0);
  pending.resolve(new ArrayBuffer(32));
  await retired;
  assert.equal(settled, true);
});

test('forged output does not become a public key or expose an exception payload', async () => {
  let getterCalls = 0;
  const forged = Object.create(ArrayBuffer.prototype);
  Object.defineProperty(forged, 'byteLength', {
    get() {
      getterCalls++;
      return 32;
    },
  });
  for (const result of [forged, new ArrayBuffer(31), new Uint8Array(32)]) {
    const derive = createSentryShakeExecutor({
      async validateSentryShake128sKey() {
        return result;
      },
    });
    await assert.rejects(
      derive('owner', scheme, new Uint8Array(64), new AbortController().signal),
      invalid
    );
  }
  assert.equal(getterCalls, 0);
});
