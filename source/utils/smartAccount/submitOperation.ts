import {
  NATIVE_EVM_FEE_FUNDING,
  assertSynchronousEvmFeeGuard,
} from '../../shared/evmFeeApproval.ts';
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
  getPaliEntryPointAddress,
  PALI_ENTRYPOINT_V09_ABI,
} from './contracts.ts';
import { getZkSysGasTankAddress } from './deploymentMetadata.ts';
import {
  hasNativeGasFailure,
  hasSmartAccountSignatureFailure,
} from './operationErrors.ts';
import { createSmartAccountGasTankFunding } from './payerPolicy.ts';
import {
  getExplicitSmartAccountGasPrice,
  type SmartAccountGasPayer,
} from './prepareOperation.ts';
import type {
  IKeyringAccountState,
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../types/network.ts';
import type { IEvmTransactionContext } from '../evmTransactionContext.ts';
const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
const SMART_ACCOUNT_SIGNATURE_ERROR = 'PALI_SMART_ACCOUNT_SIGNATURE_ERROR';
const PROVIDER_UNAVAILABLE_ERROR = 'Web3 provider not available';
export type SmartAccountSubmitParams = {
  accountId: number;
  executionCalldata?: string;
  executionContextId: string;
  executions?: SmartAccountExecution[];
  expectedContext?: IEvmTransactionContext;
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
export type SmartAccountSubmitHost<
  TResponse extends { hash: string; wait(): Promise<unknown> }
> = {
  assertExpectedExecutionContext(
    context: IEvmTransactionContext,
    id?: number
  ): void;
  assertGasTankCoversTransaction(params: any): Promise<BigNumber>;
  assertSmartAccountExecutionContext(id: string): void;
  chainId: number;
  ensureDeploymentPrefund(
    accountAddress: string,
    operation: SmartAccountPackedUserOperation,
    entryPoint: string,
    payer: SmartAccountGasPayer,
    chainId: number,
    options: {
      assertBeforeSign: () => void;
      assertCurrentContext(): void;
      onAcknowledged(): void;
      onSubmissionAttempt(): void;
    }
  ): Promise<void>;
  getExecutionContext(id: string):
    | {
        accountId: number;
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
  provider: any;
  sendTransaction(
    params: any,
    isLegacy?: boolean,
    targetAccount?: { id: number; type: KeyringAccountType },
    metadata?: Record<string, unknown>,
    options?: any
  ): Promise<TResponse>;
};

/** Shared financial submission order and acknowledged/unknown outcome handling. */
export async function submitSmartAccountOperation<
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
    params = Object.freeze({
      ...params,
      userOperation: Object.freeze({ ...params.userOperation }),
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
    let outerGasLimit: BigNumber | undefined;
    if (usesZkSysGasTank) {
      outerGasLimit = await host.assertGasTankCoversTransaction({
        chainId: active.metadata.chainId,
        gasPayerAddress: gasPayer.address,
        gasPrice: legacyGasPrice,
        maxFeePerGas: legacyGasPrice ?? params.maxFeePerGas,
        transaction: {
          data: callData,
          to: entryPointAddress,
          value: '0x0',
        },
      });
      assertCurrent();
    }
    // Self-funded first-UserOp deployment: an op carrying initCode validates
    // before anything executes, so the counterfactual account must already
    // cover the EntryPoint prefund.
    if (
      signedUserOperation.initCode &&
      signedUserOperation.initCode !== '0x' &&
      !requiredPrefund.isZero()
    ) {
      await host.ensureDeploymentPrefund(
        active.account.address,
        signedUserOperation,
        entryPointAddress,
        gasPayer,
        active.metadata.chainId,
        {
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
    // A supplied legacy price must reach the actual handleOps preflight;
    // estimation must not validate a different fee model from publication.
    // Existing EIP-1559 estimation stays fee-less. Tank mode reuses its exact
    // preflight, and the resolved gas limit avoids a second signer estimate.
    if (!outerGasLimit) {
      const provider = host.provider;
      if (!provider) {
        throw new Error(PROVIDER_UNAVAILABLE_ERROR);
      }
      outerGasLimit = BigNumber.from(
        await provider.estimateGas({
          data: callData,
          from: gasPayer.address,
          ...(legacyGasPrice !== undefined ? { gasPrice: legacyGasPrice } : {}),
          to: entryPointAddress,
          value: '0x0',
        })
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
        gasLimit: outerGasLimit.toString(),
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
