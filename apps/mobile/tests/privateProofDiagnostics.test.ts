import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrivateProofDiagnostic,
  PRIVATE_PROOF_BOUNDARIES,
  readPrivateProofDiagnostic,
} from '../qualification/private-proof-diagnostics.ts';
import { PRIVATE_PROOF_CASES } from '../qualification/private-proof-contract.ts';

const checkpoint = { case: 'proof-before-cancel', boundary: 'artifacts', code: 'privacy_proof_failed' } as const;

test('fixed proof cases and boundaries project only an immutable exact diagnostic', () => {
  for (const caseName of PRIVATE_PROOF_CASES) for (const boundary of PRIVATE_PROOF_BOUNDARIES) {
    const value = { case: caseName, boundary, code: 'unrecognized' };
    const checked = readPrivateProofDiagnostic(value);
    assert.deepEqual(checked, value);
    assert.notEqual(checked, value);
    assert(Object.isFrozen(checked));
  }
});

test('diagnostics reject extra fields, non-string labels, malformed codes and accessors', () => {
  const secret = 'private marker never upload';
  const invalid: unknown[] = [null, [], false, 0, secret, {},
    { ...checkpoint, case: secret }, { ...checkpoint, boundary: secret }, { ...checkpoint, code: secret },
    { ...checkpoint, case: ['proof-before-cancel'] }, { ...checkpoint, boundary: null },
    { ...checkpoint, code: { message: 'privacy_proof_failed', secret } },
    { ...checkpoint, code: 'privacy_proof_failed\n' }, { ...checkpoint, input: secret },
    { ...checkpoint, nativeExecutionCode: secret }, { ...checkpoint, nativeExecutionCode: undefined },
    { ...checkpoint, nativeExecutionCode: { code: 'job-timeout' } },
    Object.create(checkpoint), Object.defineProperty({ ...checkpoint }, 'hidden', { value: secret }),
    { ...checkpoint, [Symbol('secret')]: secret },
    Object.defineProperty({ ...checkpoint }, 'code', { get() { assert.fail('No accessor may be read'); } }),
    new Proxy({}, { ownKeys() { throw Error(secret); } }),
  ];
  for (const value of invalid)
    assert.throws(() => readPrivateProofDiagnostic(value), /^Error: PRIVATE_PROOF_DIAGNOSTIC_INVALID$/);
});

test('capture retains the latest fixed boundary and known own Error message only', () => {
  const diagnostic = createPrivateProofDiagnostic();
  assert.equal(diagnostic.report(), undefined);
  diagnostic.observe('proof-before-cancel', 'artifacts');
  diagnostic.observe('proof-before-cancel', 'witness');
  assert.equal(diagnostic.report(), undefined);
  diagnostic.capture(new Error('privacy_proof_failed'));
  assert.deepEqual(diagnostic.report(), { ...checkpoint, boundary: 'witness' });
  diagnostic.observe('proof-after-cancel', 'report-write');
  diagnostic.capture(new Error('PRIVATE_PROOF_REPORT_INVALID'));
  assert.deepEqual(diagnostic.report(), { ...checkpoint, boundary: 'witness' });
});

test('unknown exceptions and hostile messages become unrecognized without retaining secret data', () => {
  const secret = 'private marker never upload';
  const exceptions = [new Error(secret), secret, { message: 'privacy_proof_failed', secret },
    Object.defineProperty(new Error(), 'message', { get() { assert.fail('No error accessor may be read'); } }),
    new Proxy(new Error(secret), { getOwnPropertyDescriptor() { throw Error(secret); } }),
  ];
  for (const error of exceptions) {
    const diagnostic = createPrivateProofDiagnostic();
    diagnostic.observe('cancel-while-proving', 'proving');
    diagnostic.capture(error);
    assert.deepEqual(diagnostic.report(), { case: 'cancel-while-proving', boundary: 'proving', code: 'unrecognized' });
    assert(!JSON.stringify(diagnostic.report()).includes(secret));
  }
});

test('a failure before proof has no fabricated proof case', () => {
  const diagnostic = createPrivateProofDiagnostic();
  diagnostic.capture(new Error('privacy_proof_failed'));
  diagnostic.observe('proof-before-cancel', 'start');
  assert.equal(diagnostic.report(), undefined);
});

test('only fixed own native execution codes survive capture and report projection', () => {
  for (const nativeExecutionCode of ['readiness-timeout', 'job-timeout', 'disposal-timeout'] as const) {
    const diagnostic = createPrivateProofDiagnostic();
    diagnostic.observe('proof-after-cancel', 'start');
    diagnostic.capture(Object.assign(new Error('private native message'), { nativeExecutionCode }));
    const expected = { case: 'proof-after-cancel', boundary: 'start', code: 'unrecognized', nativeExecutionCode };
    assert.deepEqual(diagnostic.report(), expected);
    assert.deepEqual(readPrivateProofDiagnostic(expected), expected);
    assert(!JSON.stringify(diagnostic.report()).includes('private native message'));
  }
  for (const error of [Object.assign(new Error('private'), { nativeExecutionCode: 'private native code' }),
    Object.defineProperty(new Error('private'), 'nativeExecutionCode', { get() { assert.fail('No native accessor may be read'); } })]) {
    const diagnostic = createPrivateProofDiagnostic();
    diagnostic.observe('proof-before-cancel', 'start'); diagnostic.capture(error);
    assert.deepEqual(diagnostic.report(), { case: 'proof-before-cancel', boundary: 'start', code: 'unrecognized' });
  }
});
