import {
  NATIVE_EXECUTION_CODES,
  nativeBridgeExecutionError,
  nativeExecutionError,
  readNativeExecutionCode,
} from './nativeExecutionDiagnostic';

it.each(NATIVE_EXECUTION_CODES)(
  'retains only the fixed internal category %s',
  (code) => {
    const source = Object.assign(new Error('private input'), {
      nativeExecutionCode: code,
      secret: 'private input',
    });
    const error = nativeExecutionError('SENTRY_EXECUTION_FAILED', source);
    expect(error.message).toBe('SENTRY_EXECUTION_FAILED');
    expect(readNativeExecutionCode(error)).toBe(code);
    expect(Object.getOwnPropertyNames(error).sort()).toEqual([
      'message',
      'nativeExecutionCode',
      'stack',
    ]);
    expect(JSON.stringify(error)).not.toContain('private');
  }
);

it.each([
  ['ERR_PALI_NATIVE_READINESS_TIMEOUT', 'readiness-timeout'],
  ['ERR_PALI_NATIVE_JOB_TIMEOUT', 'job-timeout'],
  ['ERR_PALI_NATIVE_SDK_JOB_TIMEOUT', 'sdk-job-timeout'],
  ['ERR_PALI_NATIVE_DISPOSAL_TIMEOUT', 'disposal-timeout'],
])(
  'maps the exact native bridge sentinel %s without its private error',
  (code, expected) => {
    const error = nativeBridgeExecutionError(
      'privacy_proof_failed',
      Object.assign(new Error('private input'), { code })
    );
    expect(readNativeExecutionCode(error)).toBe(expected);
    expect(error.message).toBe('privacy_proof_failed');
    expect(error).not.toHaveProperty('code');
    expect(error).not.toHaveProperty('cause');
  }
);

it('refuses unknown, inherited, accessor and throwing-proxy fields without reading them', () => {
  const getter = jest.fn(() => {
    throw Error('private getter');
  });
  for (const value of [
    undefined,
    null,
    false,
    'job-timeout',
    { nativeExecutionCode: 'private input', code: 'private input' },
    Object.create({
      nativeExecutionCode: 'job-timeout',
      code: 'ERR_PALI_NATIVE_JOB_TIMEOUT',
    }),
    Object.defineProperties(
      {},
      {
        nativeExecutionCode: { get: getter },
        code: { get: getter },
        message: { get: getter },
      }
    ),
    new Proxy({}, { getOwnPropertyDescriptor: getter }),
  ]) {
    expect(readNativeExecutionCode(value)).toBeUndefined();
    expect(
      readNativeExecutionCode(
        nativeExecutionError('SENTRY_EXECUTION_FAILED', value)
      )
    ).toBeUndefined();
    expect(
      readNativeExecutionCode(
        nativeBridgeExecutionError('privacy_proof_failed', value)
      )
    ).toBeUndefined();
  }
  // Only the proxy's descriptor trap runs; ordinary property getters stay inert.
  expect(getter).toHaveBeenCalledTimes(3);
});
