import type { NativePrivateAuthentication, NativePrivateAuthenticationScope } from '../custody/privateAuthentication.ts';
import type { SmartAccountModulesProjection } from '../../../../source/shared/smartAccountModules.ts';
import type { SmartAccountModuleRequest } from '../../../../source/shared/smartAccountModuleRequest.ts';
import type { NativeSmartCreationAllocation, NativeSmartCreationRequest } from '../smartAccount/preparation.ts';
import type { NativeSigningHandoff } from './signingHandoff.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import type { DappEncryptionSdk } from '../../../../source/wallet/dappEncryptionApproval.ts';
import type { NativeSmartAccountOperation } from '../smartAccount/operation.ts';
import type { ApprovalSummary } from '../../../../source/shared/approval.ts';
import type { AssetTransferCall } from '../../../../source/shared/assetTransfer.ts';
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
import type { NativeTokenInventory } from '../portfolio/tokenRegistry.ts';
import type { NativeWalletReadHost } from '../custody/dappWalletReads.ts';

export type NativeRequestAuthenticationBinder = (scope: NativePrivateAuthenticationScope, assertCurrent: () => void) => NativePrivateAuthentication;

export type NativeConnectionMessageSigning = Readonly<{
  accountId: string;
  networkId: string;
  request: DappMessageRequest;
  approval: ReturnType<typeof createDappSigningApproval>;
  handoff: NativeSigningHandoff;
}>;

export type NativeConnectionTransactionSigning = Readonly<{
  accountId: string;
  networkId: string;
  transaction: unknown;
  approval: ReturnType<typeof createDappSigningApproval>;
  handoff: NativeSigningHandoff;
}>;

export type NativePreparedSmartConnectionTransaction = Readonly<{
  operation: NativeSmartAccountOperation;
  approval: ApprovalSummary | null;
  batchApprovals?: readonly (ApprovalSummary | null)[];
  assetTransfer?: AssetTransferCall | null;
  batchAssetTransfers?: readonly (AssetTransferCall | null)[];
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
  registration(): NativeNetworkRegistration;
  signingContext(accountId: string): Readonly<{ trezor: boolean; binding: string }>;
  cancelSigningHandoff(job: object): Promise<void>;
  verifyPersonalMessage(message: string, signature: string): string;
  supportsAtomicCalls(accountId: string): boolean;
  readSmartAccountModules(accountId: string, networkId: string, assertCurrent: () => void): SmartAccountModulesProjection;
  readWalletTokenInventory?(accountId: string, networkId: string, assertCurrent: () => void): Promise<NativeTokenInventory>;
  supportsSmartAccountMessages(accountId: string): boolean;
  allocateSmartAccount(
    input: NativeSmartCreationRequest,
    signal: AbortSignal,
    assertRequestCurrent: () => void,
    onCommitted: (allocation: NativeSmartCreationAllocation) => void,
    authentication: NativePrivateAuthentication | null
  ): Promise<NativeSmartCreationAllocation>;
  /** Deploy and configure the requested target using the same durable allocation. */
  prepareSmartAccountCreationOperation(
    allocation: NativeSmartCreationAllocation,
    handoff: NativeSigningHandoff,
    assertCurrent: () => void,
    authentication: NativePrivateAuthentication | null
  ): Promise<NativeSmartAccountOperation>;
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
  handoff: NativeSigningHandoff;
    }>,
    assertCurrent: () => void,
    authentication: NativePrivateAuthentication | null
  ): Promise<NativePreparedSmartConnectionTransaction>;
  encryptionSdk(input: Readonly<{ accountId: string; networkId: string; approval: ReturnType<typeof createDappSigningApproval> }>, authentication: NativePrivateAuthentication | null): DappEncryptionSdk;
  signMessage(input: NativeConnectionMessageSigning, authentication: NativePrivateAuthentication | null): Promise<string>;
  prepareTransaction(
    input: NativeConnectionTransactionSigning,
    assertCurrent: () => void,
    authentication: NativePrivateAuthentication | null
  ): Promise<
    | NativePreparedConnectionTransaction
    | NativePreparedSmartConnectionTransaction
  >;
  prepareModuleChange(
    input: Readonly<{
      accountId: string;
      networkId: string;
      request: SmartAccountModuleRequest;
      approval: ReturnType<typeof createDappSigningApproval>;
      handoff: NativeSigningHandoff;
    }>,
    assertCurrent: () => void,
    authentication: NativePrivateAuthentication | null
  ): Promise<NativePreparedSmartConnectionTransaction>;
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
  walletReads?: NativeWalletReadHost;
  syscoin: NativeConnectionUtxoHost;
  psbt: NativeConnectionPsbtHost;
  sentry: NativeConnectionSentryHost;
  controls: NativeDappControlHost;
  reads: NativeConnectionReadHost;
}>;
