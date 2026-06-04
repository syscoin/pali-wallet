import { getAddress } from '@ethersproject/address';
import { AddressZero } from '@ethersproject/constants';

import {
  IPasskeySmartAccountMetadata,
  PasskeySponsorMode,
} from 'types/network';

import {
  PasskeyContractSponsorMode,
  passkeySmartAccountInterface,
} from './contracts';

export const getPasskeyFactoryAccountParams = (metadata: {
  credentialIdHash: string;
  deploymentSalt: string;
  publicKey: {
    originHash: string;
    originLength: number;
    rpIdHash: string;
    x: string;
    y: string;
  };
}) => ({
  passkeyX: metadata.publicKey.x,
  passkeyY: metadata.publicKey.y,
  credentialIdHash: metadata.credentialIdHash,
  rpIdHash: metadata.publicKey.rpIdHash,
  originHash: metadata.publicKey.originHash,
  originLength: metadata.publicKey.originLength,
  salt: metadata.deploymentSalt,
});

export const getPasskeyMetadataFactoryAccountParams = (
  metadata: IPasskeySmartAccountMetadata
) =>
  getPasskeyFactoryAccountParams({
    credentialIdHash: metadata.credentialIdHash,
    deploymentSalt: metadata.deploymentSalt,
    publicKey: metadata.publicKey,
  });

export const getPasskeySponsorContractMode = (
  metadata: IPasskeySmartAccountMetadata
) => {
  switch (metadata.sponsor?.mode) {
    case PasskeySponsorMode.GasOnly:
      return PasskeyContractSponsorMode.GasOnly;
    case PasskeySponsorMode.Required:
      return PasskeyContractSponsorMode.Required;
    case PasskeySponsorMode.Disabled:
    default:
      return PasskeyContractSponsorMode.None;
  }
};

export const getPasskeyPolicyExecution = (
  accountAddress: string,
  metadata: IPasskeySmartAccountMetadata,
  nonce: number,
  deadline: number
) => {
  if (
    !metadata.sponsor ||
    metadata.sponsor.mode === PasskeySponsorMode.Disabled
  ) {
    return null;
  }

  return {
    target: accountAddress,
    value: '0',
    data: passkeySmartAccountInterface.encodeFunctionData('setSponsor', [
      getPasskeySponsorContractMode(metadata),
      metadata.sponsor.signer || AddressZero,
      metadata.sponsor.url || '',
    ]),
    nonce: nonce.toString(),
    deadline,
  };
};

export const normalizePasskeySponsor = (
  sponsor?: {
    mode?: string;
    policyText?: string;
    signer?: string;
    url?: string;
  } | null
): IPasskeySmartAccountMetadata['sponsor'] => {
  const requestedMode = sponsor?.mode || PasskeySponsorMode.Disabled;
  if (
    requestedMode !== PasskeySponsorMode.Disabled &&
    requestedMode !== PasskeySponsorMode.GasOnly &&
    requestedMode !== PasskeySponsorMode.Required
  ) {
    throw new Error(`Unsupported passkey sponsor mode: ${requestedMode}`);
  }
  const mode = requestedMode as PasskeySponsorMode;

  let signer: string | undefined;
  if (sponsor?.signer) {
    signer = getAddress(sponsor.signer);
  }

  if (mode === PasskeySponsorMode.Required && !signer) {
    throw new Error(
      'Passkey sponsor mode "required" needs a valid sponsor signer'
    );
  }

  const url = typeof sponsor?.url === 'string' ? sponsor.url.trim() : '';
  return {
    mode,
    ...(typeof sponsor?.policyText === 'string' && sponsor.policyText.trim()
      ? { policyText: sponsor.policyText.trim() }
      : {}),
    ...(signer ? { signer } : {}),
    ...(url ? { url } : {}),
  };
};
