import type { SentryCollateralReservation } from './collateral';
import type { SentryNetwork } from '../../shared/sentryNetworks';
import type { SentryLinkedNode } from '../../shared/sentryNodeLookup';
import type { SentryKeySummary } from '../../wallet/sentryKeyVault';
import type {
  SentryOperationRequest,
  SentryOperationReview,
  SentryManagementRequest,
  SentryManagementReview,
  SentryRequiredAuthorization,
  SentryGovernanceVoteRequest,
} from '@sidhujag/sysweb3-sentry';

export type { SentryLinkedNode } from '../../shared/sentryNodeLookup';
export type { SentryNetwork } from '../../shared/sentryNetworks';

export type { SentryKeySummary } from '../../wallet/sentryKeyVault';

export interface SentrySettings {
  collateral: SentryCollateralReservation[];
  keys: SentryKeySummary[];
  linkedNodes: SentryLinkedNode[];
  maxFeeSatoshis: string;
  network: SentryNetwork;
  serviceUrl: string;
}

export interface SentryLinkApproval {
  id: string;
  network: SentryNetwork;
  node: SentryLinkedNode;
  origin: string;
  serviceUrl: string;
}

export interface SentryApproval {
  id: string;
  keys: Array<
    SentryKeySummary & { authorizationId?: SentryRequiredAuthorization['id'] }
  >;
  network: SentryNetwork;
  origin: string;
  request: SentryOperationRequest | SentryManagementRequest;
  review: SentryOperationReview | SentryManagementReview;
  serviceUrl: string;
}

export interface SentryVoteApproval {
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
}
