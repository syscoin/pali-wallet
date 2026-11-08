import { getAddress } from 'ethers/address';

import {
  encodeEcdsaValidatorInitData,
  encodeERC7579Executions,
  encodeInstallValidatorModuleCall,
} from './account';
import { getPaliModuleAddress } from './contracts';
import { captureGuardianRecoveryIntent } from './guardianRecoveryIntent';
import {
  buildSmartAccountGuardianRecoveryOperation,
  getSmartAccountGuardianRecoveryHash,
} from './recovery';

const account = '0x' + '11'.repeat(20);
const target = {
  auth: {
    module: 'ecdsa' as const,
    validator: getPaliModuleAddress(1, 'ecdsa'),
    data: encodeEcdsaValidatorInitData(['0x' + '22'.repeat(20)], 1),
  },
};
const build = (rotate = false, revoke = false) =>
  buildSmartAccountGuardianRecoveryOperation({
    account,
    chainId: 1,
    target,
    policyEpoch: '7',
    recoveryModule: getPaliModuleAddress(1, 'guardian-recovery'),
    salt: '0x' + '33'.repeat(32),
    replaceExistingValidator: rotate,
    ...(revoke ? { revokeValidator: '0x' + '44'.repeat(20) } : {}),
  });

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'accepts the existing canonical builder output (%s/%s)',
  (rotate, revoke) => {
    const operation = build(rotate, revoke);
    expect(
      captureGuardianRecoveryIntent({ operation, target }).operation
    ).toEqual({
      ...operation,
      recoveryModule: getAddress(operation.recoveryModule),
    });
  }
);

it('rejects a valid-hash operation for a different replacement configuration', () => {
  expect(() =>
    captureGuardianRecoveryIntent({
      operation: build(),
      target: { auth: { ...target.auth, data: '0x' } },
    })
  ).toThrow('replacement');
});

it.each(['value', 'recipient', 'extra'] as const)(
  'rejects a signed-intent hash over an unrelated %s execution',
  (field) => {
    const calls = [
      {
        target: account,
        value: field === 'value' ? '1' : '0',
        data: encodeInstallValidatorModuleCall(
          target.auth.validator,
          target.auth.data
        ),
      },
    ];
    if (field === 'recipient') calls[0].target = '0x' + '55'.repeat(20);
    if (field === 'extra')
      calls.push({ target: account, value: '0', data: '0x12345678' });
    const operation = { ...build(), ...encodeERC7579Executions(calls) };
    operation.hash = getSmartAccountGuardianRecoveryHash(operation);
    expect(() =>
      captureGuardianRecoveryIntent({ operation, target })
    ).toThrow();
  }
);

it('rejects altered digests and noncanonical execution encodings', () => {
  expect(() =>
    captureGuardianRecoveryIntent({
      operation: { ...build(), hash: '0x' + '00'.repeat(32) },
      target,
    })
  ).toThrow('hash');
  const operation = {
    ...build(),
    executionCalldata: build().executionCalldata + '00',
  };
  operation.hash = getSmartAccountGuardianRecoveryHash(operation);
  expect(() => captureGuardianRecoveryIntent({ operation, target })).toThrow();
});
