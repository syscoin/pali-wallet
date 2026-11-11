import {
  encodePasskeyWebAuthnProof,
  type PasskeyWebAuthnProof,
} from './validation.ts';
import type { PasskeyAssertionResult } from './webauthn.ts';
import type { SmartAccountP256WebAuthnConfig } from '../../types/network.ts';

export const passkeyAssertionToProof = (
  assertion: PasskeyAssertionResult
): PasskeyWebAuthnProof => ({
  authenticatorData: assertion.authenticatorData,
  challengeOffset: assertion.challengeOffset,
  clientDataJSON: assertion.clientDataJSON,
  originOffset: assertion.originOffset,
  r: assertion.r,
  s: assertion.s,
  typeOffset: assertion.typeOffset,
});

/** Shared proof admission after browser/native response normalization. */
export function admitPasskeyActionSignature(
  assertion: PasskeyAssertionResult,
  expected: {
    expectedCredentialIdHash?: string;
    expectedPublicKey: SmartAccountP256WebAuthnConfig['publicKey'];
  }
) {
  if (
    expected.expectedCredentialIdHash &&
    assertion.credentialIdHash.toLowerCase() !==
      expected.expectedCredentialIdHash.toLowerCase()
  )
    throw new Error('Selected passkey does not match this smart account');
  const key = expected.expectedPublicKey;
  if (
    !key ||
    !assertion.publicKeyCandidates.some(
      (candidate) =>
        candidate.x.toLowerCase() === key.x.toLowerCase() &&
        candidate.y.toLowerCase() === key.y.toLowerCase() &&
        candidate.rpIdHash.toLowerCase() === key.rpIdHash.toLowerCase() &&
        candidate.originHash.toLowerCase() === key.originHash.toLowerCase() &&
        Number(candidate.originLength) === Number(key.originLength)
    )
  )
    throw new Error(
      'Selected passkey public key does not match this smart account'
    );
  const proof = passkeyAssertionToProof(assertion);
  return {
    backupStatus: assertion.backupStatus,
    credentialId: assertion.credentialId,
    proof,
    signature: encodePasskeyWebAuthnProof(proof),
    userHandle: assertion.userHandle,
  };
}
