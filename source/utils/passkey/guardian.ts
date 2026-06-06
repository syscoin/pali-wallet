import { defaultAbiCoder } from '@ethersproject/abi';
import { id as hashText } from '@ethersproject/hash';
import { keccak256 } from '@ethersproject/keccak256';

import { getPasskeyIdentityHash, PasskeyRecoveryIdentity } from './identity';

const PASSKEY_GUARDIAN_RECOVERY_TYPEHASH = hashText(
  'PALI_PASSKEY_GUARDIAN_RECOVERY_V1'
);

export type PasskeyGuardianSignature = {
  guardian: string;
  r: string;
  s: string;
  v: number;
};

export type PasskeyGuardianRecoveryIntent = {
  account: string;
  chainId: number;
  expiresAt: number;
  newIdentity: PasskeyRecoveryIdentity;
  recoveryNonce: string;
  recoveryValidator: string;
};

export const getPasskeyGuardianRecoveryHash = ({
  account,
  chainId,
  expiresAt,
  newIdentity,
  recoveryNonce,
  recoveryValidator,
}: PasskeyGuardianRecoveryIntent): string =>
  keccak256(
    defaultAbiCoder.encode(
      [
        'bytes32',
        'uint256',
        'address',
        'address',
        'bytes32',
        'uint256',
        'uint256',
      ],
      [
        PASSKEY_GUARDIAN_RECOVERY_TYPEHASH,
        chainId,
        recoveryValidator,
        account,
        getPasskeyIdentityHash(newIdentity),
        recoveryNonce,
        expiresAt,
      ]
    )
  );
