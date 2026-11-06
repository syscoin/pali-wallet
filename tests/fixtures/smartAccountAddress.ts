import type { ISmartAccountMetadata } from 'types/network';
import { hexConcat } from 'utils/ethersV6Compat';
import {
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
  getPaliSmartAccountDescriptor,
} from 'utils/smartAccount/account';
import {
  getPaliSmartAccountFactoryAddress,
  PALI_SMART_ACCOUNT_VERSION,
} from 'utils/smartAccount/contracts';
import { derivePaliSmartAccountDeployment } from 'utils/smartAccount/counterfactual';

export function smartAccountAddressFixture(
  chainId = 1,
  owner = '0x0000000000000000000000000000000000000001'
) {
  const factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
  const descriptor = getPaliSmartAccountDescriptor({
    accountIndex: 0,
    accountVersion: PALI_SMART_ACCOUNT_VERSION,
    anchor: `pali:eip155:${chainId}:${owner.toLowerCase()}:smart-account-v1`,
    chainId,
    factoryAddress,
  });
  const deploymentAuth = {
    data: encodeEcdsaValidatorInitData([owner], 1),
    validator: getConfiguredAuthenticatorAddress(chainId, 'ecdsa'),
  };
  const { address, factory, factoryData } = derivePaliSmartAccountDeployment({
    ...deploymentAuth,
    deploySalt: descriptor.deploymentSalt,
    factoryAddress,
  });
  const smartAccount: ISmartAccountMetadata = {
    auth: { ...deploymentAuth, module: 'ecdsa' },
    chainId,
    contractVersion: PALI_SMART_ACCOUNT_VERSION,
    deploymentAuth,
    deploymentSalt: descriptor.deploymentSalt,
    descriptor,
    factoryAddress,
    isDeployed: false,
  };
  return {
    account: { address, xpub: address, smartAccount },
    deploymentInitCode: hexConcat([factory, factoryData]),
  };
}
