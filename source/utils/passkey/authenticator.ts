import type {
  PasskeyBackupStatus,
  SmartAccountP256WebAuthnConfig,
} from 'types/network';

import { admitPasskeyActionSignature } from './execution';
import { type PasskeyWebAuthnProof } from './validation';
import {
  getDiscoverablePasskeyAssertion,
  getPasskeyAssertion,
} from './webauthn';

export const getP256WebAuthnExternalSignatureMetadata = (
  config: SmartAccountP256WebAuthnConfig
) => ({
  credentialId: config.credentialId,
  passkeyName: config.passkeyName,
});

export const signP256WebAuthnActionHash = async ({
  actionHash,
  credentialId,
  expectedCredentialIdHash,
  expectedPublicKey,
}: {
  actionHash: string;
  credentialId?: string;
  expectedCredentialIdHash?: string;
  expectedPublicKey: SmartAccountP256WebAuthnConfig['publicKey'];
}): Promise<{
  backupStatus?: PasskeyBackupStatus;
  credentialId: string;
  proof: PasskeyWebAuthnProof;
  signature: string;
  userHandle?: string;
}> => {
  const assertion = credentialId
    ? await getPasskeyAssertion(credentialId, actionHash)
    : await getDiscoverablePasskeyAssertion(actionHash);
  return admitPasskeyActionSignature(assertion, {
    expectedCredentialIdHash,
    expectedPublicKey,
  });
};
