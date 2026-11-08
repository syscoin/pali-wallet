import { AddressZero, getAddress } from '../ethersV6Compat';

import {
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
} from './account';
import { paliSmartAccountInterface } from './contracts';
import {
  assertPaliWalletValidatorSwitchApplied,
  assertPaliWalletValidatorSwitchCurrent,
  buildPaliWalletValidatorSwitch,
} from './validatorSwitch';
import type { ISmartAccountMetadata } from '../../types/network';

const accountAddress = '0x' + '11'.repeat(20);
const ownerAddress = '0x' + '22'.repeat(20);
const priorOwner = '0x' + '33'.repeat(20);
const validator = getAddress(getConfiguredAuthenticatorAddress(1, 'ecdsa'));
function metadata(owner = priorOwner): ISmartAccountMetadata {
  const data = encodeEcdsaValidatorInitData([owner], 1);
  return {
    chainId: 1,
    contractVersion: '1',
    deploymentSalt: '0x' + '00'.repeat(32),
    isDeployed: true,
    auth: { module: 'ecdsa', validator, data },
    installedModules: [
      {
        type: 'validator',
        id: 'ecdsa',
        address: validator,
        data,
        config: { owners: [owner], threshold: 1 },
      },
    ],
  };
}
const build = (value = metadata()) =>
  buildPaliWalletValidatorSwitch({
    accountAddress,
    chainId: 1,
    metadata: value,
    ownerAddress,
  });

it('rotates the same ECDSA validator with the exact owner and threshold ABI', () => {
  const command = build();
  expect(command.executions).toHaveLength(1);
  const call = command.executions[0]!;
  expect(call.target).toBe(accountAddress);
  expect(call.value).toBe('0x0');
  const decoded = paliSmartAccountInterface.decodeFunctionData(
    'rotateValidator',
    call.data
  );
  expect(decoded[0]).toBe(validator);
  expect(decoded[1]).toBe('0x');
  expect(decoded[2]).toBe(encodeEcdsaValidatorInitData([ownerAddress], 1));
  expect(Object.isFrozen(command.executions)).toBe(true);
  expect(Object.isFrozen(call)).toBe(true);
});

it('returns an exact no-op for an already configured owner', () => {
  const command = build(metadata(ownerAddress));
  expect(command.executions).toEqual([]);
  assertPaliWalletValidatorSwitchApplied(command, metadata(ownerAddress));
});

it.each([false, true])(
  'activates the target before uninstalling the old validator (installed %s)',
  (installed) => {
    const value = metadata();
    const oldAddress = getAddress(
      getConfiguredAuthenticatorAddress(1, 'p256-webauthn')
    );
    value.auth = {
      module: 'p256-webauthn',
      validator: oldAddress,
      data: '0x1234',
    };
    const old = {
      type: 'validator' as const,
      id: 'p256-webauthn' as const,
      address: oldAddress,
      data: '0x1234',
      config: {
        publicKey: {
          x: '0x1',
          y: '0x2',
          originHash: '0x3',
          rpIdHash: '0x4',
          originLength: 1,
        },
      },
    };
    value.installedModules = [
      ...(installed ? value.installedModules! : []),
      old,
    ];
    const command = build(value);
    expect(command.executions).toHaveLength(2);
    const activation = paliSmartAccountInterface.parseTransaction({
      data: command.executions[0]!.data,
    });
    expect(activation?.name).toBe(
      installed ? 'rotateValidator' : 'installModule'
    );
    expect(
      paliSmartAccountInterface.decodeFunctionData(
        'uninstallModule',
        command.executions[1]!.data
      )[1]
    ).toBe(oldAddress);
  }
);

it('refuses changed source bytes and requires exact resulting owner data', () => {
  const command = build();
  assertPaliWalletValidatorSwitchCurrent(command, metadata());
  expect(() =>
    assertPaliWalletValidatorSwitchCurrent(command, metadata(ownerAddress))
  ).toThrow();
  expect(() =>
    assertPaliWalletValidatorSwitchApplied(command, metadata())
  ).toThrow();
  assertPaliWalletValidatorSwitchApplied(command, metadata(ownerAddress));
  expect(() => build({ ...metadata(), chainId: 2 })).toThrow();
  expect(() => build({ ...metadata(), isDeployed: false })).toThrow();
  expect(() =>
    buildPaliWalletValidatorSwitch({
      accountAddress,
      chainId: 1,
      metadata: metadata(),
      ownerAddress: AddressZero,
    })
  ).toThrow();
});
