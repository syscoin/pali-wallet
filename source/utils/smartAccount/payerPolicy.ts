import { BigNumber, Contract, getAddress } from '../ethersV6Compat.ts';

import {
  getSmartAccountUserOpRequiredPrefund,
  type SmartAccountPackedUserOperation,
} from './account.ts';
import { PALI_ENTRYPOINT_V09_ABI } from './contracts.ts';
import { getZkSysGasTankAddress } from './deploymentMetadata.ts';
import type { SmartAccountUserOpGasEstimate } from './gas.ts';
import {
  hasGuardianRecoveryNotReadyRevert,
  hasNativeGasFailure,
} from './operationErrors.ts';
import type { SmartAccountSubmitHost } from './submitOperation.ts';
import type {
  IKeyringAccountState,
  KeyringAccountType,
} from '../../types/network.ts';
export type SmartAccountPayerWallet = {
  accounts: Record<KeyringAccountType, Record<number, IKeyringAccountState>>;
  activeAccount: { id: number; type: KeyringAccountType };
};
const ZKSYS_GAS_TANK_ABI = [
  'function creditOf(address account) view returns (uint256)',
];
const SMART_ACCOUNT_GAS_TANK_OUTER_GAS_BUFFER = 50_000;
const ZKSYS_GAS_TANK_REQUIRED_ERROR = 'PALI_ZKSYS_GAS_TANK_REQUIRED';
const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
const PROVIDER_UNAVAILABLE_ERROR = 'Web3 provider not available';
export async function canUseSmartAccountGasTank(
  provider: any,
  {
    chainId,
    gasEstimate,
    gasPayerAddress,
    maxFeePerGas,
  }: {
    chainId: number;
    gasEstimate: SmartAccountUserOpGasEstimate;
    gasPayerAddress: string;
    maxFeePerGas: BigNumber;
  }
): Promise<boolean> {
  if (maxFeePerGas.isZero()) {
    return false;
  }
  const tankAddress = getZkSysGasTankAddress(chainId);
  if (!tankAddress) {
    return false;
  }
  if (!provider) {
    return false;
  }
  try {
    const tank = new Contract(tankAddress, ZKSYS_GAS_TANK_ABI, provider);
    const credit = BigNumber.from(await tank.creditOf(gasPayerAddress));
    const requiredCredit = BigNumber.from(
      gasEstimate.totalGasUnits + SMART_ACCOUNT_GAS_TANK_OUTER_GAS_BUFFER
    ).mul(maxFeePerGas);
    return credit.gte(requiredCredit);
  } catch {
    return false;
  }
}

export async function assertSmartAccountGasTankCredit(
  provider: any,
  {
    chainId,
    gasPrice,
    gasPayerAddress,
    maxFeePerGas,
    transaction,
  }: {
    chainId: number;
    gasPayerAddress: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    transaction: { data?: string; to: string; value?: string };
  }
): Promise<BigNumber> {
  const tankAddress = getZkSysGasTankAddress(chainId);
  if (!provider || !tankAddress) {
    throw new Error(ZKSYS_GAS_TANK_REQUIRED_ERROR);
  }
  const [gasLimit, rawCredit, feeData] = await Promise.all([
    provider.estimateGas({
      data: transaction.data || '0x',
      from: gasPayerAddress,
      ...(gasPrice !== undefined ? { gasPrice } : {}),
      to: transaction.to,
      value: transaction.value || '0x0',
    }),
    new Contract(tankAddress, ZKSYS_GAS_TANK_ABI, provider).creditOf(
      gasPayerAddress
    ),
    maxFeePerGas ? Promise.resolve(null) : provider.getFeeData(),
  ]);
  const credit = BigNumber.from(rawCredit);
  const estimatedGasLimit = BigNumber.from(gasLimit);
  const resolvedMaxFeePerGas = BigNumber.from(
    maxFeePerGas || feeData?.maxFeePerGas || feeData?.gasPrice || 0
  );
  const requiredCredit = estimatedGasLimit
    .add(SMART_ACCOUNT_GAS_TANK_OUTER_GAS_BUFFER)
    .mul(resolvedMaxFeePerGas);
  if (credit.lt(requiredCredit)) {
    throw new Error(ZKSYS_GAS_TANK_REQUIRED_ERROR);
  }
  return estimatedGasLimit;
}

export async function ensureSmartAccountDeploymentPrefund<
  TResponse extends { hash: string; wait(): Promise<unknown> }
>(
  provider: any,
  send: SmartAccountSubmitHost<TResponse>['sendTransaction'],
  accountAddress: string,
  userOperation: SmartAccountPackedUserOperation,
  entryPointAddress: string,
  gasPayer: { address: string; id: number; type: KeyringAccountType },
  chainId: number,
  options: {
    assertBeforeSign?: () => void;
    assertCurrentContext: () => void;
    onAcknowledged: () => void;
    onSubmissionAttempt: () => void;
  }
): Promise<void> {
  const assertCurrent = () => {
    options.assertBeforeSign?.();
    options.assertCurrentContext();
  };
  assertCurrent();
  if (!provider) {
    throw new Error(PROVIDER_UNAVAILABLE_ERROR);
  }
  const entryPoint = new Contract(
    entryPointAddress,
    PALI_ENTRYPOINT_V09_ABI,
    provider
  );
  const [balance, rawDeposit] = await Promise.all([
    provider.getBalance(accountAddress),
    entryPoint.balanceOf(accountAddress),
  ]);
  assertCurrent();
  const deposit = BigNumber.from(rawDeposit);
  const required = getSmartAccountUserOpRequiredPrefund(userOperation);
  const shortfall = required.sub(balance).sub(deposit);
  if (shortfall.lte(0)) {
    return;
  }
  options.onSubmissionAttempt();
  const response = await send(
    {
      chainId,
      from: gasPayer.address,
      to: getAddress(accountAddress),
      value: shortfall.toHexString(),
    },
    false,
    { id: gasPayer.id, type: gasPayer.type },
    {
      smartAccountAddress: getAddress(accountAddress),
      smartAccountDeploymentPrefund: true,
    },
    {
      assertBeforeSign: options.assertBeforeSign,
      assertCurrentContext: options.assertCurrentContext,
      clearNavigation: false,
      onBroadcast: async () => options.onAcknowledged(),
      persist: true,
      skipRapidPolling: true,
    }
  );
  await response.wait();
  assertCurrent();
}

export async function selectSmartAccountGasPayer(
  wallet: SmartAccountPayerWallet,
  provider: any,
  preferred?: {
    address: string;
    id: number;
    type: KeyringAccountType;
  },
  transaction?: {
    data?: string;
    to: string;
    value?: string;
  },
  options: { requirePreferred?: boolean } = {}
): Promise<{
  address: string;
  id: number;
  type: KeyringAccountType;
}> {
  const gasPayers = getSmartAccountGasPayerCandidates(wallet, preferred);

  const toGasPayer = ({
    address,
    id,
    type,
  }: {
    address: string;
    id: number;
    type: KeyringAccountType;
  }) => ({ address, id, type });

  if (options.requirePreferred) {
    const selected = gasPayers[0];
    if (
      !preferred ||
      !selected ||
      selected.id !== preferred.id ||
      selected.type !== preferred.type ||
      getAddress(selected.address) !== getAddress(preferred.address)
    ) {
      throw new Error(
        'The selected gas payer is no longer available for this smart-account transaction'
      );
    }
    return toGasPayer(selected);
  }

  if (provider) {
    if (transaction) {
      // Shared lookups hoisted out of the candidate loop: one fee-data call
      // and one batched balance fetch instead of repeating both per
      // candidate. Gas estimation stays per candidate because it depends on
      // the `from` address.
      const [feeData, balances] = await Promise.all([
        provider.getFeeData(),
        readSmartAccountNativeBalances(
          provider,
          gasPayers.map((candidate) => candidate.address)
        ),
      ]);
      const maxFeePerGas = BigNumber.from(
        feeData.maxFeePerGas || feeData.gasPrice || 0
      );
      for (let index = 0; index < gasPayers.length; index += 1) {
        const gasPayer = toGasPayer(gasPayers[index]!);
        const balance = balances[index]!;
        try {
          const gasLimit = BigNumber.from(
            await provider.estimateGas({
              data: transaction.data || '0x',
              from: gasPayer.address,
              to: transaction.to,
              value: transaction.value || '0x0',
            })
          );
          const requiredBalance = gasLimit
            .mul(maxFeePerGas)
            .add(BigNumber.from(transaction.value || '0x0'));
          if (balance.gte(requiredBalance)) {
            return gasPayer;
          }
        } catch (error) {
          if (hasGuardianRecoveryNotReadyRevert(error)) {
            throw error;
          }
          if (!hasNativeGasFailure(error)) {
            throw error;
          }
        }
      }
      throw new Error(NATIVE_GAS_REQUIRED_ERROR);
    }

    const cachedFundedGasPayer = gasPayers.find(({ account }) =>
      hasCachedNativeBalance(account)
    );
    if (cachedFundedGasPayer) {
      return toGasPayer(cachedFundedGasPayer);
    }

    const balances = await readSmartAccountNativeBalances(
      provider,
      gasPayers.map((candidate) => candidate.address)
    );
    for (let index = 0; index < gasPayers.length; index += 1) {
      if (!balances[index]!.isZero()) {
        return toGasPayer(gasPayers[index]!);
      }
    }
  }

  if (gasPayers[0]) {
    return toGasPayer(gasPayers[0]);
  }

  throw new Error(
    'A local EVM account is required to submit ERC-4337 operations'
  );
}

export function getSmartAccountGasPayerCandidates(
  wallet: SmartAccountPayerWallet,
  preferred?: {
    address: string;
    id: number;
    type: KeyringAccountType;
  }
): Array<{
  account: any;
  address: string;
  id: number;
  type: KeyringAccountType;
}> {
  const { accounts, activeAccount } = wallet;
  const candidates: Array<{ id: number; type: KeyringAccountType }> = [];
  if (preferred?.type && preferred.type !== 'SmartAccount') {
    candidates.push({ id: preferred.id, type: preferred.type });
  }
  if (activeAccount.type !== 'SmartAccount') {
    candidates.push({ id: activeAccount.id, type: activeAccount.type });
  }
  candidates.push({ id: 0, type: 'HDAccount' as KeyringAccountType });
  candidates.push(
    ...Object.keys(accounts['Imported'] || {}).map((id) => ({
      id: Number(id),
      type: 'Imported' as KeyringAccountType,
    }))
  );

  const seen = new Set<string>();
  const gasPayers: Array<{
    account: any;
    address: string;
    id: number;
    type: KeyringAccountType;
  }> = [];

  for (const candidate of candidates) {
    const candidateKey = `${candidate.type}:${candidate.id}`;
    if (seen.has(candidateKey)) {
      continue;
    }
    seen.add(candidateKey);
    const account = accounts[candidate.type]?.[candidate.id];
    if (account?.address) {
      if (
        preferred &&
        candidate.id === preferred.id &&
        candidate.type === preferred.type &&
        getAddress(account.address) !== getAddress(preferred.address)
      ) {
        continue;
      }
      gasPayers.push({
        account,
        address: getAddress(account.address),
        id: candidate.id,
        type: candidate.type,
      });
    }
  }
  return gasPayers;
}

export async function readSmartAccountNativeBalances(
  provider: any,
  addresses: string[]
): Promise<BigNumber[]> {
  if (addresses.length === 0) {
    return [];
  }
  if (addresses.length > 1 && typeof provider.sendBatch === 'function') {
    try {
      const results = await provider.sendBatch(
        'eth_getBalance',
        addresses.map((address) => [address, 'latest'])
      );
      return results.map((result: string) => BigNumber.from(result || 0));
    } catch {
      // Fall back to individual calls below.
    }
  }
  // Individual ethers-v6 reads return bigint, unlike the batch hex path.
  // Keep this helper's numeric type stable for all gas-payer checks.
  return Promise.all(
    addresses.map(async (address) =>
      BigNumber.from(await provider.getBalance(address))
    )
  );
}

export function hasCachedNativeBalance(account: any): boolean {
  const balance = account?.balances?.ethereum;
  if (balance === undefined || balance === null) {
    return false;
  }
  return Number(balance) > 0;
}
