import { isAllowedSentryKeyRoleScheme } from '../../../../source/wallet/sentryKeyVault.ts';
import { sentryKeyValidationBusy } from '../core/sentryKeyValidation.ts';
import type { DeriveSentryPublicKey } from '../custody/sentryKeyManagement.ts';

type NativeKey = Readonly<{ handle: Readonly<{ dispose(): void }> }>;
type NativePublicKey = NativeKey & Readonly<{
  export(options: Readonly<{ format: 'raw-public' }>): Uint8Array;
}>;
export type NativeSentryKeyFactory = Readonly<{
  createPrivateKeyAsync(input: Readonly<{
    key: ArrayBuffer;
    format: 'raw-private';
    asymmetricKeyType: 'slh-dsa-shake-128s';
  }>): Promise<NativeKey>;
  createPublicKey(key: NativeKey): NativePublicKey;
}>;

const size = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)!.get!;
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const tag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const length = Object.getOwnPropertyDescriptor(typedArray, 'byteLength')!.get!;
const offset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset')!.get!;
const backing = Object.getOwnPropertyDescriptor(typedArray, 'buffer')!.get!;
const invalid = () => new Error('SENTRY_SHAKE_VALIDATION_FAILED');
const cancelled = () => new Error('CANCELLED');
const nativeBusy = (error: unknown) => {
  try {
    return error !== null && typeof error === 'object' &&
      Object.getOwnPropertyDescriptor(error, 'message')?.value === 'SLH-DSA raw private key import busy';
  } catch { return false; }
};

/** Only the qualified native key factories may supply this port. */
export function createSentryShakeExecutor(
  factory: NativeSentryKeyFactory
): DeriveSentryPublicKey {
  if (typeof factory?.createPrivateKeyAsync !== 'function' || typeof factory?.createPublicKey !== 'function')
    throw new Error('SENTRY_SHAKE_UNAVAILABLE');
  const { createPrivateKeyAsync, createPublicKey } = factory;
  return async (role, scheme, secret, signal) => {
    if (signal.aborted) throw cancelled();
    try {
      if (scheme !== 'slh-dsa-shake-128s' || !isAllowedSentryKeyRoleScheme(role, scheme) ||
          Reflect.apply(tag, secret, []) !== 'Uint8Array' || Reflect.apply(length, secret, []) !== 64 ||
          Reflect.apply(offset, secret, []) !== 0) throw invalid();
      const input: ArrayBuffer = Reflect.apply(backing, secret, []);
      if (Reflect.apply(size, input, []) !== 64) throw invalid();
      // Native snapshots synchronously. Await it even after cancellation, then
      // dispose the returned handle rather than leaving its secret to GC.
      const privateKey = await createPrivateKeyAsync.call(factory, {
        key: input, format: 'raw-private', asymmetricKeyType: 'slh-dsa-shake-128s',
      });
      try {
        if (signal.aborted) throw cancelled();
        const publicKey = createPublicKey.call(factory, privateKey);
        try {
          const output = publicKey.export({ format: 'raw-public' });
          if (Reflect.apply(tag, output, []) !== 'Uint8Array' || Reflect.apply(length, output, []) !== 32)
            throw invalid();
          if (signal.aborted) throw cancelled();
          return Buffer.from(output).toString('hex');
        } finally { publicKey.handle.dispose(); }
      } finally { privateKey.handle.dispose(); }
    } catch (error) {
      if (signal.aborted) throw cancelled();
      if (nativeBusy(error)) throw sentryKeyValidationBusy();
      throw invalid();
    }
  };
}
