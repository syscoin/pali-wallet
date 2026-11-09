import type { NativeSmartAccountOperation } from '../smartAccount/operation.ts';
import type { ApprovalSummary } from '../../../../source/shared/approval.ts';
import type { NativePreparedConnectionTransaction } from './transactionRuntime.ts';
import type { INetwork } from '../../../../source/types/network.ts';
import type { NativeConnectionRepository } from './storage.ts';
import type { DappMessageRequest } from '../../../../source/shared/dappMessageRequest.ts';
import type { createDappSigningApproval } from '../../../../source/wallet/dappSigningApproval.ts';
import type { DappCallsRequest } from '../../../../source/shared/dappCalls.ts';
import type { CallsBundleStatus } from '../../../../source/wallet/dappCallsBundles.ts';
import type { EoaCallsStopped } from '../../../../source/wallet/evmCallsSequence.ts';
import type { NativeDappControlHost } from './controlRequests.ts';
import type { NativeConnectionReadHost } from '../custody/dappRpcReads.ts';
import type { NativeConnectionSentryHost } from './sentryRequests.ts';
import type { NativeConnectionUtxoHost } from '../custody/dappSyscoin.ts';
import type { NativeConnectionPsbtHost } from './psbtRequests.ts';

export type NativeConnectionMessageSigning = Readonly<{
  accountId: string;
  networkId: string;
  request: DappMessageRequest;
  approval: ReturnType<typeof createDappSigningApproval>;
}>;

export type NativeConnectionTransactionSigning = Readonly<{
  accountId: string;
  networkId: string;
  transaction: unknown;
  approval: ReturnType<typeof createDappSigningApproval>;
}>;

export type NativePreparedSmartConnectionTransaction = Readonly<{
  operation: NativeSmartAccountOperation;
  approval: ApprovalSummary | null;
  batchApprovals?: readonly (ApprovalSummary | null)[];
}>;

export type NativeConnectionAccount = Readonly<{
  id: string;
  index: number;
  type: 'HDAccount' | 'Imported' | 'SmartAccount' | 'Ledger' | 'Trezor';
  address: string;
  xpub: string;
  label: string;
}>;

/** Internal connection capabilities. This host never belongs in React state. */
export type NativeConnectionSigningHost = Readonly<{
  repository: NativeConnectionRepository;
  calls: NativeConnectionRepository['calls'];
  walletBindingId: string;
  /** Stable wallet/runtime lifetime, deliberately independent of lock state. */
  assertOwner(): void;
  sessionGeneration(): number;
  verifyPersonalMessage(message: string, signature: string): string;
  supportsAtomicCalls(accountId: string): boolean;
  supportsSmartAccountMessages(accountId: string): boolean;
  /** Caller proves that the per-call consent sequence no longer exists. */
  recoverStoppedEoaCalls(origin: string, id: string, assertStopped: () => void): Promise<void>;
  readCallsStatus(
    origin: string,
    id: string,
    assertCurrent: () => void
  ): Promise<CallsBundleStatus>;
  recordStoppedEoaCalls(input: Readonly<{
    origin: string;
    bundleId: string;
    reservationId: string;
    submissionId: string;
    attempt: EoaCallsStopped;
  }>): Promise<void>;
  prepareCalls(
    input: Readonly<{
      accountId: string;
      networkId: string;
      calls: DappCallsRequest;
      origin: string;
      bundleId: string;
      reservationId: string;
      approval: ReturnType<typeof createDappSigningApproval>;
    }>,
    assertCurrent: () => void
  ): Promise<NativePreparedSmartConnectionTransaction>;
  signMessage(input: NativeConnectionMessageSigning): Promise<string>;
  prepareTransaction(
    input: NativeConnectionTransactionSigning,
    assertCurrent: () => void
  ): Promise<
    | NativePreparedConnectionTransaction
    | NativePreparedSmartConnectionTransaction
  >;
  context(): Readonly<{
    network: INetwork;
    networkId: string;
    networkLabel: string;
    activeAccountId: string | null;
    accounts: readonly NativeConnectionAccount[];
    unlocked: boolean;
  }>;
}>;

/** The platform composes wallet controls with the runtime's crypto/session host. */
export type NativeConnectionHost = NativeConnectionSigningHost & Readonly<{
  syscoin: NativeConnectionUtxoHost;
  psbt: NativeConnectionPsbtHost;
  sentry: NativeConnectionSentryHost;
  controls: NativeDappControlHost;
  reads: NativeConnectionReadHost;
}>;
