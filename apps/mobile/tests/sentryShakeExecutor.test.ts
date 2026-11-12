import assert from 'node:assert/strict';
import test from 'node:test';
import { createSentryShakeExecutor, type NativeSentryKeyFactory } from '../src/crypto/sentryShakeExecutor.ts';
import { createSentryPublicKeyDeriver } from '../src/crypto/sentryPublicKeyExecutor.ts';
import { qualifyNativeSentryShake } from '../qualification/native-sentry-shake.ts';
import { isSentryKeyValidationBusy } from '../src/core/sentryKeyValidation.ts';

const scheme = 'slh-dsa-shake-128s' as const;
const invalid = { message: 'SENTRY_SHAKE_VALIDATION_FAILED' };
type ImportedKey = Awaited<ReturnType<NativeSentryKeyFactory['createPrivateKeyAsync']>>;

function nativeFactory(validate: (input: ArrayBuffer) => Promise<Uint8Array>, options: {
  derive?: () => void; export?: () => void; disposePublic?: () => void;
} = {}) {
  const keys = new WeakMap<ImportedKey, Uint8Array>();
  const disposed: string[] = [];
  let imports = 0, derivations = 0;
  const factory: NativeSentryKeyFactory = {
    createPrivateKeyAsync(input) {
      assert.equal(this, factory);
      assert.equal(input.asymmetricKeyType, scheme);
      assert.equal(input.format, 'raw-private');
      imports++;
      // Call immediately: native import must snapshot before the caller wipes.
      return validate(input.key).then(bytes => {
        const key = { handle: { dispose() { disposed.push('private'); keys.delete(key); } } };
        keys.set(key, bytes);
        return key;
      });
    },
    createPublicKey(key) {
      assert.equal(this, factory); derivations++;
      options.derive?.();
      const bytes = keys.get(key); assert(bytes);
      return {
        handle: { dispose() { disposed.push('public'); options.disposePublic?.(); } },
        export(input) { assert.deepEqual(input, { format: 'raw-public' }); options.export?.(); return bytes; },
      };
    },
  };
  return { factory, disposed, imports: () => imports, derivations: () => derivations };
}

test('qualification exercises production import and drains retired input and key handles before reuse', async () => {
  const pending = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const expected = '37373737373737373737373737373737df7468cb62f0ff4e6ec27cbe18019216';
  let calls = 0, copied: Uint8Array | undefined, settled = false;
  const f = nativeFactory(input => {
    const owned = new Uint8Array(input).slice(); calls++;
    assert(owned.subarray(0, 48).every(value => value === 0x37));
    if (calls === 2) { owned.fill(0); return Promise.reject(new Error('corrupted root')); }
    const finish = () => { owned.fill(0); return Uint8Array.from(Buffer.from(expected, 'hex')); };
    if (calls === 3) { copied = owned; entered.resolve(); return pending.promise.then(finish); }
    return Promise.resolve(finish());
  });
  const derive = createSentryPublicKeyDeriver(async () => createSentryShakeExecutor(f.factory));
  const work = qualifyNativeSentryShake(new AbortController().signal, derive).finally(() => { settled = true; });
  await entered.promise; await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert(copied?.some(value => value !== 0));
  pending.resolve(); assert.equal(await work, derive);
  assert(copied?.every(value => value === 0)); assert.equal(calls, 4);
  assert.deepEqual(f.disposed, ['public', 'private', 'private', 'public', 'private']);
});

test('qualification cannot complete when the production import port is unavailable', async () => {
  const derive = createSentryPublicKeyDeriver(async () => { throw new Error('SENTRY_SHAKE_UNAVAILABLE'); });
  await assert.rejects(qualifyNativeSentryShake(new AbortController().signal, derive), { message: 'SENTRY_PUBLIC_KEY_VALIDATION_FAILED' });
});

test('only the qualified factories and one complete SHAKE key reach native import', async () => {
  for (const value of [{}, { createPrivateKeyAsync() {} }, { createPublicKey() {} }])
    assert.throws(() => createSentryShakeExecutor(value as never), { message: 'SENTRY_SHAKE_UNAVAILABLE' });
  const f = nativeFactory(async input => {
    assert.equal(input.byteLength, 64);
    return Uint8Array.from({ length: 32 }, () => 0x19);
  });
  const derive = createSentryShakeExecutor(f.factory), owner = new AbortController();
  await assert.rejects(derive('collateral', scheme, new Uint8Array(64), owner.signal), invalid);
  await assert.rejects(derive('operator', 'bls-basic', new Uint8Array(32), owner.signal), invalid);
  await assert.rejects(derive('operator', scheme, new Uint8Array(63), owner.signal), invalid);
  await assert.rejects(derive('operator', scheme, new Uint8Array(65).subarray(1), owner.signal), invalid);
  await assert.rejects(derive('operator', scheme, new Uint8Array(65).subarray(0, 64), owner.signal), invalid);
  const forged = Object.create(Uint8Array.prototype);
  Object.defineProperties(forged, {
    byteLength: { get() { assert.fail('input length getter must not run'); } },
    buffer: { get() { assert.fail('input buffer getter must not run'); } },
  });
  await assert.rejects(derive('operator', scheme, forged, owner.signal), invalid);
  assert.equal(f.imports(), 0);
  assert.equal(await derive('operator', scheme, new Uint8Array(64), owner.signal), '19'.repeat(32));
  assert.equal(f.imports(), 1); assert.deepEqual(f.disposed, ['public', 'private']);
});

test('retirement awaits the native copy, then disposes the resulting private handle without deriving', async () => {
  const pending = Promise.withResolvers<Uint8Array>();
  let copied: Uint8Array<ArrayBuffer> | undefined;
  const f = nativeFactory(input => { copied = new Uint8Array(input).slice(); return pending.promise; });
  const derive = createSentryShakeExecutor(f.factory), owner = new AbortController();
  const bytes = new Uint8Array(64).fill(0x42);
  let settled = false;
  const work = derive('voting', scheme, bytes, owner.signal).finally(() => { settled = true; });
  const retired = assert.rejects(work, { message: 'CANCELLED' });
  assert(copied); bytes.fill(0); assert(copied.every(value => value === 0x42)); owner.abort();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.deepEqual(f.disposed, []);
  copied.fill(0); pending.resolve(new Uint8Array(32)); await retired;
  assert.equal(f.derivations(), 0); assert.deepEqual(f.disposed, ['private']);
});

for (const stage of ['derive', 'export', 'disposePublic'] as const)
  test(`private handles are released after ${stage} failure without leaking diagnostics`, async () => {
    const f = nativeFactory(async () => new Uint8Array(32), { [stage]: () => { throw Error('private diagnostic'); } });
    await assert.rejects(createSentryShakeExecutor(f.factory)('owner', scheme, new Uint8Array(64), new AbortController().signal), invalid);
    assert.deepEqual(f.disposed, stage === 'derive' ? ['private'] : ['public', 'private']);
  });

test('retirement during public derivation still releases both handles and withholds the result', async () => {
  const owner = new AbortController();
  const f = nativeFactory(async () => new Uint8Array(32), { export: () => owner.abort() });
  await assert.rejects(createSentryShakeExecutor(f.factory)('owner', scheme, new Uint8Array(64), owner.signal), { message: 'CANCELLED' });
  assert.deepEqual(f.disposed, ['public', 'private']);
});

test('forged and incorrectly sized public exports are rejected while both handles are disposed', async () => {
  let getters = 0;
  const forged = Object.create(Uint8Array.prototype);
  Object.defineProperty(forged, 'byteLength', { get() { getters++; return 32; } });
  for (const value of [forged, new Uint8Array(31), new ArrayBuffer(32)]) {
    const f = nativeFactory(async () => value as Uint8Array);
    await assert.rejects(createSentryShakeExecutor(f.factory)('owner', scheme, new Uint8Array(64), new AbortController().signal), invalid);
    assert.deepEqual(f.disposed, ['public', 'private']);
  }
  assert.equal(getters, 0);
});

test('a public Buffer view is exported by its visible bytes without requiring a private-sized backing allocation', async () => {
  const f = nativeFactory(async () => new Uint8Array(64).fill(0x18).subarray(7, 39));
  assert.equal(await createSentryShakeExecutor(f.factory)('owner', scheme, new Uint8Array(64), new AbortController().signal), '18'.repeat(32));
  assert.deepEqual(f.disposed, ['public', 'private']);
});

test('native admission busy remains an owned transient error and cancellation takes precedence', async () => {
  for (const aborted of [false, true]) {
    const owner = new AbortController();
    const f = nativeFactory(async () => { if (aborted) owner.abort(); throw Error('SLH-DSA raw private key import busy'); });
    await assert.rejects(createSentryShakeExecutor(f.factory)('owner', scheme, new Uint8Array(64), owner.signal), error =>
      aborted ? error instanceof Error && error.message === 'CANCELLED' : isSentryKeyValidationBusy(error));
    assert.deepEqual(f.disposed, []);
  }
});
