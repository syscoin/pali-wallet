import { getAddress } from '@ethersproject/address';

import type {
  ISmartAccountMetadata,
  SmartAccountP256WebAuthnConfig,
} from 'types/network';
import { toP256PasskeyAuthConfig } from 'utils/passkey/account';

import type { PaliAuthConfig } from './account';

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
