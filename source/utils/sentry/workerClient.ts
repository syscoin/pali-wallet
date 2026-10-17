import { ensureOffscreenDocument } from 'utils/slhDsa/offscreenClient';

import type {
  SentryAuthorityKey,
  SentryAuthorityRole,
  SentryAuthorityScheme,
  SentryManagementRequest,
  SentryManagementContext,
  SentryManagementResponse,
  SentryRequiredAuthorization,
  SentryOperationRequest,
  SentryOperationResponse,
  SentryReviewContext,
  SentryGovernanceVoteContext,
  SentryGovernanceVoteRequest,
  SentryGovernanceVoteResponse,
  SentryGovernanceVoteReview,
  SentryOperationReview,
  SentryManagementReview,
} from '@sidhujag/sysweb3-sentry';

export type SentryCryptoJob =
  | {
      context: SentryManagementContext;
      request: SentryOperationRequest | SentryManagementRequest;
      type: 'verifyFee' | 'reviewOperation';
    }
  | { request: unknown; type: 'validateVote' }
  | {
      context: SentryGovernanceVoteContext;
      request: SentryGovernanceVoteRequest;
      type: 'reviewVote';
    }
  | { publicKeys: string[]; type: 'votingIdentities' }
  | {
      role: SentryAuthorityRole;
      scheme: SentryAuthorityScheme;
      secretKey: string;
      type: 'import';
    }
  | {
      context: SentryReviewContext;
      key: SentryAuthorityKey;
      request: SentryOperationRequest;
      type: 'sign';
    }
  | {
      authorizationId: SentryRequiredAuthorization['id'];
      context: SentryManagementContext;
      key: SentryAuthorityKey;
      request: SentryManagementRequest;
      type: 'signManagement';
    }
  | {
      context: SentryGovernanceVoteContext;
      key: SentryAuthorityKey;
      proTxHash: string;
      request: SentryGovernanceVoteRequest;
      type: 'signVote';
    };

export const runSentryCrypto = async <
  T extends
    | SentryAuthorityKey
    | SentryOperationResponse
    | SentryManagementResponse
    | SentryGovernanceVoteResponse
    | SentryGovernanceVoteRequest
    | SentryGovernanceVoteReview
    | SentryOperationReview
    | SentryManagementReview
    | Array<{ compressed: string; publicKey: string; uncompressed: string }>
>(
  job: SentryCryptoJob,
  assertCurrent: () => void
): Promise<T> => {
  assertCurrent();
  await ensureOffscreenDocument();
  assertCurrent();
  const response = await chrome.runtime.sendMessage({
    type: 'PALI_SENTRY_CRYPTO',
    job,
  });
  assertCurrent();
  if (!response || response.success !== true || !response.result)
    throw new Error(
      response?.error || 'Sentry cryptographic operation did not complete'
    );
  return response.result;
};
