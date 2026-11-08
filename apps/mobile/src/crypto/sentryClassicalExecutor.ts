import { isAllowedSentryKeyRoleScheme } from '../../../../source/wallet/sentryKeyVault.ts';
import type { DeriveSentryPublicKey } from '../custody/sentryKeyManagement.ts';

type ClassicalDerivation = (
  scheme: 'bls-basic' | 'secp256k1',
  secret: Uint8Array
) => Promise<Uint8Array>;

/** The shared SDK copies the borrowed key before its first asynchronous step. */
export function createSentryClassicalExecutor(
  derive: ClassicalDerivation
): DeriveSentryPublicKey {
  return async (role, scheme, secret, owner) => {
    if (owner.aborted) throw new Error('CANCELLED');
    if (
      scheme === 'slh-dsa-shake-128s' ||
      !isAllowedSentryKeyRoleScheme(role, scheme)
    )
      throw new Error('SENTRY_CLASSICAL_VALIDATION_FAILED');
    try {
      const publicKey = await derive(scheme, secret);
      if (owner.aborted) throw new Error('CANCELLED');
      return Buffer.from(publicKey).toString('hex');
    } catch {
      throw new Error(
        owner.aborted ? 'CANCELLED' : 'SENTRY_CLASSICAL_VALIDATION_FAILED'
      );
    }
  };
}
