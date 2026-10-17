import type { SentryCollateralReservation } from './collateral';
import type {
  SentryOperationRequest,
  SentryOperationReview,
  SentryAuthorityScheme,
  SentryAuthorityRole,
  SentryManagementRequest,
  SentryManagementReview,
  SentryRequiredAuthorization,
} from '@sidhujag/sysweb3-sentry';

export type SentryNetwork = 'mainnet' | 'testnet';

export interface SentryKeySummary {
  id: string;
  label: string;
  network: SentryNetwork;
  publicKey: string;
  role: SentryAuthorityRole;
  scheme: SentryAuthorityScheme;
}

export interface SentrySettings {
  collateral: SentryCollateralReservation[];
  keys: SentryKeySummary[];
  linkedNodes: SentryLinkedNode[];
  maxFeeSatoshis: string;
  network: SentryNetwork;
  serviceUrl: string;
}

export interface SentryLinkedNode {
  collateralOutpoint: { txid: string; vout: number };
  nevmAddress: string;
  proTxHash: string;
  service: string;
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
