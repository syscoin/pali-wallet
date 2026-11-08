import type { WalletConnectVerification } from './walletConnect.ts';
import type { DappMessageMethod } from '../../../../source/shared/dappMessageRequest.ts';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

export type NativeConnectionError =
  | 'INVALID_LINK'
  | 'REQUEST_EXPIRED'
  | 'CONTEXT_CHANGED'
  | 'UNSUPPORTED_REQUEST'
  | 'SITE_MISMATCH'
  | 'BLOCKED_SITE'
  | 'DELIVERY_UNCERTAIN'
  | 'CONNECTION_UNAVAILABLE'
  | 'BUSY';

export type NativeMessageReviewError =
  | 'INVALID_MESSAGE'
  | 'SIGNER_MISMATCH'
  | 'SUSPICIOUS_SIGN_IN'
  | 'INVALID_TYPED_DATA'
  | 'BLOCKED_SITE'
  | 'SITE_MISMATCH'
  | 'DELIVERY_UNCERTAIN'
  | 'INVALID_TRANSACTION'
  | 'TRANSACTION_UNAVAILABLE';

type NativeSigningReviewBase = Readonly<{
  id: string;
  revision: number;
  appName: string;
  origin: string;
  verification: WalletConnectVerification;
  accountLabel: string;
  address: string;
  networkLabel: string;
  chainId: string;
  expiresAt: number;
  error: NativeMessageReviewError | null;
  needsAccountSwitch: boolean;
  busy: boolean;
  dispatched: boolean;
  advisories: readonly Readonly<{
    address: string;
    field: string;
    reason?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>[];
  requiresWarningAcknowledgement: boolean;
}>;

export type NativeMessageReview = NativeSigningReviewBase & Readonly<{
  kind: 'message';
  method: DappMessageMethod;
  message: string | null;
  typedData: string | null;
  order: Readonly<{
    protocol: '0x' | 'Seaport';
    status: 'recognized' | 'unrecognized';
    warnings: readonly ('send.nftOrderZeroPayment' | 'send.nftOrderNoReturn')[];
  }> | null;
}>;

export type NativeTransactionReview = NativeSigningReviewBase & Readonly<{
  kind: 'transaction';
  method: 'eth_sendTransaction';
  transaction: PreparedEvmTransaction | null;
  maximumFeeUnits: string | null;
  maximumTotalUnits: string | null;
  symbol: string;
  decimals: number;
  broadcastHash: string | null;
}>;

export type NativeSigningReview = NativeMessageReview | NativeTransactionReview;

export type NativeConnectionsSnapshot = Readonly<{
  revision: number;
  status: 'locked' | 'ready' | 'pairing' | 'approving' | 'unavailable';
  selectedAccountId: string | null;
  accounts: readonly Readonly<{ id: string; label: string; address: string }>[];
  network: Readonly<{ id: string; label: string; chainId: string }> | null;
  proposals: readonly Readonly<{
    id: number;
    name: string;
    origin: string;
    verification: WalletConnectVerification;
    requiredMethods: readonly string[];
    canApprove: boolean;
  }>[];
  sessions: readonly Readonly<{
    id: string;
    name: string;
    origin: string;
    accountLabel: string;
    networkLabel: string;
  }>[];
  signingReview: NativeSigningReview | null;
  error: NativeConnectionError | null;
}>;

/** Public view commands carry identifiers only, never transport or keyring handles. */
export type NativeConnectionsView = Readonly<{
  getSnapshot(): NativeConnectionsSnapshot;
  subscribe(listener: () => void): () => void;
  pair(uri: string): Promise<void>;
  approve(
    proposalId: number,
    accountId: string,
    networkId: string,
    revision: number
  ): Promise<void>;
  reject(proposalId: number): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  approveRequest(
    id: string,
    revision: number,
    acknowledgeWarning: boolean
  ): Promise<void>;
  rejectRequest(id: string): Promise<void>;
  activateRequestAccount(id: string, revision: number): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
}>;
