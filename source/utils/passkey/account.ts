import { defaultAbiCoder } from '../ethersV6Compat.ts';
import { getPaliP256WebAuthnValidatorAddress } from '../smartAccount/contracts.ts';

import type { SmartAccountP256WebAuthnConfig } from '../../types/network.ts';
import type { SmartAccountAuthConfig } from '../smartAccount/account.ts';

export type SmartAccountP256WebAuthnAuthenticatorConfig = {
  backupStatus?: SmartAccountP256WebAuthnConfig['backupStatus'];
  credentialId: string;
  credentialIdHash: string;
  passkeyName: string;
  publicKey: SmartAccountP256WebAuthnConfig['publicKey'];
};

export type PaliP256WebAuthnAuthenticatorConfig =
  SmartAccountP256WebAuthnAuthenticatorConfig;

export const encodeP256WebAuthnAuthData = (publicKey: {
  originHash: string;
  originLength: number;
  rpIdHash: string;
  x: string;
  y: string;
}) =>
  defaultAbiCoder.encode(
    ['tuple(bytes32,bytes32,bytes32,bytes32,uint256)'],
    [
      [
        publicKey.x,
        publicKey.y,
        publicKey.rpIdHash,
        publicKey.originHash,
        publicKey.originLength,
      ],
    ]
  );

export const toP256PasskeyAuthConfig = (metadata: {
  chainId: number;
  publicKey: {
    originHash: string;
    originLength: number;
    rpIdHash: string;
    x: string;
    y: string;
  };
}): SmartAccountAuthConfig => ({
  data: encodeP256WebAuthnAuthData({
    ...metadata.publicKey,
  }),
  module: 'p256-webauthn',
  validator: getPaliP256WebAuthnValidatorAddress(metadata.chainId),
});
