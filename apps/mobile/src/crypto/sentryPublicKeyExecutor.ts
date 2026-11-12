import { isAllowedSentryKeyRoleScheme } from '../../../../source/wallet/sentryKeyVault.ts';
import type { DeriveSentryPublicKey } from '../custody/sentryKeyManagement.ts';
import type { SentryAuthorityScheme } from '../../../../source/wallet/sentryKeyVault.ts';
import { isSentryKeyValidationBusy } from '../core/sentryKeyValidation.ts';

const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const tag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!
  .get!;
const length = Object.getOwnPropertyDescriptor(typedArray, 'byteLength')!.get!;
const offset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset')!.get!;
const buffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer')!.get!;
const size = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)!.get!;

/** Own the borrowed input synchronously, before any lazy native/SDK loading. */
export function createSentryPublicKeyDeriver(
  load: (scheme: SentryAuthorityScheme) => Promise<DeriveSentryPublicKey>
): DeriveSentryPublicKey {
  return async (role, scheme, secret, signal) => {
    let owned: Uint8Array<ArrayBuffer> | undefined;
    try {
      if (signal.aborted) throw new Error('CANCELLED');
      if (!isAllowedSentryKeyRoleScheme(role, scheme)) throw new Error();
      const expected = scheme === 'slh-dsa-shake-128s' ? 64 : 32;
      if (
        Reflect.apply(tag, secret, []) !== 'Uint8Array' ||
        Reflect.apply(length, secret, []) !== expected
      )
        throw new Error();
      const backing: ArrayBuffer = Reflect.apply(buffer, secret, []);
      const start: number = Reflect.apply(offset, secret, []);
      const backingSize: number = Reflect.apply(size, backing, []);
      if (
        scheme === 'slh-dsa-shake-128s' &&
        (start !== 0 || backingSize !== expected)
      )
        throw new Error();
      owned = new Uint8Array(expected);
      owned.set(new Uint8Array(backing, start, expected));
      const derive = await load(scheme);
      if (signal.aborted) throw new Error('CANCELLED');
      const publicKey = await derive(role, scheme, owned, signal);
      if (signal.aborted) throw new Error('CANCELLED');
      return publicKey;
    } catch (error) {
      if (!signal.aborted && isSentryKeyValidationBusy(error)) throw error;
      throw new Error(
        signal.aborted ? 'CANCELLED' : 'SENTRY_PUBLIC_KEY_VALIDATION_FAILED'
      );
    } finally {
      owned?.fill(0);
    }
  };
}
