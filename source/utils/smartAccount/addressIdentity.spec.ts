import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { KeyringAccountType } from 'types/network';

import {
  canPublishAccountAddress,
  hasVerifiedSmartAccountAddress,
} from './addressIdentity';
import { derivePaliSmartAccountDeployment } from './counterfactual';
import {
  LEGACY_ECDSA_VALIDATOR,
  LEGACY_FACTORY_ADDRESS,
} from './legacyDeployment';

it('verifies the original address without requiring deployment or a currently configured signer', () => {
  const { account } = smartAccountAddressFixture();
  expect(hasVerifiedSmartAccountAddress(account, 1)).toBe(true);
  expect(
    hasVerifiedSmartAccountAddress(
      {
        ...account,
        smartAccount: {
          ...account.smartAccount,
          auth: undefined,
          isDeployed: true,
        },
      },
      1
    )
  ).toBe(true);
});

it.each([false, true])(
  'preserves older ECDSA bootstrap identities (deployed %s)',
  (isDeployed) => {
    const { account } = smartAccountAddressFixture(1, undefined, {
      factoryAddress: LEGACY_FACTORY_ADDRESS,
      validator: LEGACY_ECDSA_VALIDATOR,
    });
    expect(account.address).toBe('0x53624aA1F2221EC6573aAA1828d5c1F68E2c5A71');
    const rotated = smartAccountAddressFixture(
      1,
      '0x0000000000000000000000000000000000000002'
    );
    expect(
      hasVerifiedSmartAccountAddress(
        {
          ...account,
          smartAccount: {
            ...account.smartAccount,
            deploymentAuth: undefined,
            auth: rotated.account.smartAccount.auth,
            isDeployed,
          },
        },
        1
      )
    ).toBe(true);
  }
);

it('never lets mutable auth or a deployed claim establish a different saved address', () => {
  const { account } = smartAccountAddressFixture();
  const forged = smartAccountAddressFixture(
    1,
    '0x0000000000000000000000000000000000000002'
  );
  const { address } = derivePaliSmartAccountDeployment({
    ...forged.account.smartAccount.deploymentAuth,
    deploySalt: account.smartAccount.deploymentSalt,
    factoryAddress: account.smartAccount.factoryAddress,
  });
  const substituted = { ...account, address, xpub: address };
  for (const isDeployed of [false, true]) {
    expect(
      canPublishAccountAddress(
        {
          ...substituted,
          smartAccount: {
            ...account.smartAccount,
            deploymentAuth: undefined,
            auth: forged.account.smartAccount.auth,
            isDeployed,
          },
        },
        KeyringAccountType.SmartAccount,
        1
      )
    ).toBe(false);
  }
  expect(hasVerifiedSmartAccountAddress(account, 5700)).toBe(false);
  expect(
    hasVerifiedSmartAccountAddress(
      { ...account, xpub: forged.account.address },
      1
    )
  ).toBe(false);
});
