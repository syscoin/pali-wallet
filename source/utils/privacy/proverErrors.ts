export const isPrivacyVerificationPending = (error: unknown): boolean =>
  error instanceof Error && error.message === 'privacy_verification_pending';

export const privacyProofCancelled = () => new Error('privacy_proof_cancelled');

export const privacyProofAbortError = (reason: unknown): Error =>
  isPrivacyVerificationPending(reason)
    ? new Error('privacy_verification_pending')
    : privacyProofCancelled();

export const privacyProofGuardError = (error: unknown): Error =>
  isPrivacyVerificationPending(error)
    ? new Error('privacy_verification_pending')
    : new Error('privacy_proof_failed');
