import { Transaction } from 'ethers/transaction';

import { NATIVE_EVM_FEE_FUNDING } from '../../shared/evmFeeApproval.ts';
import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import {
  BigNumber,
  Contract,
  getAddress,
  hexConcat,
} from '../ethersV6Compat.ts';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from '../evmTransactionContext.ts';

import {
  getSmartAccountUserOpRequiredPrefund,
  SMART_ACCOUNT_ZERO_GAS_FEES,
  type SmartAccountExecution,
  type SmartAccountPackedUserOperation,
} from './account.ts';
import { requireSmartAccountAddressIdentity } from './addressIdentity.ts';
import {
  assertSmartAccountSpendability,
  assertSmartAccountAssetSpendability,
} from './assetSpendability.ts';
import {
  getPaliEntryPointAddress,
  PALI_ENTRYPOINT_V09_ABI,
} from './contracts.ts';
import { getZkSysGasTankAddress } from './deploymentMetadata.ts';
import {
  snapshotSmartAccountExpectedErc20Transfers,
  type SmartAccountExpectedErc20Transfer,
} from './erc20Transfer.ts';
import { assertSignedSmartAccountExecution } from './executionSimulation.ts';
import {
  hasNativeGasFailure,
  hasSmartAccountSignatureFailure,
} from './operationErrors.ts';
import { createSmartAccountGasTankFunding } from './payerPolicy.ts';
import type { SmartAccountPendingState } from './pendingState.ts';
import {
  getExplicitSmartAccountGasPrice,
  type SmartAccountGasPayer,
} from './prepareOperation.ts';
import type { EvmAutoNonceSnapshot } from '../../shared/evmAutoNonce.ts';
import type {
  IKeyringAccountState,
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../types/network.ts';
import type { IEvmTransactionContext } from '../evmTransactionContext.ts';
const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
const SMART_ACCOUNT_SIGNATURE_ERROR = 'PALI_SMART_ACCOUNT_SIGNATURE_ERROR';
export type SmartAccountSubmitParams = {
  accountId: number;
  executionCalldata?: string;
  executionContextId: string;
  executions?: SmartAccountExecution[];
  expectedContext?: IEvmTransactionContext;
  expectedErc20Transfers?: readonly SmartAccountExpectedErc20Transfer[];
  gasPayer?: {
    address: string;
    id: number;
    type: KeyringAccountType;
  };
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  mode?: string;
  signature: string;
  skipRapidPolling?: boolean;
  userOperation: SmartAccountPackedUserOperation;
  validator?: string;
  waitForConfirmation?: boolean;
};
type SmartAccountRecord = {
  account: IKeyringAccountState;
  metadata: ISmartAccountMetadata;
};
export type SmartAccountSubmissionChecks = {
  assertAssetState(provider?: any): Promise<void>;
  assertPendingState(
    provider?: any,
    currentSignedHash?: string,
    admission?: EvmAutoNonceSnapshot,
    signedRaw?: string
  ): Promise<void>;
  readonly assertPendingStateIncludesAssets?: true;
};
export type SmartAccountSubmitHost<
  TResponse extends { hash: string; wait(): Promise<unknown> }
> = {
  assertExpectedExecutionContext(
    context: IEvmTransactionContext,
    id?: number
  ): void;
  assertSmartAccountExecutionContext(id: string): void;
  chainId: number;
  ensureDeploymentPrefund(
    accountAddress: string,
    operation: SmartAccountPackedUserOperation,
    entryPoint: string,
    payer: SmartAccountGasPayer,
    chainId: number,
    options: SmartAccountSubmissionChecks & {
      assertBeforeSign: () => void;
      assertCurrentContext(): void;
      onAcknowledged(): void;
      onSubmissionAttempt(): void;
    }
  ): Promise<void>;
  getExecutionContext(id: string):
    | {
        accountId: number;
        expectedErc20Transfers?: readonly SmartAccountExpectedErc20Transfer[];
        gasPrice?: string;
        userOperation: SmartAccountPackedUserOperation;
      }
    | undefined;
  getLocalNativeExecutionRecipients(
    executions: SmartAccountExecution[]
  ): Array<{ id: number; type: KeyringAccountType }>;
  getSmartAccountById(id: number): SmartAccountRecord;
  getWalletGasPayerAccount(
    preferred?: SmartAccountGasPayer,
    transaction?: { data?: string; to: string; value?: string },
    options?: { requirePreferred?: boolean }
  ): Promise<SmartAccountGasPayer>;
  invalidateMetadata(address: string): void;
  pending: SmartAccountPendingState;
  provider: any;
  sendTransaction(
    params: any,
    isLegacy?: boolean,
    targetAccount?: { id: number; type: KeyringAccountType },
    metadata?: Record<string, unknown>,
    options?: any
  ): Promise<TResponse>;
};

function snapshotSubmitParams(
  params: SmartAccountSubmitParams
): SmartAccountSubmitParams {
  return Object.freeze({
    ...params,
    userOperation: Object.freeze({ ...params.userOperation }),
    expectedErc20Transfers: snapshotSmartAccountExpectedErc20Transfers(
      params.expectedErc20Transfers
    ),
    ...(params.gasPayer
      ? { gasPayer: Object.freeze({ ...params.gasPayer }) }
      : {}),
    ...(params.executions
      ? {
          executions: params.executions.map((execution) =>
            Object.freeze({ ...execution })
          ),
        }
      : {}),
    ...(params.expectedContext
      ? {
          expectedContext: {
            ...params.expectedContext,
            account: { ...params.expectedContext.account },
          },
        }
      : {}),
  });
}

/** Shared financial submission order and acknowledged/unknown outcome handling. */
export async function submitSmartAccountOperation<
  TResponse extends { hash: string; wait(): Promise<unknown> }
>(
  params: SmartAccountSubmitParams,
  host: SmartAccountSubmitHost<TResponse>,
  assertApprovalCurrent: () => void
) {
  try {
    assertSynchronousEvmFeeGuard(assertApprovalCurrent);
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : 'Invalid approval'),
      { transactionNotBroadcast: true }
    );
  }
  params = snapshotSubmitParams(params);
  return host.pending.submit(params.userOperation, () =>
    submitOwnedSmartAccountOperation(params, host, assertApprovalCurrent)
  );
}

async function submitOwnedSmartAccountOperation<
  TResponse extends { hash: string; wait(): Promise<unknown> }
>(
  params: SmartAccountSubmitParams,
  host: SmartAccountSubmitHost<TResponse>,
  assertApprovalCurrent: () => void
) {
  // The call may first fund a counterfactual account, then submit handleOps.
  // Only failures before either sender is entered are definitely read-only.
  let financialSubmissionAttempted = false;
  let prefundAcknowledged = false;
  let handleOpsStarted = false;
  let acknowledgedHandleOpsHash: string | undefined;
  try {
    assertSynchronousEvmFeeGuard(assertApprovalCurrent);
    const legacyGasPrice = getExplicitSmartAccountGasPrice(params);
    const assertContext = () => {
      if (params.expectedContext) {
        host.assertExpectedExecutionContext(
          params.expectedContext,
          params.accountId
        );
        if (!params.executionContextId)
          throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
            transactionNotBroadcast: true,
          });
      }
      host.assertSmartAccountExecutionContext(params.executionContextId);
      const context = host.getExecutionContext(params.executionContextId);
      const suppliedOperation = params.userOperation;
      if (
        !context ||
        params.accountId !== context.accountId ||
        !suppliedOperation ||
        !context.userOperation ||
        params.gasPrice !== context.gasPrice ||
        JSON.stringify(params.expectedErc20Transfers) !==
          JSON.stringify(
            snapshotSmartAccountExpectedErc20Transfers(
              context.expectedErc20Transfers
            )
          ) ||
        Object.entries(context.userOperation).some(
          ([key, value]) =>
            suppliedOperation[key as keyof SmartAccountPackedUserOperation] !==
            value
        )
      )
        throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
          transactionNotBroadcast: true,
        });
    };
    const assertCurrent = () => {
      assertSynchronousEvmFeeGuard(assertApprovalCurrent);
      assertContext();
    };
    assertCurrent();
    const active = host.getSmartAccountById(params.accountId);
    if (!params.userOperation) {
      throw new Error(
        'Signed ERC-4337 UserOperation is required for smart account execution'
      );
    }
    if (
      getAddress(params.userOperation.sender) !==
      getAddress(active.account.address)
    ) {
      throw new Error(
        'Signed UserOperation does not match the active smart account'
      );
    }
    const initCode = params.userOperation.initCode;
    if (initCode && initCode !== '0x') {
      if (!params.executionContextId)
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      const deployment = requireSmartAccountAddressIdentity(
        active.account,
        host.chainId
      );
      if (
        initCode.toLowerCase() !==
        hexConcat([deployment.factory, deployment.factoryData]).toLowerCase()
      )
        throw new Error(
          'Signed UserOperation deployment does not match the smart account'
        );
    }
    const gasPayer = await host.getWalletGasPayerAccount(
      params.gasPayer || active.metadata.deploymentGasPayer,
      undefined,
      { requirePreferred: Boolean(params.gasPayer) }
    );
    assertCurrent();
    const entryPointAddress = getPaliEntryPointAddress(active.metadata.chainId);
    const entryPoint = new Contract(entryPointAddress, PALI_ENTRYPOINT_V09_ABI);
    const signedUserOperation: SmartAccountPackedUserOperation = {
      ...params.userOperation,
      signature: params.signature,
    };
    const submissionChecks: SmartAccountSubmissionChecks = {
      assertPendingStateIncludesAssets: true,
      async assertPendingState(
        provider,
        currentSignedHash,
        admission,
        signedRaw
      ) {
        const phase = provider
          ? host.pending.onProvider(provider, currentSignedHash, admission)
          : host.pending;
        await phase.assertNonce(signedUserOperation);
        await assertSmartAccountSpendability({
          provider: phase.provider,
          chainId: active.metadata.chainId,
          userOperation: signedUserOperation,
          expectedErc20Transfers: params.expectedErc20Transfers,
          assertCurrent,
        });
        if (currentSignedHash) {
          if (!signedRaw)
            throw new Error('Missing signed smart account payer transaction');
          const signed = Transaction.from(signedRaw);
          // Deployment prefunding has its own signed admission and is not handleOps.
          if (
            signed.to?.toLowerCase() !== entryPointAddress.toLowerCase() ||
            signed.data !== callData
          ) {
            if (
              signed.to?.toLowerCase() ===
                active.account.address.toLowerCase() &&
              signed.data === '0x'
            )
              return;
            throw new Error('Smart account payer transaction changed');
          }
          await assertSignedSmartAccountExecution(
            phase.provider,
            signedRaw,
            currentSignedHash,
            signedUserOperation,
            active.metadata.chainId,
            admission,
            assertCurrent
          );
        }
        assertCurrent();
      },
      assertAssetState: (provider) =>
        assertSmartAccountAssetSpendability({
          provider: provider
            ? host.pending.onProvider(provider).provider
            : host.provider,
          chainId: active.metadata.chainId,
          userOperation: signedUserOperation,
          expectedErc20Transfers: params.expectedErc20Transfers,
          assertCurrent,
        }),
    };
    assertCurrent();
    const callData = entryPoint.interface.encodeFunctionData('handleOps', [
      [signedUserOperation],
      gasPayer.address,
    ]);
    const recipientAccounts = host.getLocalNativeExecutionRecipients(
      params.executions || []
    );

    const requiredPrefund =
      getSmartAccountUserOpRequiredPrefund(signedUserOperation);
    const usesZkSysGasTank =
      Boolean(getZkSysGasTankAddress(active.metadata.chainId)) &&
      signedUserOperation.gasFees === SMART_ACCOUNT_ZERO_GAS_FEES;
    // Self-funded first-UserOp deployment: an op carrying initCode validates
    // before anything executes, so the counterfactual account must already
    // cover the EntryPoint prefund.
    if (
      signedUserOperation.initCode &&
      signedUserOperation.initCode !== '0x' &&
      !requiredPrefund.isZero()
    ) {
      await host.pending.withReadPhase(async (phase) => {
        await phase.assertNonce(signedUserOperation);
        await assertSmartAccountSpendability({
          provider: phase.provider,
          chainId: active.metadata.chainId,
          userOperation: signedUserOperation,
          expectedErc20Transfers: params.expectedErc20Transfers,
          assertCurrent,
        });
      });
      assertCurrent();
      await host.ensureDeploymentPrefund(
        active.account.address,
        signedUserOperation,
        entryPointAddress,
        gasPayer,
        active.metadata.chainId,
        {
          ...submissionChecks,
          assertBeforeSign: assertCurrent,
          assertCurrentContext: assertContext,
          onSubmissionAttempt() {
            financialSubmissionAttempted = true;
          },
          onAcknowledged() {
            prefundAcknowledged = true;
          },
        }
      );
      assertCurrent();
    }
    assertCurrent();
    financialSubmissionAttempted = true;
    handleOpsStarted = true;
    const response = await host.sendTransaction(
      {
        chainId: active.metadata.chainId,
        data: callData,
        from: gasPayer.address,
        ...(legacyGasPrice !== undefined
          ? { gasPrice: legacyGasPrice }
          : params.maxFeePerGas && params.maxPriorityFeePerGas
          ? {
              maxFeePerGas: params.maxFeePerGas,
              maxPriorityFeePerGas: params.maxPriorityFeePerGas,
            }
          : {}),
        to: entryPointAddress,
        value: '0x0',
      },
      legacyGasPrice !== undefined,
      { id: gasPayer.id, type: gasPayer.type },
      {
        smartAccountExecution: true,
        smartAccountExecutionFrom: active.account.address,
        // SYSCOIN: The outer handleOps recipient is not the affected token.
        balanceRefreshTokenAddresses: (params.executions || []).map(
          (execution) => execution.target
        ),
        balanceRefreshNativeAddresses: [
          gasPayer.address,
          ...(!requiredPrefund.isZero() ||
          (params.executions || []).some(
            (execution) => !BigNumber.from(execution.value || '0').isZero()
          )
            ? [active.account.address]
            : []),
          ...(params.executions || [])
            .filter(
              (execution) => !BigNumber.from(execution.value || '0').isZero()
            )
            .map((execution) => execution.target),
        ],
      },
      {
        feeFunding: usesZkSysGasTank
          ? createSmartAccountGasTankFunding(
              host.provider,
              {
                chainId: active.metadata.chainId,
                payer: gasPayer.address,
                to: entryPointAddress,
                data: callData,
                value: '0',
              },
              assertCurrent
            )
          : NATIVE_EVM_FEE_FUNDING,
        assertBeforeSign: assertCurrent,
        assertCurrentContext: assertContext,
        ...submissionChecks,
        clearNavigation: true,
        async onBroadcast(broadcast: { hash: string }) {
          acknowledgedHandleOpsHash = broadcast.hash;
        },
        persist: true,
        skipRapidPolling: params.skipRapidPolling,
        transactionAccounts: [
          {
            id: active.account.id,
            type: 'SmartAccount',
          },
          ...recipientAccounts,
        ],
      }
    );
    acknowledgedHandleOpsHash = response.hash;
    // Executions may install/uninstall modules or rotate the active
    // validator; drop the cached hydrated metadata for this account.
    host.invalidateMetadata(active.account.address);
    if (params.waitForConfirmation) {
      await response.wait();
    }
    return response;
  } catch (caught) {
    const error = caught as {
      code?: number;
      message?: string;
      transactionHash?: string;
      transactionNotBroadcast?: boolean;
    };
    const normalizedMessage = hasNativeGasFailure(error)
      ? NATIVE_GAS_REQUIRED_ERROR
      : hasSmartAccountSignatureFailure(error)
      ? SMART_ACCOUNT_SIGNATURE_ERROR
      : undefined;
    const acknowledged =
      typeof acknowledgedHandleOpsHash === 'string' &&
      /^0x[0-9a-fA-F]{64}$/.test(acknowledgedHandleOpsHash);
    const reportedHash = handleOpsStarted ? error?.transactionHash : undefined;
    const transactionHash = acknowledged
      ? acknowledgedHandleOpsHash
      : typeof reportedHash === 'string' &&
        /^0x[0-9a-fA-F]{64}$/.test(reportedHash)
      ? reportedHash
      : undefined;
    const transactionNotBroadcast =
      acknowledged || prefundAcknowledged
        ? false
        : financialSubmissionAttempted
        ? error?.transactionNotBroadcast
        : true;
    if (normalizedMessage) {
      const normalizedError = new Error(normalizedMessage);
      // Keep trusted submission facts when replacing provider text with a
      // UI sentinel. Losing false could permit an unsafe retry; losing true
      // would strand a definite rejection as an unknown submission.
      if (typeof transactionNotBroadcast === 'boolean')
        Object.assign(normalizedError, {
          transactionNotBroadcast,
        });
      if (transactionHash) Object.assign(normalizedError, { transactionHash });
      throw normalizedError;
    }
    if (!financialSubmissionAttempted) {
      // Do not mutate a frozen provider error or forward arbitrary fields.
      // After a prefund/send attempt, retain its existing outcome instead.
      const preflightError = new Error(
        typeof error?.message === 'string'
          ? error.message
          : 'Smart account preflight failed'
      );
      if (typeof error?.code === 'number')
        Object.assign(preflightError, { code: error.code });
      throw Object.assign(preflightError, { transactionNotBroadcast: true });
    }
    if (
      (acknowledged && transactionHash !== error?.transactionHash) ||
      ((acknowledged || prefundAcknowledged) &&
        error?.transactionNotBroadcast !== false) ||
      (!handleOpsStarted && error?.transactionHash !== undefined)
    ) {
      // A wait failure does not undo an acknowledged POST. The funding hash
      // can never stand in for the separate handleOps transaction.
      const failure = new Error(
        error?.message || 'Smart account execution did not complete',
        { cause: error }
      );
      if (typeof transactionNotBroadcast === 'boolean')
        Object.assign(failure, { transactionNotBroadcast });
      if (transactionHash) Object.assign(failure, { transactionHash });
      throw failure;
    }
    throw error;
  }
}
