import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import { createSentryPublicKeyDeriver } from '../src/crypto/sentryPublicKeyExecutor.ts';
import { createSentryClassicalExecutor } from '../src/crypto/sentryClassicalExecutor.ts';
import type { DeriveSentryPublicKey } from '../src/custody/sentryKeyManagement.ts';
import { sentryKeyValidationBusy } from '../src/core/sentryKeyValidation.ts';

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('the lazy production path uses the real shared classical helper after caller erasure', async () => {
  const derive = createSentryPublicKeyDeriver(async () => {
    const { deriveSentryClassicalPublicKey } = await import(
      '@sidhujag/sysweb3-sentry/classical-public-key'
    );
    return createSentryClassicalExecutor(deriveSentryClassicalPublicKey);
  });
  const secret = new Uint8Array(32);
  secret[31] = 2;
  const result = derive(
    'collateral',
    'secp256k1',
    secret,
    new AbortController().signal
  );
  secret.fill(0);
  assert.equal(
    await result,
    '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
  );
});

test('lazy Sentry loading owns the exact borrowed view before the caller erases it', async () => {
  const loading = Promise.withResolvers<DeriveSentryPublicKey>();
  const owner = new AbortController();
  const allocation = new Uint8Array(40).fill(0x99);
  const input = allocation.subarray(4, 36);
  input.fill(0x31);
  let captured: Uint8Array | undefined;
  const derive = createSentryPublicKeyDeriver(async (scheme) => {
    assert.equal(scheme, 'secp256k1');
    return loading.promise;
  });
  const result = derive('owner', 'secp256k1', input, owner.signal);
  input.fill(0);
  loading.resolve(async (role, scheme, bytes) => {
    assert.equal(role, 'owner');
    assert.equal(scheme, 'secp256k1');
    captured = bytes;
    assert.equal(bytes.length, 32);
    assert(bytes.every((value) => value === 0x31));
    return '02' + '11'.repeat(32);
  });
  assert.equal(await result, '02' + '11'.repeat(32));
  assert(captured?.every((value) => value === 0));
  assert.equal(allocation[3], 0x99);
  assert.equal(allocation[36], 0x99);
});

test('retirement during lazy loading prevents private-key execution', async () => {
  const loading = Promise.withResolvers<DeriveSentryPublicKey>();
  const owner = new AbortController();
  let executions = 0;
  const derive = createSentryPublicKeyDeriver(() => loading.promise);
  const result = derive(
    'operator',
    'bls-basic',
    new Uint8Array(32),
    owner.signal
  );
  owner.abort();
  loading.resolve(async () => {
    executions++;
    return 'unreachable';
  });
  await assert.rejects(result, { message: 'CANCELLED' });
  assert.equal(executions, 0);
});

test('retirement drains the selected executor and erases its owned key before settling', async () => {
  const running = Promise.withResolvers<string>();
  const entered = Promise.withResolvers<void>();
  const owner = new AbortController();
  let captured: Uint8Array | undefined;
  const derive = createSentryPublicKeyDeriver(
    async () => async (_role, _scheme, bytes) => {
      captured = bytes;
      entered.resolve();
      return running.promise;
    }
  );
  let settled = false;
  const result = derive(
    'operator',
    'slh-dsa-shake-128s',
    new Uint8Array(64).fill(7),
    owner.signal
  );
  const rejection = assert.rejects(
    result.finally(() => {
      settled = true;
    }),
    { message: 'CANCELLED' }
  );
  await entered.promise;
  owner.abort();
  await nextTurn();
  assert.equal(settled, false);
  assert(captured?.every((value) => value === 7));
  running.resolve('11'.repeat(32));
  await rejection;
  assert(captured?.every((value) => value === 0));
});

test('invalid roles, schemes and key buffers cannot load an executor', async () => {
  let loads = 0;
  const derive = createSentryPublicKeyDeriver(async () => {
    loads++;
    return async () => 'unreachable';
  });
  const owner = new AbortController();
  const cases = [
    ['owner', 'bls-basic', new Uint8Array(32)],
    ['collateral', 'slh-dsa-shake-128s', new Uint8Array(64)],
    ['operator', 'SLH-DSA-SHA2-128-24', new Uint8Array(64)],
    ['operator', 'bls-basic', new Uint8Array(31)],
    ['operator', 'slh-dsa-shake-128s', new Uint8Array(65).subarray(1)],
    ['operator', 'bls-basic', new Uint8Array(new SharedArrayBuffer(32))],
  ] as const;
  for (const [role, scheme, bytes] of cases)
    await assert.rejects(
      derive(role as never, scheme as never, bytes as never, owner.signal),
      { message: 'SENTRY_PUBLIC_KEY_VALIDATION_FAILED' }
    );
  assert.equal(loads, 0);
});

test('private executor errors are redacted and owned input is erased', async () => {
  let captured: Uint8Array | undefined;
  const derive = createSentryPublicKeyDeriver(
    async () => async (_role, _scheme, bytes) => {
      captured = bytes;
      throw new Error('private key diagnostic');
    }
  );
  await assert.rejects(
    derive(
      'voting',
      'secp256k1',
      new Uint8Array(32).fill(8),
      new AbortController().signal
    ),
    { message: 'SENTRY_PUBLIC_KEY_VALIDATION_FAILED' }
  );
  assert(captured?.every((value) => value === 0));
});

test('only an owned busy error survives lazy derivation and cancellation still takes precedence', async () => {
  for (const kind of ['owned', 'forged', 'cancelled'] as const) {
    const owner = new AbortController(), busy = sentryKeyValidationBusy();
    let captured: Uint8Array | undefined;
    const forged = Object.defineProperty(new Error('BUSY'), 'code', { get() { assert.fail('error getter must not run'); } });
    const derive = createSentryPublicKeyDeriver(async () => async (_role, _scheme, input) => {
      captured = input;
      if (kind === 'cancelled') owner.abort();
      throw kind === 'forged' ? forged : busy;
    });
    const work = derive('operator', 'slh-dsa-shake-128s', new Uint8Array(64).fill(9), owner.signal);
    if (kind === 'owned') await assert.rejects(work, error => error === busy);
    else await assert.rejects(work, { message: kind === 'cancelled' ? 'CANCELLED' : 'SENTRY_PUBLIC_KEY_VALIDATION_FAILED' });
    assert(captured?.every(value => value === 0));
  }
});

test('normal native factory and qualification use the same production deriver', async () => {
  const source = async (file: string) =>
    readFile(new URL(file, import.meta.url), 'utf8');
  const factory = await source('../src/platform/nativeFactory.native.ts');
  const native = await source('../src/crypto/sentryPublicKey.native.ts');
  const qualification = await source(
    '../qualification/native-sentry-classical.ts'
  );
  assert.match(
    factory,
    /deriveSentryPublicKey:\s*createNativeSentryPublicKeyDeriver\(\)/
  );
  assert.match(native, /createSentryPublicKeyDeriver/);
  assert.match(native, /ensureNativeCryptoReady\(\)\.then/);
  assert.match(native, /@sidhujag\/sysweb3-sentry\/classical-public-key/);
  assert.match(native, /createSentryShakeExecutor/);
  assert.doesNotMatch(native, /qualification\//);
  assert.match(qualification, /derive: DeriveSentryPublicKey/);
  assert.doesNotMatch(qualification, /createSentryClassicalExecutor/);
  const entry = await source('../qualification/index.tsx');
  assert.match(entry, /createNativeSentryPublicKeyDeriver\(\)/);
  assert.match(entry, /qualifyNativeSentryClassical\([\s\S]*sentryDerive/);
  assert.match(entry, /qualifyNativeSentryShake\(qualificationLifetime.signal, sentryDerive\)/);
  const bootstrap = entry.indexOf('const provider = await ensureNativeCryptoReady();');
  const classical = entry.indexOf('await check(SENTRY_CLASSICAL_CHECK');
  const shake = entry.indexOf('await check(SENTRY_SHAKE_CHECK');
  const storage = entry.indexOf("'open SQLCipher and device key'");
  assert(bootstrap >= 0 && classical > bootstrap && shake > classical && storage > shake,
    'both Sentry checks must complete on the ordinary crypto path before custody/storage acceptance');
});
