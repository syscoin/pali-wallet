/** Internal, fixed first-party failure evidence. Never library messages or caller data. */
export const NATIVE_EXECUTION_CODES = Object.freeze([
  'readiness-timeout',
  'job-timeout',
  'sdk-job-timeout',
  'disposal-timeout',
] as const);
export type NativeExecutionCode = (typeof NATIVE_EXECUTION_CODES)[number];

function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property && 'value' in property ? property.value : undefined;
  } catch {
    return undefined;
  }
}

export function readNativeExecutionCode(
  error: unknown
): NativeExecutionCode | undefined {
  const code = ownData(error, 'nativeExecutionCode');
  return NATIVE_EXECUTION_CODES.find((value) => value === code);
}

type PublicFailure =
  | 'privacy_proof_failed'
  | 'privacy_proof_unavailable'
  | 'privacy_proof_cancelled'
  | 'privacy_verification_pending'
  | 'SENTRY_EXECUTION_FAILED';

export function nativeExecutionError(
  message: PublicFailure,
  failure: unknown
): Error {
  const error = new Error(message);
  const code = readNativeExecutionCode(failure);
  if (code)
    Object.defineProperty(error, 'nativeExecutionCode', { value: code });
  return error;
}

/** Only the native module boundary may translate these exact Expo rejection codes. */
export function nativeBridgeExecutionError(
  message: PublicFailure,
  failure: unknown
): Error {
  const code = ownData(failure, 'code');
  const nativeExecutionCode =
    code === 'ERR_PALI_NATIVE_READINESS_TIMEOUT'
      ? 'readiness-timeout'
      : code === 'ERR_PALI_NATIVE_JOB_TIMEOUT'
      ? 'job-timeout'
      : code === 'ERR_PALI_NATIVE_SDK_JOB_TIMEOUT'
      ? 'sdk-job-timeout'
      : code === 'ERR_PALI_NATIVE_DISPOSAL_TIMEOUT'
      ? 'disposal-timeout'
      : undefined;
  return nativeExecutionError(message, { nativeExecutionCode });
}
