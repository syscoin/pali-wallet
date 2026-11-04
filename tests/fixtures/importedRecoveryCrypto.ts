// Storage/concurrency fixtures keep SDK import parsing and allocation real.
// Actual authenticated encryption is exercised by importedAccountRecovery.spec.ts.
export function attachImportedRecoveryCryptoFixture(keyring: any): void {
  const profileId = `0x${'a'.repeat(64)}`;
  keyring.getPrivateRecordProfileId = async () => profileId;
  keyring.encryptPrivateRecord = async (input: {
    domain: string;
    recordId: string;
  }) => ({
    version: 1,
    domain: input.domain,
    recordId: input.recordId,
    profileId,
    nonce: 'AAAAAAAAAAAAAAAA',
    ciphertext:
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });
}
