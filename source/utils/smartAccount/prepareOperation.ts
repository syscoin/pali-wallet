import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeApproval.ts';
import { BigNumber, Contract, hexConcat } from '../ethersV6Compat.ts';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from '../evmTransactionContext.ts';

import {
  buildSmartAccountUserOperation,
  encodeSmartAccountGasLimits,
  getSmartAccountUserOpGasFees,
} from './account.ts';
import { toPaliSmartAccount } from './adapter.ts';
import { requireSmartAccountAddressIdentity } from './addressIdentity.ts';
import {
  getPaliEntryPointAddress,
  getPaliSmartAccountFactoryAddress,
  PALI_ENTRYPOINT_V09_ABI,
  paliSmartAccountInterface,
} from './contracts.ts';
import {
  estimateSmartAccountUserOpGas,
  getSmartAccountValidatorProfile,
  type SmartAccountUserOpGasEstimate,
} from './gas.ts';
import { getSmartAccountUserOpHash } from './userOperationHash.ts';
import type {
  IKeyringAccountState,
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../types/network.ts';

export type SmartAccountFeeOverrides = {
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};
export type SmartAccountGasPayer = {
  address: string;
  id: number;
  type: KeyringAccountType;
};

export function getExplicitSmartAccountGasPrice(
  fees?: SmartAccountFeeOverrides
): string | undefined {
  if (fees?.gasPrice === null || fees?.gasPrice === undefined) return undefined;
  try {
    if (
      (fees.maxFeePerGas !== null && fees.maxFeePerGas !== undefined) ||
      (fees.maxPriorityFeePerGas !== null &&
        fees.maxPriorityFeePerGas !== undefined)
    )
      throw new Error('Legacy gasPrice cannot be combined with EIP-1559 fees');
    const price = BigNumber.from(fees.gasPrice);
    if (price.lt(0) || price.gte(BigNumber.from(2).pow(128)))
      throw new Error('Invalid smart-account legacy gas price');
    return price.toString();
  } catch (error) {
    throw Object.assign(
      error instanceof Error
        ? error
        : new Error('Invalid smart-account legacy gas price'),
      { transactionNotBroadcast: true }
    );
  }
}

export function requireSmartAccountAuthenticator(
  metadata: ISmartAccountMetadata
) {
  const auth = metadata.auth;
  if (!auth)
    throw new Error(
      'This smart account was recovered by address only. Configure or recover an authenticator before signing.'
    );
  const module = auth.module || auth.scheme;
  if (!module)
    throw new Error('Smart account authenticator module metadata is required');
  if (module === 'custom')
    throw new Error(
      'The active validator is a custom module Pali cannot sign with. Switch to a Pali-signable validator first.'
    );
  return { data: auth.data, module, validator: auth.validator };
}

/** One preparation policy shared by the extension and native custody hosts. */
export async function prepareSmartAccountOperation({
  account,
  chainId,
  executions,
  feeOverrides = {},
  knownDeployed,
  provider,
  selectGasPayer,
  assertCurrent,
}: {
  account: Pick<IKeyringAccountState, 'address' | 'xpub'> & {
    smartAccount: ISmartAccountMetadata;
  };
  assertCurrent(): void;
  chainId: number;
  executions: Array<{ data?: string; target: string; value: string }>;
  feeOverrides?: SmartAccountFeeOverrides;
  knownDeployed: boolean;
  provider: any;
  selectGasPayer(
    gasEstimate: SmartAccountUserOpGasEstimate,
    maxFeePerGas: BigNumber
  ): Promise<{ gasPayer: SmartAccountGasPayer; useGasTank: boolean }>;
}) {
  assertSynchronousEvmFeeGuard(assertCurrent);
  feeOverrides = { ...feeOverrides };
  executions = executions.map((execution) => ({ ...execution }));
  const metadata = account.smartAccount;
  if (metadata.chainId !== chainId)
    throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
      transactionNotBroadcast: true,
    });
  const legacyGasPrice = getExplicitSmartAccountGasPrice(feeOverrides);
  const auth = requireSmartAccountAuthenticator(metadata);
  const deploySalt =
    metadata.descriptor?.deploymentSalt || metadata.deploymentSalt;
  if (!deploySalt) throw new Error('Smart account deployment salt is required');
  const smartAccount = await toPaliSmartAccount({
    address: account.address,
    auth,
    chainId,
    deploySalt,
    factoryAddress:
      metadata.factoryAddress || getPaliSmartAccountFactoryAddress(chainId),
    provider,
  });
  assertSynchronousEvmFeeGuard(assertCurrent);
  const prepared = smartAccount.encodeExecutions(executions);
  const entryPointAddress = getPaliEntryPointAddress(chainId);
  const entryPoint = new Contract(
    entryPointAddress,
    PALI_ENTRYPOINT_V09_ABI,
    provider
  );
  const code = knownDeployed
    ? 'cached-deployed'
    : await provider.getCode(account.address);
  assertSynchronousEvmFeeGuard(assertCurrent);
  const deployment =
    code === '0x' ? requireSmartAccountAddressIdentity(account, chainId) : null;
  if (code !== '0x' && !knownDeployed) {
    const contract = new Contract(
      account.address,
      paliSmartAccountInterface,
      provider
    );
    if (!(await contract.supportsExecutionMode(prepared.mode)))
      throw new Error(
        'This smart account does not support the requested execution mode'
      );
    assertSynchronousEvmFeeGuard(assertCurrent);
  }
  const nonce = (
    await entryPoint.getNonce(account.address, smartAccount.getNonceKey())
  ).toString();
  assertSynchronousEvmFeeGuard(assertCurrent);
  const callData = smartAccount.encodeCalls(executions);
  const feeData = await provider.getFeeData();
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (
    legacyGasPrice !== undefined &&
    feeData.lastBaseFeePerGas !== null &&
    feeData.lastBaseFeePerGas !== undefined &&
    BigNumber.from(legacyGasPrice).lt(feeData.lastBaseFeePerGas)
  )
    throw Object.assign(
      new Error(
        'Legacy gas price is below the current base fee. Refresh the app quote.'
      ),
      { transactionNotBroadcast: true }
    );
  const validatorProfile = getSmartAccountValidatorProfile(metadata);
  const gasEstimate = await estimateSmartAccountUserOpGas(provider, {
    callData,
    childValidatorCount: validatorProfile.childValidatorCount,
    entryPointAddress,
    isDeployed: code !== '0x',
    sender: account.address,
    slhDsaChildCount: validatorProfile.slhDsaChildCount,
    validatorKind: validatorProfile.validatorKind,
  });
  assertSynchronousEvmFeeGuard(assertCurrent);
  const hasOuterEip1559FeeParams =
    legacyGasPrice === undefined &&
    ((feeOverrides.maxFeePerGas !== null &&
      feeOverrides.maxFeePerGas !== undefined &&
      feeOverrides.maxPriorityFeePerGas !== null &&
      feeOverrides.maxPriorityFeePerGas !== undefined) ||
      (feeData.maxFeePerGas !== null &&
        feeData.maxFeePerGas !== undefined &&
        feeData.maxPriorityFeePerGas !== null &&
        feeData.maxPriorityFeePerGas !== undefined));
  const maxFeePerGas = BigNumber.from(
    legacyGasPrice ??
      feeOverrides.maxFeePerGas ??
      feeData.maxFeePerGas ??
      feeData.gasPrice ??
      0
  );
  const maxPriorityFeePerGas = BigNumber.from(
    legacyGasPrice ??
      feeOverrides.maxPriorityFeePerGas ??
      feeData.maxPriorityFeePerGas ??
      0
  );
  const { gasPayer, useGasTank } = await selectGasPayer(
    gasEstimate,
    maxFeePerGas
  );
  assertSynchronousEvmFeeGuard(assertCurrent);
  const userOperation = buildSmartAccountUserOperation({
    accountGasLimits: encodeSmartAccountGasLimits({
      callGasLimit: gasEstimate.callGasLimit,
      verificationGasLimit: gasEstimate.verificationGasLimit,
    }),
    callData,
    gasFees: getSmartAccountUserOpGasFees({
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      useZkSysGasTank: useGasTank,
    }),
    initCode: deployment
      ? hexConcat([deployment.factory, deployment.factoryData])
      : '0x',
    nonce,
    preVerificationGas: String(gasEstimate.preVerificationGas),
    sender: account.address,
  });
  const actionHash = getSmartAccountUserOpHash(userOperation, chainId);
  assertSynchronousEvmFeeGuard(assertCurrent);
  const orderedExecutions = prepared.executions.map((execution) => ({
    ...execution,
    nonce,
  }));
  return {
    actionHash,
    execution: orderedExecutions[0],
    executionCalldata: prepared.executionCalldata,
    executions: orderedExecutions,
    gasPayer,
    gasPrice: legacyGasPrice,
    maxFeePerGas:
      legacyGasPrice === undefined ? maxFeePerGas.toString() : undefined,
    maxPriorityFeePerGas: hasOuterEip1559FeeParams
      ? maxPriorityFeePerGas.toString()
      : undefined,
    mode: prepared.mode,
    smartAccount: metadata,
    userOperation,
    validator: auth.validator,
  };
}
