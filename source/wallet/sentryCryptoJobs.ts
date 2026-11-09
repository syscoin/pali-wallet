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

export type SentryCryptoResult =
  | SentryAuthorityKey
  | SentryOperationResponse
  | SentryManagementResponse
  | SentryGovernanceVoteResponse
  | SentryGovernanceVoteRequest
  | SentryGovernanceVoteReview
  | SentryOperationReview
  | SentryManagementReview
  | Array<{ compressed: string; publicKey: string; uncompressed: string }>;

export type RunSentryCrypto = <T extends SentryCryptoResult>(
  job: SentryCryptoJob,
  assertCurrent: () => void
) => Promise<T>;
