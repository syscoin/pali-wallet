import { getAddress } from 'ethers/address';

import { GuardianRecoveryPolicyChangedError } from '../smartAccountErrors';

import {
  encodeEcdsaValidatorInitData,
  type PaliRecoveryTarget,
} from './account';
import {
  getPaliModuleAddress,
  paliGuardianRecoveryModuleInterface,
} from './contracts';
import {
  buildGuardianRecoveryFinalizeTransaction,
  buildGuardianRecoveryScheduleTransaction,
  buildGuardianRecoveryStart,
  captureGuardianRecoveryOperation,
  captureGuardianRecoveryTarget,
  validateGuardianRecoveryOperation,
} from './guardianRecoveryCommands';
import { buildSmartAccountGuardianRecoveryOperation } from './recovery';

const account = '0x' + '11'.repeat(20);
const guardian = '0x' + '22'.repeat(20);
const replacement = '0x' + '33'.repeat(20);
const moduleAddress = getAddress(getPaliModuleAddress(1, 'guardian-recovery'));
const oldValidator = '0x' + '44'.repeat(20);
const target = (): PaliRecoveryTarget => ({
  auth: {
    module: 'ecdsa',
    validator: getPaliModuleAddress(1, 'ecdsa'),
    data: encodeEcdsaValidatorInitData([replacement], 1),
  },
});
const request = () => ({
  account,
  chainId: 1,
  salt: '0x' + '55'.repeat(32),
  target: target(),
});
const defer = () => {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    release: () => resolve(),
  };
};
const buildPorts = () => ({
  assertCurrent: jest.fn(),
  readModuleAddress: jest.fn(async () => moduleAddress),
  readPolicyEpoch: jest.fn(async () => '7'),
  readCurrentValidator: jest.fn(async () => oldValidator),
  isValidatorInstalled: jest.fn(
    async (_account: string, validator: string) => validator === oldValidator
  ),
});

it.each([false, true])(
  'preserves the existing recovery execution bytes with installed target %s',
  async (installed) => {
    const input = request(),
      ports = buildPorts();
    ports.isValidatorInstalled.mockResolvedValue(true);
    ports.isValidatorInstalled.mockResolvedValueOnce(installed);
    const result = await buildGuardianRecoveryStart(input, ports);
    expect(result).toEqual(
      buildSmartAccountGuardianRecoveryOperation({
        ...input,
        policyEpoch: '7',
        recoveryModule: moduleAddress,
        replaceExistingValidator: installed,
        revokeValidator: oldValidator,
      })
    );
    expect(ports.assertCurrent).toHaveBeenCalledTimes(6);
  }
);

it.each(['zero', 'uninstalled', 'failed'])(
  'refuses an invalid active validator (%s)',
  async (kind) => {
    const ports = buildPorts();
    if (kind === 'zero')
      ports.readCurrentValidator.mockResolvedValue('0x' + '00'.repeat(20));
    if (kind === 'uninstalled')
      ports.isValidatorInstalled.mockResolvedValue(false);
    if (kind === 'failed')
      ports.readCurrentValidator.mockRejectedValue(
        new Error('RPC unavailable')
      );
    await expect(
      buildGuardianRecoveryStart(request(), ports)
    ).rejects.toThrow();
  }
);

it('snapshots the target and intent before a held policy read', async () => {
  const input = request(),
    original = request(),
    ports = buildPorts(),
    gate = defer();
  ports.readModuleAddress.mockImplementation(async () => {
    await gate.promise;
    return moduleAddress;
  });
  const pending = buildGuardianRecoveryStart(input, ports);
  input.target.auth.data = '0x';
  input.target.auth.validator = oldValidator;
  input.salt = '0x' + '99'.repeat(32);
  input.chainId = 2;
  gate.release();
  expect(await pending).toEqual(
    buildSmartAccountGuardianRecoveryOperation({
      ...original,
      policyEpoch: '7',
      recoveryModule: moduleAddress,
      replaceExistingValidator: false,
      revokeValidator: oldValidator,
    })
  );
});

it('stops after a read retires its owner and rejects asynchronous guards', async () => {
  const ports = buildPorts();
  let current = true;
  ports.assertCurrent.mockImplementation(() => {
    if (!current) throw new Error('retired');
  });
  ports.readPolicyEpoch.mockImplementation(async () => {
    current = false;
    return '7';
  });
  await expect(buildGuardianRecoveryStart(request(), ports)).rejects.toThrow(
    'retired'
  );
  await expect(
    buildGuardianRecoveryStart(request(), {
      ...buildPorts(),
      assertCurrent: (() => Promise.resolve()) as never,
    })
  ).rejects.toThrow();
});

const validOperation = () =>
  buildSmartAccountGuardianRecoveryOperation({
    ...request(),
    policyEpoch: '7',
    recoveryModule: moduleAddress,
  });
const validationPorts = () => ({
  assertCurrent: jest.fn(),
  readModuleAddress: jest.fn(async () => moduleAddress),
  readPolicyEpoch: jest.fn(async () => '7'),
  readScheduleHash: jest.fn(async () => validOperation().hash),
});

it('always validates the on-chain hash, including the finalize form without a supplied hash', async () => {
  const { hash, ...operation } = validOperation(),
    ports = validationPorts();
  await validateGuardianRecoveryOperation(
    { account, chainId: 1, operation },
    ports
  );
  expect(ports.readScheduleHash).toHaveBeenCalledWith(operation);
  ports.readScheduleHash.mockResolvedValue('0x' + '00'.repeat(32));
  await expect(
    validateGuardianRecoveryOperation({ account, chainId: 1, operation }, ports)
  ).rejects.toThrow('digest does not match');
  expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
});

it.each(['account', 'chain', 'module', 'hash'] as const)(
  'refuses an altered %s binding',
  async (field) => {
    const operation = validOperation(),
      ports = validationPorts();
    if (field === 'account') operation.account = guardian;
    if (field === 'chain') operation.chainId = 2;
    if (field === 'module') operation.recoveryModule = oldValidator;
    if (field === 'hash') operation.hash = '0x' + '00'.repeat(32);
    await expect(
      validateGuardianRecoveryOperation(
        { account, chainId: 1, operation },
        ports
      )
    ).rejects.toThrow();
    expect(ports.readScheduleHash).not.toHaveBeenCalled();
  }
);

it('retains policy-epoch error semantics and does not suppress failed reads', async () => {
  const ports = validationPorts();
  ports.readPolicyEpoch.mockResolvedValue('8');
  await expect(
    validateGuardianRecoveryOperation(
      { account, chainId: 1, operation: validOperation() },
      ports
    )
  ).rejects.toThrow(GuardianRecoveryPolicyChangedError);
  ports.readPolicyEpoch.mockRejectedValue(new Error('RPC unavailable'));
  await expect(
    validateGuardianRecoveryOperation(
      { account, chainId: 1, operation: validOperation() },
      ports
    )
  ).rejects.toThrow('RPC unavailable');
});

it('preserves exact schedule and finalize calldata and binds the approval guardian', () => {
  const operation = validOperation(),
    approval = { guardian, signature: '0x1234' };
  expect(
    buildGuardianRecoveryScheduleTransaction({
      account,
      guardian,
      operation,
      approval,
    })
  ).toEqual({
    to: moduleAddress,
    value: '0x0',
    data: paliGuardianRecoveryModuleInterface.encodeFunctionData(
      'scheduleRecovery',
      [
        account,
        operation.salt,
        operation.mode,
        operation.executionCalldata,
        [approval],
      ]
    ),
  });
  expect(
    buildGuardianRecoveryFinalizeTransaction({ account, operation })
  ).toEqual({
    to: moduleAddress,
    value: '0x0',
    data: paliGuardianRecoveryModuleInterface.encodeFunctionData(
      'executeRecovery',
      [account, operation.salt, operation.mode, operation.executionCalldata]
    ),
  });
  expect(() =>
    buildGuardianRecoveryScheduleTransaction({
      account,
      guardian: replacement,
      operation,
      approval,
    })
  ).toThrow('does not match');
});

it('keeps the validated intent stable while policy reads are pending', async () => {
  const operation = validOperation(),
    original = { ...operation },
    ports = validationPorts(),
    gate = defer();
  ports.readModuleAddress.mockImplementation(async () => {
    await gate.promise;
    return moduleAddress;
  });
  const checking = validateGuardianRecoveryOperation(
    { account, chainId: 1, operation },
    ports
  );
  operation.executionCalldata = '0x';
  operation.salt = '0x' + '99'.repeat(32);
  gate.release();
  await checking;
  expect(ports.readScheduleHash).toHaveBeenCalledWith(original);
});

it.each(['ecdsa', 'p256-webauthn', 'composite', 'slh-dsa'] as const)(
  'captures only the public %s target fields',
  (module) => {
    const source = {
      auth: { ...target().auth, module, privateKey: 'excluded' },
      secret: 'excluded',
    };
    expect(captureGuardianRecoveryTarget(source)).toEqual({
      auth: {
        module,
        validator: getAddress(target().auth.validator),
        data: target().auth.data,
      },
    });
    const original = validOperation();
    expect(
      captureGuardianRecoveryOperation({
        ...original,
        secret: 'excluded',
      } as typeof original)
    ).toEqual(original);
  }
);

it('refuses accessor-backed recovery fields without executing getters', () => {
  const getter = jest.fn(() => target().auth);
  const input = Object.defineProperty({}, 'auth', { get: getter });
  expect(() =>
    captureGuardianRecoveryTarget(input as PaliRecoveryTarget)
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const operation = validOperation();
  Object.defineProperty(operation, 'salt', { get: getter });
  expect(() => captureGuardianRecoveryOperation(operation)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
