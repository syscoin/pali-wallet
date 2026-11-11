import type { AssetTransferCall } from '../../../../source/shared/assetTransfer.ts';
import type { DappEncryptionMethod } from '../../../../source/shared/dappEncryptionRequest.ts';
import type { SmartAccountModuleRequestMethod } from '../../../../source/shared/smartAccountModuleRequest.ts';
import type { EvmDappFeeChoice, EvmDappFeeComparison } from '../../../../source/shared/evmDappFeePolicy.ts';
import type { NativeSmartAccountOperationSnapshot } from '../smartAccount/operation.ts';
import type { WalletConnectVerification } from './walletConnect.ts';
import type { DappMessageMethod } from '../../../../source/shared/dappMessageRequest.ts';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import type { ApprovalSummary } from '../../../../source/shared/approval.ts';
import type { CallsBundleStatus } from '../../../../source/wallet/dappCallsBundles.ts';
import type { NativeDappControlReview } from './controlRequests.ts';
import type { NativeDappReturnTarget } from './pairingReturn.ts';
import type { NativeSentryReview, NativeSentryAssent } from './sentryRequests.ts';
import type { NativePsbtReview } from './psbtRequests.ts';
import type { NativeSmartPreparationReview } from './smartPreparationRequests.ts';

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
  registrationHash?: string;
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

export type NativeMessageReview = NativeSigningReviewBase &
  Readonly<{
    kind: 'message';
    smartAccount: boolean;
    method: DappMessageMethod;
    message: string | null;
    typedData: string | null;
    order: Readonly<{
      protocol: '0x' | 'Seaport';
      status: 'recognized' | 'unrecognized';
      warnings: readonly (
        | 'send.nftOrderZeroPayment'
        | 'send.nftOrderNoReturn'
      )[];
    }> | null;
  }>;

export type NativeTransactionReview = NativeSigningReviewBase &
  Readonly<{
    kind: 'transaction';
    feeComparison: EvmDappFeeComparison | null;
    feeChoice: EvmDappFeeChoice | null;
    method: 'eth_sendTransaction' | 'wallet_sendCalls' | SmartAccountModuleRequestMethod;
    transaction: PreparedEvmTransaction | null;
    maximumFeeUnits: string | null;
    maximumTotalUnits: string | null;
    symbol: string;
    decimals: number;
    broadcastHash: string | null;
    approval: ApprovalSummary | null;
    assetTransfer?: AssetTransferCall | null;
    batch?: Readonly<{
      phase: 'preparing' | 'review' | 'submitting' | 'failed' | 'unknown' | 'complete';
      index: number;
      calls: readonly Readonly<{
        to: string | null;
        value: string;
        status: string;
        hash?: string;
      }>[];
    }>;
  }>;

export type NativeSmartTransactionReview = NativeSigningReviewBase &
  Readonly<{
    kind: 'smart-transaction';
    method: 'eth_sendTransaction' | 'wallet_sendCalls' | SmartAccountModuleRequestMethod;
    operation: NativeSmartAccountOperationSnapshot;
    approval: ApprovalSummary | null;
    batchApprovals?: readonly (ApprovalSummary | null)[];
    assetTransfer?: AssetTransferCall | null;
    batchAssetTransfers?: readonly (AssetTransferCall | null)[];
  }>;

export type NativeEncryptionReview = NativeSigningReviewBase & Readonly<{
  kind: 'encryption';
  method: DappEncryptionMethod;
  ciphertext: string | null;
}>;

export type NativeSigningReview =
  | NativeEncryptionReview
  | NativeMessageReview
  | NativeTransactionReview
  | NativeSmartTransactionReview;

export type NativeConnectionsSnapshot = Readonly<{
  preparationReview: NativeSmartPreparationReview | null;
  psbtReview: NativePsbtReview | null;
  sentryReview: NativeSentryReview | null;
  controlReview: NativeDappControlReview | null;
  callsStatus: Readonly<{
    id: string;
    origin: string;
    status: CallsBundleStatus;
  }> | null;
  revision: number;
  status: 'locked' | 'ready' | 'pairing' | 'approving' | 'unavailable';
  pairingExpiresAt: number | null;
  selectedAccountId: string | null;
  accounts: readonly Readonly<{ id: string; label: string; address: string }>[];
  network: Readonly<{ id: string; label: string; chainId: string }> | null;
  proposals: readonly Readonly<{
    id: number;
    name: string;
    origin: string;
    verification: WalletConnectVerification;
    expiresAt: number | null;
    requiredMethods: readonly string[];
    methodsByAccount: readonly Readonly<{ accountId: string; methods: readonly string[] }>[];
    canApprove: boolean;
  }>[];
  sessions: readonly Readonly<{
    id: string;
    name: string;
    origin: string;
    accountLabel: string;
    networkLabel: string;
    address: string | null;
    expiresAt: number;
    methods: readonly string[];
    returnTarget: NativeDappReturnTarget | null;
  }>[];
  signingReview: NativeSigningReview | null;
  error: NativeConnectionError | null;
}>;

/** Public view commands carry identifiers only, never transport or keyring handles. */
export type NativeConnectionsView = Readonly<{
  /** Status only for the exact current request; never grants signing authority. */
  isRequestAuthenticating(id: string): boolean;
  approveSmartPreparation(id: string, revision: number, externalOwnersAck: boolean): Promise<void>;
  confirmSmartPreparationPayer(id: string, revision: number, payerId: number): Promise<void>;
  retrySmartPreparationMetadata(id: string, revision: number): Promise<void>;
  rejectSmartPreparation(id: string): Promise<void>;
  approvePsbt(id: string, revision: number): Promise<void>;
  rejectPsbt(id: string): Promise<void>;
  backgroundSigning(): void;
  cancelSigningHandoff(): Promise<void>;
  resumeSigning(id: string): Promise<void>;
  approveSentry(id: string, revision: number, assent: NativeSentryAssent): Promise<void>;
  rejectSentry(id: string): Promise<void>;
  approveControl(id: string, revision: number): Promise<void>;
  rejectControl(id: string): Promise<void>;
  returnToDapp(id: string, revision: number): Promise<void>;
  callsStatusShown(id: string): Promise<void>;
  dismissCallsStatus(id: string): void;
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
  previewEncryption(id: string, revision: number): Promise<string>;
  approveRequest(
    id: string,
    revision: number,
    acknowledgeWarning: boolean
  ): Promise<void>;
  retrySmartMetadata(id: string, revision: number): Promise<void>;
  confirmSmartPayer(
    id: string,
    revision: number,
    payerId: number
  ): Promise<void>;
  rejectRequest(id: string): Promise<void>;
  activateRequestAccount(id: string, revision: number): Promise<void>;
  chooseTransactionFee(id: string, revision: number, choice: EvmDappFeeChoice): Promise<void>;
  editApprovalAmount(
    id: string,
    revision: number,
    amount: string
  ): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
}>;
