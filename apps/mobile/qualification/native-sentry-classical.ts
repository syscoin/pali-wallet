import { createSentryClassicalExecutor } from '../src/crypto/sentryClassicalExecutor.ts';
import type { DeriveSentryPublicKey } from '../src/custody/sentryKeyManagement.ts';

export const SENTRY_CLASSICAL_CHECK =
  'native Sentry BLS and secp256k1 import vectors';

// Public Core BLS scalar-one and compressed SEC1 scalar-two fixtures.
const vectors = [
  {
    role: 'operator',
    scheme: 'bls-basic',
    scalar: 1,
    publicKey:
      '97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb',
  },
  {
    role: 'collateral',
    scheme: 'secp256k1',
    scalar: 2,
    publicKey:
      '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  },
] as const;

/** Only the isolated qualification entry loads this after native crypto setup. */
export async function qualifyNativeSentryClassical(
  signal: AbortSignal,
  blindingCalls: () => number
): Promise<DeriveSentryPublicKey> {
  if (signal.aborted) throw new Error('CANCELLED');
  const { deriveSentryClassicalPublicKey } = await import(
    '@sidhujag/sysweb3-sentry/classical-public-key'
  );
  const derive = createSentryClassicalExecutor(deriveSentryClassicalPublicKey);

  for (const { role, scheme, scalar, publicKey } of vectors) {
    const check = async () => {
      const allocation = new Uint8Array(40).fill(0x5a);
      const secret = allocation.subarray(4, 36);
      secret.fill(0);
      secret[31] = scalar;
      const operation = derive(role, scheme, secret, signal);
      secret.fill(0);
      if (
        (await operation) !== publicKey ||
        allocation[3] !== 0x5a ||
        allocation[36] !== 0x5a
      )
        throw new Error('QUALIFICATION_SENTRY_CLASSICAL_VECTOR_FAILED');
    };
    await check();
    // A warm derivation must still request entropy for scalar blinding.
    // Counting only the cold call could mistake Noble's RNG probe for blinding.
    const before = blindingCalls();
    await check();
    if (blindingCalls() <= before)
      throw new Error('QUALIFICATION_SENTRY_BLINDING_FAILED');
  }
  return derive;
}
