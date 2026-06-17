import { getAddress } from '@ethersproject/address';

import type {
  ISmartAccountMetadata,
  SmartAccountP256WebAuthnConfig,
  SmartAccountSLHDSAConfig,
} from 'types/network';
import { toP256PasskeyAuthConfig } from 'utils/passkey/account';
import { SLH_DSA_SIGNATURE_LIMIT, getSLHDSAKeyId } from 'utils/slhDsa';

import {
  encodeSLHDSAValidatorInitData,
  getConfiguredAuthenticatorAddress,
  type PaliAuthConfig,
} from './account';

export type SmartAccountAuthenticatorBuildResult = {
  auth: PaliAuthConfig;
  metadata: Partial<ISmartAccountMetadata>;
};

export const buildP256WebAuthnAuthenticator = ({
  chainId,
  config,
}: {
  chainId: number;
  config: SmartAccountP256WebAuthnConfig;
}): SmartAccountAuthenticatorBuildResult => {
  const auth = toP256PasskeyAuthConfig({
    chainId,
    credentialIdHash: config.credentialIdHash,
    publicKey: config.publicKey,
  });

  return {
    auth,
    metadata: {
      installedModules: [
        {
          address: getAddress(auth.validator),
          config,
          data: auth.data,
          id: 'p256-webauthn',
          type: 'validator',
        },
      ],
    },
  };
};

export const buildHydratedP256WebAuthnAuthenticator = ({
  chainId,
  credentialIdHash,
  publicKey,
}: {
  chainId: number;
  credentialIdHash: string;
  publicKey: SmartAccountP256WebAuthnConfig['publicKey'];
}): SmartAccountAuthenticatorBuildResult =>
  buildP256WebAuthnAuthenticator({
    chainId,
    config: {
      credentialIdHash,
      passkeyName: 'P-256 / WebAuthn',
      publicKey,
    },
  });

export const buildSLHDSAAuthenticator = ({
  chainId,
  config,
}: {
  chainId: number;
  config: SmartAccountSLHDSAConfig;
}): SmartAccountAuthenticatorBuildResult => {
  const validator = getConfiguredAuthenticatorAddress(chainId, 'slh-dsa');
  const data = encodeSLHDSAValidatorInitData(config);

  return {
    auth: {
      data,
      module: 'slh-dsa',
      validator,
    },
    metadata: {
      installedModules: [
        {
          address: getAddress(validator),
          config,
          data,
          id: 'slh-dsa',
          type: 'validator',
        },
      ],
    },
  };
};

export const buildHydratedSLHDSAAuthenticator = ({
  chainId,
  pkRoot,
  pkSeed,
}: {
  chainId: number;
  pkRoot: string;
  pkSeed: string;
}): SmartAccountAuthenticatorBuildResult =>
  buildSLHDSAAuthenticator({
    chainId,
    config: {
      keyId: getSLHDSAKeyId({ pkRoot, pkSeed }),
      parameterSet: 'SLH-DSA-SHA2-128-24',
      pkRoot,
      pkSeed,
      signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
    },
  });
