/** Storage-only shape; deliberately not an authenticated wallet/session fixture. */
export function storageOnlyPublicSession(binding: string) {
  return {
    version: 1 as const,
    checkpoint: { version: 1 as const, domain: 'sysweb3.public-session.v1', recordId: binding,
      profileId: `0x${'11'.repeat(32)}`, nonce: 'AA==', ciphertext: 'AA==' },
    slhStates: [],
  };
}
