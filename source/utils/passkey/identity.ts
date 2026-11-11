import { defaultAbiCoder } from '../ethersV6Compat.ts';
import { AddressZero } from '../ethersV6Compat.ts';
import { keccak256 } from '../ethersV6Compat.ts';
import { getSmartAccountAuthHash } from '../smartAccount/account.ts';

import type { PaliRecoveryTarget } from '../smartAccount/account.ts';

export { encodeRecoveryTargetExecution } from '../smartAccount/account.ts';
export type { PaliRecoveryTarget } from '../smartAccount/account.ts';

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
