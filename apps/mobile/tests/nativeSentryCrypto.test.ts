import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSentryCryptoFixture } from './fixtures/nativeSentryCrypto.ts';
import type { RunSentryCrypto, SentryCryptoJob } from '../../../source/wallet/sentryCryptoJobs.ts';

const job = (): Extract<SentryCryptoJob, { type: 'import' }> => ({ type: 'import', role: 'operator', scheme: 'slh-dsa-shake-128s', secretKey: '37'.repeat(64) });
const publicKey = { role: 'operator', scheme: 'slh-dsa-shake-128s', publicKey: '37'.repeat(32) };
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('native Sentry captures the job before lazy bootstrap and chooses only the fixed isolated host', async () => {
  const ready = Promise.withResolvers<void>();
  let bootstraps = 0, loads = 0, captured: SentryCryptoJob | undefined;
  const execute = nativeSentryCryptoFixture({
    ready: () => { bootstraps++; return ready.promise; },
    isolated: () => { loads++; return (async input => { captured = input; assert.equal('secretKey' in input && input.secretKey, '37'.repeat(64)); return publicKey; }) as RunSentryCrypto; },
  });
  assert.equal(bootstraps, 0); assert.equal(loads, 0);
  const input = job(), result = execute(input, () => undefined);
  input.secretKey = 'erased by caller';
  assert.equal(bootstraps, 1); assert.equal(loads, 0);
  ready.resolve(); assert.equal(await result, publicKey);
  assert.equal(loads, 1); assert.equal(captured?.type, 'import');
  assert.equal(captured && 'secretKey' in captured ? captured.secretKey : undefined, '');
});

test('native Sentry keeps classical jobs on the lazy shared dispatcher', async () => {
  let ready = false, calls = 0;
  const execute = nativeSentryCryptoFixture({
    ready: async () => { ready = true; },
    isolated: () => assert.fail('classical job loaded isolated crypto'),
    shared: () => { assert(ready); return (async input => { calls++; assert.equal(input.type, 'import'); return publicKey; }) as RunSentryCrypto; },
  });
  await execute({ type: 'import', role: 'owner', scheme: 'secp256k1', secretKey: '01'.repeat(32) }, () => undefined);
  assert.equal(calls, 1);
});

test('retirement during native bootstrap prevents isolated loading and execution', async () => {
  const ready = Promise.withResolvers<void>(); let active = true;
  const execute = nativeSentryCryptoFixture({ ready: () => ready.promise, isolated: () => assert.fail('retired job loaded native host') });
  const work = execute(job(), () => { if (!active) throw Error('CANCELLED'); });
  const rejected = assert.rejects(work, /CANCELLED/);
  active = false; ready.resolve(); await rejected;
});

test('retirement drains native Sentry work and erases its copied secret before rejection', async () => {
  const entered = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>();
  let active = true, settled = false, captured: SentryCryptoJob | undefined;
  const execute = nativeSentryCryptoFixture({
    ready: async () => undefined,
    isolated: () => (async input => { captured = input; entered.resolve(); await finished.promise; return publicKey; }) as RunSentryCrypto,
  });
  const work = execute(job(), () => { if (!active) throw Error('CANCELLED'); }).finally(() => { settled = true; });
  const rejected = assert.rejects(work, /CANCELLED/);
  await entered.promise; active = false; await nextTurn();
  assert.equal(settled, false); assert.equal(captured && 'secretKey' in captured ? captured.secretKey : undefined, '37'.repeat(64));
  finished.resolve(); await rejected;
  assert.equal(captured && 'secretKey' in captured ? captured.secretKey : undefined, '');
});

test('native Sentry loader failures expose only the fixed execution error', async () => {
  const execute = nativeSentryCryptoFixture({ ready: async () => undefined, isolated: () => { throw Error('private native failure detail'); } });
  await assert.rejects(execute(job(), () => undefined), { message: 'SENTRY_EXECUTION_FAILED' });
});

test('native Sentry preserves only the fixed native failure code for qualification', async () => {
  for (const code of ['sdk-job-timeout', 'private detail']) {
    const execute = nativeSentryCryptoFixture({
      ready: async () => undefined,
      isolated: () => (async () => {
        throw Object.assign(new Error('private native failure detail'), { nativeExecutionCode: code });
      }) as RunSentryCrypto,
    });
    await assert.rejects(execute(job(), () => undefined), error => {
      assert(error instanceof Error);
      assert.equal(error.message, 'SENTRY_EXECUTION_FAILED');
      assert.equal(Reflect.get(error, 'nativeExecutionCode'), code === 'sdk-job-timeout' ? code : undefined);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
