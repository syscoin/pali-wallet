import { defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';

export type PasskeyRecoveryIdentity = {
  credentialIdHash: string;
  originHash: string;
  originLength: number;
  passkeyX: string;
  passkeyY: string;
  rpIdHash: string;
};

export const getPasskeyIdentityHash = (
  identity: PasskeyRecoveryIdentity
): string =>
  keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint256'],
      [
        identity.passkeyX,
        identity.passkeyY,
        identity.credentialIdHash,
        identity.rpIdHash,
        identity.originHash,
        identity.originLength,
      ]
    )
  );

export const toPasskeyRecoveryIdentityFromPublicKey = (publicKey: {
  credentialIdHash: string;
  originHash: string;
  originLength: number;
  rpIdHash: string;
  x: string;
  y: string;
}): PasskeyRecoveryIdentity => ({
  credentialIdHash: publicKey.credentialIdHash,
  originHash: publicKey.originHash,
  originLength: publicKey.originLength,
  passkeyX: publicKey.x,
  passkeyY: publicKey.y,
  rpIdHash: publicKey.rpIdHash,
});
