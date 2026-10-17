import {
  importSentryAuthorityKey,
  signSentryManagementOperation,
  signSentryOperation,
  signSentryGovernanceVote,
  governanceVotingKeyIds,
  verifySentryGovernanceVote,
  validateSentryGovernanceVoteRequest,
  reviewSentryGovernanceVote,
} from '@sidhujag/sysweb3-sentry';

import type { SentryCryptoJob } from 'utils/sentry/workerClient';

self.onmessage = async (event: MessageEvent<{ job: SentryCryptoJob }>) => {
  try {
    const { job } = event.data;
    if (job.type === 'validateVote' || job.type === 'reviewVote') {
      const result =
        job.type === 'validateVote'
          ? validateSentryGovernanceVoteRequest(job.request)
          : reviewSentryGovernanceVote(job.request, job.context);
      self.postMessage({ success: true, result });
      return;
    }
    if (job.type === 'votingIdentities') {
      if (!Array.isArray(job.publicKeys) || job.publicKeys.length > 100)
        throw new Error('Invalid voting key list');
      const result = await Promise.all(
        job.publicKeys.map(async (publicKey) => ({
          publicKey,
          ...(await governanceVotingKeyIds(publicKey)),
        }))
      );
      self.postMessage({ success: true, result });
      return;
    }
    if (
      job.type === 'sign' &&
      (job.key.role !== 'operator' || job.key.scheme === 'secp256k1')
    )
      throw new Error('Service updates require the registered operator');
    const result =
      job.type === 'import'
        ? await importSentryAuthorityKey(job.role, job.scheme, job.secretKey)
        : job.type === 'sign'
        ? await signSentryOperation(job.request, job.context, {
            ...job.key,
            scheme: job.key.scheme as 'bls-basic' | 'slh-dsa-shake-128s',
          })
        : job.type === 'signManagement'
        ? await signSentryManagementOperation(
            job.request,
            job.context,
            job.key,
            job.authorizationId
          )
        : job.type === 'signVote'
        ? await signSentryGovernanceVote(
            job.request,
            job.context,
            job.proTxHash,
            job.key
          )
        : undefined;
    if (!result) throw new Error('Unsupported Sentry operation');
    if (
      job.type === 'signVote' &&
      !(await verifySentryGovernanceVote(
        job.request,
        job.context,
        result as any
      ))
    )
      throw new Error('Generated vote failed verification');
    self.postMessage({ success: true, result });
  } catch {
    // Never forward library errors that might contain caller-supplied secrets.
    self.postMessage({
      success: false,
      error: 'Sentry key validation or authorization failed',
    });
  }
};
