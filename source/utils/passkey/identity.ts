import { defaultAbiCoder } from '@ethersproject/abi';
import { AddressZero } from '@ethersproject/constants';
import { keccak256 } from '@ethersproject/keccak256';

import { getSmartAccountAuthHash } from 'utils/smartAccount';
import type { PaliRecoveryTarget } from 'utils/smartAccount';

export { encodeRecoveryTargetExecution } from 'utils/smartAccount';
export type { PaliRecoveryTarget } from 'utils/smartAccount';

export const getPaliRecoveryTargetHash = (
  recovery: PaliRecoveryTarget
): string =>
  keccak256(
    defaultAbiCoder.encode(
      ['bytes32'],
      [getSmartAccountAuthHash(recovery.auth)]
    )
  );

export const toP256WebAuthnRecoveryTarget = (params: {
  originHash: string;
  originLength: number;
  passkeyX?: string;
  passkeyY?: string;
  rpIdHash: string;
  validator?: string;
  x?: string;
  y?: string;
}): PaliRecoveryTarget => ({
  auth: {
    data: defaultAbiCoder.encode(
      ['tuple(bytes32,bytes32,bytes32,bytes32,uint256)'],
      [
        [
          params.x || params.passkeyX,
          params.y || params.passkeyY,
          params.rpIdHash,
          params.originHash,
          params.originLength,
        ],
      ]
    ),
    module: 'p256-webauthn',
    validator: params.validator || AddressZero,
  },
});
