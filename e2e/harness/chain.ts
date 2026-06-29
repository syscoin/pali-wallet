import { JsonRpcProvider } from '@ethersproject/providers';

import {
  getPaliInfrastructureContracts,
  type PaliInfrastructureContract,
} from '../../source/utils/smartAccount/deployment';

import { E2E_CONFIG } from './config';

// Direct RPC assertions, independent of the wallet UI. Journeys use these to
// confirm what the UI claims actually happened on-chain.

export const provider = new JsonRpcProvider(E2E_CONFIG.rpcUrl);

// The public testnet RPC occasionally returns transient 5xx responses; retry
// reads a few times so journeys don't fail on infrastructure hiccups.
const withRetries = async <T>(
  fn: () => Promise<T>,
  attempts = 4
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, 2_000 * (attempt + 1))
      );
    }
  }
  throw lastError;
};

export const getInfrastructureContracts =
  (): readonly PaliInfrastructureContract[] =>
    getPaliInfrastructureContracts(E2E_CONFIG.chainId);

export type InfraDeploymentState = {
  contract: PaliInfrastructureContract;
  deployed: boolean;
};

export const getInfrastructureState = async (): Promise<
  InfraDeploymentState[]
> =>
  Promise.all(
    getInfrastructureContracts().map(async (contract) => {
      const code = await withRetries(() => provider.getCode(contract.address));
      return { contract, deployed: code !== '0x' && code.length > 2 };
    })
  );

export const getNativeBalance = async (address: string): Promise<string> => {
  const balance = await withRetries(() => provider.getBalance(address));
  return balance.toString();
};

export const getCode = (address: string) =>
  withRetries(() => provider.getCode(address));

export const waitForTransaction = (hash: string, confirmations = 1) =>
  provider.waitForTransaction(hash, confirmations, 180_000);
