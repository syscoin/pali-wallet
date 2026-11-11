import { createNativePinVault } from '../../src/custody/pinVault.ts';
import type { OpenWalletStorage } from '../../src/storage/types.ts';
import { createTestPinCredentialPort } from './pinCredential.ts';

/** Real PIN record for storage-only synthetic vault-pair tests. */
export async function createTestPinRecord(
  storage: Pick<OpenWalletStorage, 'pin'> & { recovery: NonNullable<OpenWalletStorage['recovery']> },
  pair: Readonly<{ vault: unknown; keys: unknown }>,
  walletBindingId: string
) {
  const pairFingerprint = await storage.recovery.fingerprintPair!(pair);
  return createNativePinVault(storage.pin, createTestPinCredentialPort()).stage(
    '123456',
    { walletBindingId, pairFingerprint },
    `Pali#1:${'ab'.repeat(32)}`,
    new Uint8Array(32).fill(7),
    () => undefined
  );
}
