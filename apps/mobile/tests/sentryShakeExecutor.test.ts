import assert from 'node:assert/strict';
import test from 'node:test';
import { createSentryShakeExecutor } from '../src/crypto/sentryShakeExecutor.ts';
import { createSentryPublicKeyDeriver } from '../src/crypto/sentryPublicKeyExecutor.ts';
import { qualifyNativeSentryShake } from '../qualification/native-sentry-shake.ts';

const scheme = 'slh-dsa-shake-128s' as const;
const invalid = { message: 'SENTRY_SHAKE_VALIDATION_FAILED' };

test('qualification exercises the production wrapper and drains its retired native vector before reuse', async () => {
  const pending = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const expected = '37373737373737373737373737373737df7468cb62f0ff4e6ec27cbe18019216';
  let calls = 0, copied: Uint8Array | undefined, settled = false;
  const executor = createSentryShakeExecutor(class {
    validateRawPrivateKey(input: ArrayBuffer): Promise<ArrayBuffer> {
      const owned = new Uint8Array(input).slice();
      calls++;
      assert(owned.subarray(0, 48).every(value => value === 0x37));
      if (calls === 2) { owned.fill(0); return Promise.reject(new Error('corrupted root')); }
      const finish = () => { owned.fill(0); return Uint8Array.from(Buffer.from(expected, 'hex')).buffer; };
      if (calls === 3) { copied = owned; entered.resolve(); return pending.promise.then(finish); }
      return Promise.resolve(finish());
    }
  });
  const derive = createSentryPublicKeyDeriver(async () => executor);
  const work = qualifyNativeSentryShake(new AbortController().signal, derive).finally(() => { settled = true; });
  await entered.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert(copied?.some(value => value !== 0));
  pending.resolve();
  assert.equal(await work, derive);
  assert(copied?.every(value => value === 0));
  assert.equal(calls, 4);
});

test('qualification cannot complete when the production validator port is unavailable', async () => {
  const derive = createSentryPublicKeyDeriver(async () => { throw new Error('SENTRY_SHAKE_UNAVAILABLE'); });
  await assert.rejects(qualifyNativeSentryShake(new AbortController().signal, derive), { message: 'SENTRY_PUBLIC_KEY_VALIDATION_FAILED' });
});

test('only the public fixed-variant validator and a whole SHAKE key reach validation', async () => {
  assert.throws(() => createSentryShakeExecutor({} as never), {
    message: 'SENTRY_SHAKE_UNAVAILABLE',
  });
  assert.throws(() => createSentryShakeExecutor(class {} as never), {
    message: 'SENTRY_SHAKE_UNAVAILABLE',
  });
  assert.throws(
    () =>
      createSentryShakeExecutor(
        class {
          constructor() {
            throw new Error('native constructor details');
          }
        } as never
      ),
    { message: 'SENTRY_SHAKE_UNAVAILABLE' }
  );
  let calls = 0;
  let instance: NativeSlhDsa;
  class NativeSlhDsa {
    constructor(variant: 'SLH-DSA-SHAKE-128s') {
      assert.equal(variant, 'SLH-DSA-SHAKE-128s');
      instance = this;
    }
    async validateRawPrivateKey(buffer: ArrayBuffer) {
      assert.equal(this, instance);
      assert.equal(buffer.byteLength, 64);
      calls++;
      return Uint8Array.from({ length: 32 }, () => 0x19).buffer;
    }
  }
  const derive = createSentryShakeExecutor(NativeSlhDsa);
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
  const derive = createSentryShakeExecutor(
    class {
      validateRawPrivateKey(input: ArrayBuffer) {
        copied = new Uint8Array(input).slice();
        return pending.promise;
      }
    }
  );
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
    const derive = createSentryShakeExecutor(
      class {
        async validateRawPrivateKey() {
          return result;
        }
      }
    );
    await assert.rejects(
      derive('owner', scheme, new Uint8Array(64), new AbortController().signal),
      invalid
    );
  }
  assert.equal(getterCalls, 0);
});
