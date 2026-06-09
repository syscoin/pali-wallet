import type { PasskeyWebAuthnProof } from './validation';
import type { PasskeyAssertionResult } from './webauthn';

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
