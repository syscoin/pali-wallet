import type {
  PasskeyBackupStatus,
  SmartAccountP256WebAuthnConfig,
} from 'types/network';

import {
  encodePasskeyWebAuthnProof,
  type PasskeyWebAuthnProof,
} from './validation';
import {
  getDiscoverablePasskeyAssertion,
  getPasskeyAssertion,
} from './webauthn';

const passkeyAssertionToProof = (assertion: {
  authenticatorData: string;
  challengeOffset: number;
  clientDataJSON: string;
  originOffset: number;
  r: string;
  s: string;
  typeOffset: number;
}): PasskeyWebAuthnProof => ({
  authenticatorData: assertion.authenticatorData,
  challengeOffset: assertion.challengeOffset,
  clientDataJSON: assertion.clientDataJSON,
  originOffset: assertion.originOffset,
  r: assertion.r,
  s: assertion.s,
  typeOffset: assertion.typeOffset,
});

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
  expectedPublicKey?: SmartAccountP256WebAuthnConfig['publicKey'];
}): Promise<{
  backupStatus?: PasskeyBackupStatus;
  credentialId: string;
  proof: PasskeyWebAuthnProof;
  signature: string;
}> => {
  const assertion = credentialId
    ? await getPasskeyAssertion(credentialId, actionHash)
    : await getDiscoverablePasskeyAssertion(actionHash);
  if (
    expectedCredentialIdHash &&
    assertion.credentialIdHash.toLowerCase() !==
      expectedCredentialIdHash.toLowerCase()
  ) {
    throw new Error('Selected passkey does not match this smart account');
  }
  if (
    expectedPublicKey &&
    !assertion.publicKeyCandidates.some(
      (candidate) =>
        candidate.x.toLowerCase() === expectedPublicKey.x.toLowerCase() &&
        candidate.y.toLowerCase() === expectedPublicKey.y.toLowerCase() &&
        candidate.rpIdHash.toLowerCase() ===
          expectedPublicKey.rpIdHash.toLowerCase() &&
        candidate.originHash.toLowerCase() ===
          expectedPublicKey.originHash.toLowerCase() &&
        Number(candidate.originLength) ===
          Number(expectedPublicKey.originLength)
    )
  ) {
    throw new Error(
      'Selected passkey public key does not match this smart account'
    );
  }
  const proof = passkeyAssertionToProof(assertion);

  return {
    backupStatus: assertion.backupStatus,
    credentialId: assertion.credentialId,
    proof,
    signature: encodePasskeyWebAuthnProof(proof),
  };
};
