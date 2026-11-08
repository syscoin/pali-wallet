import { encodeEcdsaValidatorInitData } from './account';
import {
  getSmartAccountLocalEcdsaOwners,
  signSmartAccountEcdsaOperation,
} from './signOperation';
import type {
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../types/network';

const addresses = ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20)];
const owner = (address: string) => ({
  id: addresses.indexOf(address),
  type: 'HDAccount' as KeyringAccountType,
});
const metadata = {
  auth: { module: 'ecdsa', data: encodeEcdsaValidatorInitData(addresses, 2) },
} as ISmartAccountMetadata;

it('uses the same threshold and ordered local owners for capability and signing', async () => {
  const selected = getSmartAccountLocalEcdsaOwners(metadata, owner);
  expect(selected.threshold).toBe(2);
  expect(selected.owners.map((value) => value.address)).toEqual(addresses);
  const signed: string[] = [];
  await signSmartAccountEcdsaOperation({
    metadata,
    actionHash: '0x' + '33'.repeat(32),
    findOwner: owner,
    assertCurrent: () => undefined,
    async signOwner(address) {
      signed.push(address);
      return '0x1234';
    },
  });
  expect(signed).toEqual(selected.owners.map((value) => value.address));
});

it('does not advertise local signing without every required owner', () => {
  expect(() =>
    getSmartAccountLocalEcdsaOwners(metadata, (address) =>
      address === addresses[0] ? owner(address) : null
    )
  ).toThrow();
});

it('keeps interactive authenticators outside local ECDSA capability', () => {
  expect(() =>
    getSmartAccountLocalEcdsaOwners(
      {
        ...metadata,
        auth: { ...metadata.auth, module: 'p256-webauthn' },
      } as ISmartAccountMetadata,
      owner
    )
  ).toThrow();
});
