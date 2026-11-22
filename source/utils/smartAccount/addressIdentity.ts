import { getAddress } from '../ethersV6Compat.ts';

import {
  encodeEcdsaValidatorInitData,
  getPaliSmartAccountDescriptor,
} from './account.ts';
import { PALI_SMART_ACCOUNT_VERSION } from './contracts.ts';
import { derivePaliSmartAccountDeployment } from './counterfactual.ts';
import {
  LEGACY_ECDSA_VALIDATOR,
  LEGACY_FACTORY_ADDRESS,
} from './legacyDeployment.ts';
import type {
  KeyringAccountType,
  IKeyringAccountState,
} from '../../types/network.ts';

type SmartAccountAddressRecord = Pick<
  IKeyringAccountState,
  'address' | 'smartAccount' | 'xpub'
>;

export function requireSmartAccountAddressIdentity(
  account: SmartAccountAddressRecord,
  chainId: number
) {
  const metadata = account.smartAccount;
  const descriptor = metadata?.descriptor;
  const fail = () => {
    throw new Error('Smart account address could not be verified');
  };
  if (
    !metadata ||
    !descriptor ||
    metadata.chainId !== chainId ||
    descriptor.chainId !== chainId ||
    metadata.contractVersion !== PALI_SMART_ACCOUNT_VERSION ||
    descriptor.accountVersion !== metadata.contractVersion ||
    !Number.isSafeInteger(descriptor.accountIndex) ||
    descriptor.accountIndex < 0
  )
    return fail();

  const anchor = /^pali:eip155:(\d+):(0x[0-9a-f]{40}):smart-account-v1$/.exec(
    descriptor.anchor
  );
  if (!anchor || anchor[1] !== String(chainId)) return fail();
  const factory = getAddress(descriptor.factoryAddress);
  if (
    metadata.factoryAddress &&
    getAddress(metadata.factoryAddress) !== factory
  )
    return fail();

  const canonical = getPaliSmartAccountDescriptor({
    accountIndex: descriptor.accountIndex,
    accountVersion: descriptor.accountVersion,
    anchor: descriptor.anchor,
    chainId,
    factoryAddress: factory,
  });
  if (
    canonical.anchorHash !== descriptor.anchorHash ||
    canonical.deploymentSalt !== descriptor.deploymentSalt ||
    canonical.deploymentSalt !== metadata.deploymentSalt
  )
    return fail();

  // Earlier ordinary records used the management owner at the descriptor
  // anchor and the canonical threshold-one ECDSA validator. Active auth can
  // be overwritten by hydration or rotated on-chain and never proves origin.
  if (
    !metadata.deploymentAuth &&
    factory !== getAddress(LEGACY_FACTORY_ADDRESS)
  )
    return fail();
  const auth = metadata.deploymentAuth ?? {
    data: encodeEcdsaValidatorInitData([anchor[2]!], 1),
    validator: LEGACY_ECDSA_VALIDATOR,
  };
  const deployment = derivePaliSmartAccountDeployment({
    ...auth,
    deploySalt: canonical.deploymentSalt,
    factoryAddress: factory,
  });
  if (
    getAddress(account.address) !== deployment.address ||
    getAddress(account.xpub) !== deployment.address
  )
    return fail();
  return deployment;
}

export function hasVerifiedSmartAccountAddress(
  account: SmartAccountAddressRecord | null | undefined,
  chainId: number
): boolean {
  if (!account) return false;
  try {
    requireSmartAccountAddressIdentity(account, chainId);
    return true;
  } catch {
    return false;
  }
}

export function canPublishAccountAddress(
  account: SmartAccountAddressRecord | null | undefined,
  type: KeyringAccountType | string | undefined,
  chainId: number
): boolean {
  return (
    type !== 'SmartAccount' || hasVerifiedSmartAccountAddress(account, chainId)
  );
}
