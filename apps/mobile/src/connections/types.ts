import type { WalletConnectVerification } from './walletConnect.ts';
import type { DappMessageMethod } from '../../../../source/shared/dappMessageRequest.ts';

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
  | 'DELIVERY_UNCERTAIN';

export type NativeMessageReview = Readonly<{
  id: string;
  revision: number;
  method: DappMessageMethod;
  appName: string;
  origin: string;
  verification: WalletConnectVerification;
  accountLabel: string;
  address: string;
  networkLabel: string;
  chainId: string;
  expiresAt: number;
  message: string | null;
  typedData: string | null;
  order: Readonly<{
    protocol: '0x' | 'Seaport';
    status: 'recognized' | 'unrecognized';
    warnings: readonly ('send.nftOrderZeroPayment' | 'send.nftOrderNoReturn')[];
  }> | null;
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
  messageReview: NativeMessageReview | null;
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
  approveMessage(
    id: string,
    revision: number,
    acknowledgeWarning: boolean
  ): Promise<void>;
  rejectMessage(id: string): Promise<void>;
  activateMessageAccount(id: string, revision: number): Promise<void>;
  cancel(): void;
}>;
