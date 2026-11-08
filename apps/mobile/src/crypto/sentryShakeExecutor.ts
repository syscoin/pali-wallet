import { isAllowedSentryKeyRoleScheme } from '../../../../source/wallet/sentryKeyVault.ts';
import type { DeriveSentryPublicKey } from '../custody/sentryKeyManagement.ts';

export type NativeSentryShakeValidation = Readonly<{
  validateSentryShake128sKey(secretKey: ArrayBuffer): Promise<ArrayBuffer>;
}>;

const size = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)!.get!;
const invalid = () => new Error('SENTRY_SHAKE_VALIDATION_FAILED');
const cancelled = () => new Error('CANCELLED');

/** Only a trusted, qualified native handle may supply this port. */
export function createSentryShakeExecutor(
  native: NativeSentryShakeValidation
): DeriveSentryPublicKey {
  const validate = native.validateSentryShake128sKey;
  if (typeof validate !== 'function')
    throw new Error('SENTRY_SHAKE_UNAVAILABLE');
  return async (role, scheme, secret, signal) => {
    if (signal.aborted) throw cancelled();
    if (
      scheme !== 'slh-dsa-shake-128s' ||
      !isAllowedSentryKeyRoleScheme(role, scheme) ||
      !(secret instanceof Uint8Array) ||
      secret.byteOffset !== 0 ||
      secret.byteLength !== 64
    )
      throw invalid();
    try {
      if (Reflect.apply(size, secret.buffer, []) !== 64) throw invalid();
      // The bridge copies the borrowed bytes synchronously. Do not put an
      // import, microtask or other await ahead of this call.
      const output = await Reflect.apply(validate, native, [secret.buffer]);
      if (signal.aborted) throw cancelled();
      if (Reflect.apply(size, output, []) !== 32) throw invalid();
      return Buffer.from(output).toString('hex');
    } catch {
      // Never race the native Promise against cancellation. It only settles
      // after the worker has erased its owned input.
      if (signal.aborted) throw cancelled();
      throw invalid();
    }
  };
}
