import type { SentryCollateralReservation } from './sentryCollateral.ts';
import type { SentryKeySummary } from './sentryKeyVault.ts';
import type { SentryNodeLinkReview } from './sentryNodeManagement.ts';
import type { SentryNetwork } from '../shared/sentryNetworks';
import type { SentryLinkedNode } from '../shared/sentryNodeLookup';
import type {
  SentryOperationRequest,
  SentryOperationReview,
  SentryManagementRequest,
  SentryManagementReview,
  SentryRequiredAuthorization,
  SentryGovernanceVoteRequest,
} from '@sidhujag/sysweb3-sentry';

export type { SentryLinkedNode } from '../shared/sentryNodeLookup';
export type { SentryNetwork } from '../shared/sentryNetworks';

export type { SentryKeySummary } from './sentryKeyVault.ts';

export type SentrySettings = {
  collateral: SentryCollateralReservation[];
  keys: SentryKeySummary[];
  linkedNodes: SentryLinkedNode[];
  maxFeeSatoshis: string;
  network: SentryNetwork;
  serviceUrl: string;
};

export type SentryLinkApproval = SentryNodeLinkReview;

export type SentryApproval = {
  id: string;
  keys: Array<
    SentryKeySummary & { authorizationId?: SentryRequiredAuthorization['id'] }
  >;
  network: SentryNetwork;
  origin: string;
  request: SentryOperationRequest | SentryManagementRequest;
  review: SentryOperationReview | SentryManagementReview;
  serviceUrl: string;
};

export type SentryVoteApproval = {
  id: string;
  missingVotingKeys: string[];
  network: SentryNetwork;
  nodes: Array<{
    collateralOutpoint: { txid: string; vout: number };
    keyId: string;
    keyLabel: string;
    proTxHash: string;
    publicKey: string;
    votingKeyId: string;
  }>;
  origin: string;
  proposal?: { name: string; url?: string };
  request: SentryGovernanceVoteRequest;
  serviceUrl: string;
};

export type SentryApprovalScope = Readonly<{
  identity: string;
  network: { chainId: number; kind?: string; url: string };
  rootPublicIdentity: string;
}>;

/** Internal request authority; never included in public reviews or persistence. */
export type SentryRequestScope = SentryApprovalScope &
  Readonly<{
    assertRequestCurrent(): void;
  }>;
