jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/keccak256');

import { defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';

import { getPasskeyAccountLookupKey } from './account';

const baseLookupMetadata = {
  credentialIdHash:
    '0x0101010101010101010101010101010101010101010101010101010101010101',
  publicKey: {
    originHash:
      '0x0505050505050505050505050505050505050505050505050505050505050505',
    originLength: 23,
    rpIdHash:
      '0x0404040404040404040404040404040404040404040404040404040404040404',
    x: '0x0202020202020202020202020202020202020202020202020202020202020202',
    y: '0x0303030303030303030303030303030303030303030303030303030303030303',
  },
};

describe('passkey account lookup utilities', () => {
  it('matches the factory lookup-key ABI encoding', () => {
    expect(getPasskeyAccountLookupKey(baseLookupMetadata)).toBe(
      keccak256(
        defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint256'],
          [
            baseLookupMetadata.credentialIdHash,
            baseLookupMetadata.publicKey.x,
            baseLookupMetadata.publicKey.y,
            baseLookupMetadata.publicKey.rpIdHash,
            baseLookupMetadata.publicKey.originHash,
            baseLookupMetadata.publicKey.originLength,
          ]
        )
      )
    );
  });

  it('separates the same credential hash by passkey identity', () => {
    const userLookupKey = getPasskeyAccountLookupKey(baseLookupMetadata);
    const attackerLookupKey = getPasskeyAccountLookupKey({
      ...baseLookupMetadata,
      publicKey: {
        ...baseLookupMetadata.publicKey,
        x: '0x9999999999999999999999999999999999999999999999999999999999999999',
      },
    });

    expect(attackerLookupKey).not.toBe(userLookupKey);
  });
});
