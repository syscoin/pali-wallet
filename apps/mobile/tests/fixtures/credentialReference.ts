import { createNativeCredentialVault } from '../../src/custody/credentialVault.ts';
import type { OpenWalletStorage } from '../../src/storage/types.ts';
import { createTestCredentialPort } from './credential.ts';

/** Bound locator for storage-only synthetic vault-pair tests. No authentication claim. */
export async function createTestCredentialReference(
  storage: Pick<OpenWalletStorage, 'credential'> & { recovery: NonNullable<OpenWalletStorage['recovery']> },
  pair: Readonly<{ vault: unknown; keys: unknown }>,
  walletBindingId: string
) {
  const pairFingerprint = await storage.recovery.fingerprintPair!(pair);
  return createNativeCredentialVault(storage.credential, createTestCredentialPort()).createReference({ walletBindingId, pairFingerprint });
}
