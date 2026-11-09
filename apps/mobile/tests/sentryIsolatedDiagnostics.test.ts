import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSentryIsolatedDiagnostic,
  readSentryIsolatedDiagnostic,
} from '../qualification/sentry-isolated-diagnostics.ts';

test('isolated failure retains only its last public step, elapsed time and fixed native category', () => {
  let now = 10;
  const diagnostic = createSentryIsolatedDiagnostic(() => now);
  assert.equal(diagnostic.report(), undefined);
  diagnostic.observe('operator-import', 'started');
  now = 13;
  diagnostic.observe('operator-import', 'completed');
  diagnostic.observe('service-sign', 'started');
  now = 120013;
  const error = Object.assign(new Error('SENTRY_EXECUTION_FAILED'), {
    nativeExecutionCode: 'readiness-timeout', input: 'private synthetic marker',
  });
  diagnostic.capture(error);
  assert.deepEqual(diagnostic.report(), {
    step: 'service-sign', phase: 'started', elapsedMs: 120000,
    code: 'SENTRY_EXECUTION_FAILED', nativeExecutionCode: 'readiness-timeout',
  });
  assert(!JSON.stringify(diagnostic.report()).includes('private'));
  assert(Object.isFrozen(diagnostic.report()));
  diagnostic.observe('owner-sign', 'started');
  diagnostic.capture(new Error('another private marker'));
  assert.equal(diagnostic.report()!.step, 'service-sign');
});

test('unknown and hostile exceptions cannot disclose their text or invoke accessors', () => {
  const secret = 'do not retain private data';
  let getters = 0;
  const accessor = new Error();
  Object.defineProperty(accessor, 'message', { get() { getters++; return secret; } });
  Object.defineProperty(accessor, 'nativeExecutionCode', { get() { getters++; return 'job-timeout'; } });
  for (const error of [new Error(secret), { message: secret }, accessor,
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error(secret); }, getPrototypeOf() { throw Error(secret); } })]) {
    const diagnostic = createSentryIsolatedDiagnostic(() => 0);
    diagnostic.observe('operator-import', 'started');
    diagnostic.capture(error);
    assert.deepEqual(diagnostic.report(), {
      step: 'operator-import', phase: 'started', elapsedMs: 0, code: 'unrecognized',
    });
    assert(!JSON.stringify(diagnostic.report()).includes(secret));
  }
  assert.equal(getters, 0);
});

test('failure evidence refuses unknown fields, labels, codes, durations and getters', () => {
  const valid = { step: 'owner-verify', phase: 'completed', elapsedMs: 7,
    code: 'QUALIFICATION_SENTRY_SHAKE_OWNER_FAILED' };
  assert.deepEqual(readSentryIsolatedDiagnostic(valid), valid);
  const getter = { ...valid };
  Object.defineProperty(getter, 'step', { get() { assert.fail('getter invoked'); } });
  for (const value of [null, [], { ...valid, secret: 'private' }, { ...valid, step: 'private' },
    { ...valid, phase: 'other' }, { ...valid, code: 'private' }, { ...valid, elapsedMs: -1 },
    { ...valid, elapsedMs: 0.5 }, { ...valid, elapsedMs: Infinity }, { ...valid, elapsedMs: 300001 },
    { ...valid, nativeExecutionCode: 'private' }, { ...valid, nativeExecutionCode: undefined }, getter]) {
    assert.throws(() => readSentryIsolatedDiagnostic(value), /SENTRY_ISOLATED_DIAGNOSTIC_INVALID/);
  }
});

test('clock anomalies remain bounded diagnostics and cannot qualify a job', () => {
  for (const next of [-1, Infinity, Number.MAX_VALUE]) {
    let now = 5;
    const diagnostic = createSentryIsolatedDiagnostic(() => now);
    diagnostic.observe('operator-import', 'started');
    now = next;
    diagnostic.capture(new Error('SENTRY_EXECUTION_FAILED'));
    const report = diagnostic.report()!;
    assert(Number.isSafeInteger(report.elapsedMs) && report.elapsedMs >= 0 && report.elapsedMs <= 300000);
    assert(!('status' in report));
  }
});
