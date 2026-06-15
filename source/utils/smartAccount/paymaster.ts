import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import {
  hexConcat,
  hexDataSlice,
  hexZeroPad,
  isHexString,
} from '@ethersproject/bytes';
import { MaxUint256 } from '@ethersproject/constants';
import { Contract } from '@ethersproject/contracts';

import type { INetwork } from 'types/network';

import {
  getSmartAccountUserOpRequiredPrefund,
  type SmartAccountPackedUserOperation,
} from './account';
import type { Provider } from '@ethersproject/providers';

export type SmartAccountPaymasterConfig = NonNullable<
  INetwork['smartAccountPaymaster']
>;

export type SmartAccountPaymasterCapability = {
  feeToken?: SmartAccountPaymasterConfig['feeToken'];
  mode: 'optional' | 'required';
  paymaster: string;
  status: 'supported';
};

export type SmartAccountPaymasterContext = {
  chainId: number;
  entryPoint: string;
  userOperation: SmartAccountPackedUserOperation;
};

export type SmartAccountPaymasterPreflight = {
  allowance: BigNumber;
  balance: BigNumber;
  canApprove: boolean;
  canSponsor: boolean;
  required: BigNumber;
};

export type SmartAccountPaymasterApprovalSetup = {
  execution: {
    data: string;
    target: string;
    value: string;
  };
  paymaster: string;
  required: boolean;
  requiredAllowance: string;
  token: {
    address: string;
    symbol?: string;
  };
};

const normalizeBytes = (value?: string): string => {
  if (!value) {
    return '0x';
  }
  if (!isHexString(value)) {
    throw new Error('Smart account paymaster data must be hex encoded');
  }
  return value;
};

const encodeUint128 = (value: number | string): string =>
  hexZeroPad(BigNumber.from(value).toHexString(), 16);

const ERC20_PAYMASTER_PREFLIGHT_ABI = [
  'function approve(address spender,uint256 amount) returns (bool)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';
const ERC20_TRANSFER_FROM_SELECTOR = '0x23b872dd';

const erc20PaymasterPreflightInterface = new Interface(
  ERC20_PAYMASTER_PREFLIGHT_ABI
);

export const getSmartAccountPaymasterConfig = (
  network?: Pick<INetwork, 'smartAccountPaymaster'>
): SmartAccountPaymasterConfig | undefined => {
  const config = network?.smartAccountPaymaster;
  if (
    !config?.address ||
    config.paymasterVerificationGasLimit === undefined ||
    config.paymasterPostOpGasLimit === undefined
  ) {
    return undefined;
  }

  return {
    ...config,
    address: getAddress(config.address),
    paymasterData: normalizeBytes(config.paymasterData),
  };
};

export const getSmartAccountPaymasterCapability = (
  network?: Pick<INetwork, 'smartAccountPaymaster'>
): SmartAccountPaymasterCapability | undefined => {
  const config = getSmartAccountPaymasterConfig(network);
  if (!config) {
    return undefined;
  }

  return {
    feeToken: config.feeToken,
    mode: config.mode || 'optional',
    paymaster: config.address,
    status: 'supported',
  };
};

export const buildSmartAccountPaymasterAndData = (
  config: SmartAccountPaymasterConfig,
  context: SmartAccountPaymasterContext
): string => {
  void context;

  return hexConcat([
    getAddress(config.address),
    encodeUint128(config.paymasterVerificationGasLimit),
    encodeUint128(config.paymasterPostOpGasLimit),
    normalizeBytes(config.paymasterData),
  ]);
};

export const applySmartAccountPaymaster = (
  userOperation: SmartAccountPackedUserOperation,
  config: SmartAccountPaymasterConfig,
  context: Omit<SmartAccountPaymasterContext, 'userOperation'>
): SmartAccountPackedUserOperation => ({
  ...userOperation,
  paymasterAndData: buildSmartAccountPaymasterAndData(config, {
    ...context,
    userOperation,
  }),
});

export const hasSmartAccountPaymaster = (
  userOperation: Pick<SmartAccountPackedUserOperation, 'paymasterAndData'>
): boolean =>
  Boolean(
    userOperation.paymasterAndData && userOperation.paymasterAndData !== '0x'
  );

export const hasSmartAccountFeeTokenTransfer = (
  executions: Array<{ data?: string; target: string }>,
  config: Pick<SmartAccountPaymasterConfig, 'feeToken'>
): boolean => {
  if (!config.feeToken?.address) {
    return false;
  }

  const feeTokenAddress = getAddress(config.feeToken.address);
  return executions.some((execution) => {
    if (getAddress(execution.target) !== feeTokenAddress) {
      return false;
    }
    if (!execution.data || !isHexString(execution.data)) {
      return false;
    }

    const selector = hexDataSlice(execution.data, 0, 4).toLowerCase();
    return (
      selector === ERC20_TRANSFER_SELECTOR ||
      selector === ERC20_TRANSFER_FROM_SELECTOR
    );
  });
};

export const getSmartAccountPaymasterMaxTokenCost = (
  userOperation: Pick<
    SmartAccountPackedUserOperation,
    'accountGasLimits' | 'gasFees' | 'preVerificationGas'
  >,
  config: Pick<
    SmartAccountPaymasterConfig,
    | 'paymasterPostOpCost'
    | 'paymasterPostOpGasLimit'
    | 'paymasterVerificationGasLimit'
  >
): BigNumber => {
  const maxFeePerGas = BigNumber.from(
    hexDataSlice(userOperation.gasFees, 16, 32)
  );
  const chargedPostOpGas = BigNumber.from(
    config.paymasterPostOpCost ?? config.paymasterPostOpGasLimit
  );
  const paymasterGas = BigNumber.from(config.paymasterVerificationGasLimit).add(
    chargedPostOpGas
  );

  return getSmartAccountUserOpRequiredPrefund(userOperation).add(
    paymasterGas.mul(maxFeePerGas)
  );
};

export const getSmartAccountPaymasterPreflight = async (
  provider: Provider,
  userOperation: SmartAccountPackedUserOperation,
  config: SmartAccountPaymasterConfig,
  isDeployed: boolean
): Promise<SmartAccountPaymasterPreflight | undefined> => {
  if (!isDeployed || !config.feeToken?.address) {
    return undefined;
  }

  const token = new Contract(
    getAddress(config.feeToken.address),
    ERC20_PAYMASTER_PREFLIGHT_ABI,
    provider
  );
  const required = getSmartAccountPaymasterMaxTokenCost(userOperation, config);
  const [balance, allowance] = await Promise.all([
    token.balanceOf(userOperation.sender),
    token.allowance(userOperation.sender, config.address),
  ]);
  const normalizedBalance = BigNumber.from(balance);
  const normalizedAllowance = BigNumber.from(allowance);

  return {
    allowance: normalizedAllowance,
    balance: normalizedBalance,
    canApprove:
      normalizedBalance.gte(required) && normalizedAllowance.lt(required),
    canSponsor:
      normalizedBalance.gte(required) && normalizedAllowance.gte(required),
    required,
  };
};

export const canApplySmartAccountPaymaster = async (
  provider: Provider,
  userOperation: SmartAccountPackedUserOperation,
  config: SmartAccountPaymasterConfig,
  isDeployed: boolean
): Promise<boolean> => {
  const preflight = await getSmartAccountPaymasterPreflight(
    provider,
    userOperation,
    config,
    isDeployed
  );

  return Boolean(preflight?.canSponsor);
};

export const buildSmartAccountPaymasterApprovalSetup = (
  config: SmartAccountPaymasterConfig,
  requiredAllowance: BigNumber
): SmartAccountPaymasterApprovalSetup | undefined => {
  if (!config.feeToken?.address) {
    return undefined;
  }

  return {
    execution: {
      data: erc20PaymasterPreflightInterface.encodeFunctionData('approve', [
        config.address,
        MaxUint256,
      ]),
      target: getAddress(config.feeToken.address),
      value: '0x0',
    },
    paymaster: config.address,
    required: config.mode === 'required',
    requiredAllowance: requiredAllowance.toString(),
    token: {
      address: getAddress(config.feeToken.address),
      symbol: config.feeToken.symbol,
    },
  };
};
