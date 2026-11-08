import { getAddress } from '../ethersV6Compat.ts';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from '../evmTransactionContext.ts';

import {
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
  getPaliSmartAccountDescriptor,
} from './account.ts';
import {
  createOwnedPaliSmartAccountFactory,
  toPaliSmartAccount,
} from './adapter.ts';
import { getAvailablePaliModules } from './capabilities.ts';
import {
  getPaliSmartAccountFactoryAddress,
  PALI_SMART_ACCOUNT_VERSION,
} from './contracts.ts';
import type { ISmartAccountMetadata } from '../../types/network.ts';
import type { TransactionRequest } from 'ethers/providers';

export type SmartAccountBootstrapProvider = {
  call(transaction: TransactionRequest): Promise<string>;
  getNetwork(): Promise<{ chainId: bigint }>;
  verifyConfiguredChainId(force?: boolean): Promise<unknown>;
};

/** The same default owner, descriptor and counterfactual identity in every host. */
export async function deriveDefaultSmartAccount({
  accountIndex,
  chainId,
  managementAddress,
  provider,
  assertInfrastructureSupported,
  assertCurrent,
}: {
  accountIndex: number;
  assertCurrent(): void;
  assertInfrastructureSupported(): Promise<unknown>;
  chainId: number;
  managementAddress: string;
  provider: SmartAccountBootstrapProvider;
}): Promise<{ address: string; metadata: ISmartAccountMetadata }> {
  assertCurrent();
  if (
    !Number.isSafeInteger(accountIndex) ||
    accountIndex < 0 ||
    !Number.isSafeInteger(chainId) ||
    chainId < 1
  )
    throw new Error('Invalid smart account identity');
  const managementOwner = getAddress(managementAddress);
  const configuredNetwork = await provider.getNetwork();
  assertCurrent();
  if (configuredNetwork.chainId !== BigInt(chainId))
    throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
  await provider.verifyConfiguredChainId(true);
  assertCurrent();
  await assertInfrastructureSupported();
  assertCurrent();
  const factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
  const descriptor = getPaliSmartAccountDescriptor({
    accountIndex,
    accountVersion: PALI_SMART_ACCOUNT_VERSION,
    anchor: `pali:eip155:${chainId}:${managementOwner.toLowerCase()}:smart-account-v1`,
    chainId,
    factoryAddress,
  });
  const validator = getConfiguredAuthenticatorAddress(chainId, 'ecdsa');
  const data = encodeEcdsaValidatorInitData([managementOwner], 1);
  const auth = { data, module: 'ecdsa' as const, validator };
  const account = await toPaliSmartAccount({
    auth,
    chainId,
    deploySalt: descriptor.deploymentSalt,
    factoryAddress,
    factory: createOwnedPaliSmartAccountFactory(
      chainId,
      provider,
      assertCurrent
    ),
  });
  assertCurrent();
  return {
    address: account.address,
    metadata: {
      installedModules: [
        {
          address: getAddress(validator),
          config: { owners: [managementOwner], threshold: 1 },
          data,
          id: 'ecdsa',
          type: 'validator',
        },
      ],
      auth,
      availableModules: getAvailablePaliModules(chainId),
      chainId,
      contractVersion: PALI_SMART_ACCOUNT_VERSION,
      deploymentAuth: { data, validator },
      deploymentSalt: descriptor.deploymentSalt,
      descriptor,
      factoryAddress,
      isDeployed: false,
    },
  };
}
