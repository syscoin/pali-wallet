import { defaultAbiCoder, id, keccak256 } from 'utils/ethersV6Compat';
import { GuardianRecoveryPolicyChangedError } from 'utils/smartAccountErrors';

import {
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  encodeEcdsaValidatorInitData,
} from './account';
import {
  ERC7579_MODULE_TYPE_VALIDATOR,
  paliSmartAccountInterface,
} from './contracts';
import {
  buildSmartAccountGuardianRecoveryOperation,
  clearStaleGuardianRecoveryOperation,
  getSmartAccountGuardianRecoveryHash,
} from './recovery';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = 57057;
const RECOVERY_MODULE = '0x2222222222222222222222222222222222222222';
const VALIDATOR = '0x3333333333333333333333333333333333333333';
const OWNER = '0x4444444444444444444444444444444444444444';
const OLD_VALIDATOR = '0x5555555555555555555555555555555555555555';
const SALT =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

describe('smart account guardian recovery operation encoding', () => {
  const target = {
    auth: {
      data: encodeEcdsaValidatorInitData([OWNER], 1),
      module: 'ecdsa' as const,
      validator: VALIDATOR,
    },
  };

  it('installs the recovery target when its validator is not installed yet', () => {
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: CHAIN_ID,
      recoveryModule: RECOVERY_MODULE,
      policyEpoch: '1',
      salt: SALT,
      target,
    });

    expect(operation.mode).toBe(ERC7579_MODE_SINGLE_DEFAULT);
    const installData = `0x${operation.executionCalldata.slice(106)}`;
    const parsed = paliSmartAccountInterface.parseTransaction({
      data: installData,
    });

    expect(parsed.name).toBe('installModule');
    expect(parsed.args.moduleTypeId.toString()).toBe(
      String(ERC7579_MODULE_TYPE_VALIDATOR)
    );
    expect(parsed.args.module).toBe(VALIDATOR);
  });

  it('rotates the recovery target when its validator is already installed', () => {
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: CHAIN_ID,
      recoveryModule: RECOVERY_MODULE,
      policyEpoch: '1',
      replaceExistingValidator: true,
      revokeValidator: VALIDATOR,
      salt: SALT,
      target,
    });

    expect(operation.mode).toBe(ERC7579_MODE_SINGLE_DEFAULT);
    const rotateData = `0x${operation.executionCalldata.slice(106)}`;
    const parsed = paliSmartAccountInterface.parseTransaction({
      data: rotateData,
    });

    expect(parsed.name).toBe('rotateValidator');
    expect(parsed.args.module).toBe(VALIDATOR);
    expect(parsed.args.initData).toBe(target.auth.data);
    expect(parsed.args.deInitData).toBe('0x');
  });

  it('installs the recovery target and revokes a different active validator', () => {
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: CHAIN_ID,
      recoveryModule: RECOVERY_MODULE,
      policyEpoch: '1',
      revokeValidator: OLD_VALIDATOR,
      salt: SALT,
      target,
    });

    expect(operation.mode).toBe(ERC7579_MODE_BATCH_DEFAULT);
    const [executions] = defaultAbiCoder.decode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      operation.executionCalldata
    ) as unknown as [any[]];
    const parsed = executions.map((execution) =>
      paliSmartAccountInterface.parseTransaction({
        data: execution.callData,
      })
    );

    expect(parsed.map((call) => call.name)).toEqual([
      'installModule',
      'uninstallModule',
    ]);
    expect(parsed[0].args.module).toBe(VALIDATOR);
    expect(parsed[1].args.module).toBe(OLD_VALIDATOR);
  });

  it('rotates an installed target before revoking a different active validator', () => {
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: CHAIN_ID,
      recoveryModule: RECOVERY_MODULE,
      policyEpoch: '1',
      replaceExistingValidator: true,
      revokeValidator: OLD_VALIDATOR,
      salt: SALT,
      target,
    });

    expect(operation.mode).toBe(ERC7579_MODE_BATCH_DEFAULT);
    const [executions] = defaultAbiCoder.decode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      operation.executionCalldata
    ) as unknown as [any[]];
    const parsed = executions.map((execution) =>
      paliSmartAccountInterface.parseTransaction({
        data: execution.callData,
      })
    );

    expect(parsed.map((call) => call.name)).toEqual([
      'rotateValidator',
      'uninstallModule',
    ]);
    expect(parsed[0].args.module).toBe(VALIDATOR);
    expect(parsed[0].args.initData).toBe(target.auth.data);
    expect(parsed[1].args.module).toBe(OLD_VALIDATOR);
  });
});

describe('guardian recovery consent domain', () => {
  const intent = {
    account: ACCOUNT,
    chainId: CHAIN_ID,
    policyEpoch: '7',
    executionCalldata: '0x1234',
    mode: ERC7579_MODE_SINGLE_DEFAULT,
    recoveryModule: RECOVERY_MODULE,
    salt: SALT,
  };

  it('matches the contract epoch hash with the epoch immediately after the module', () => {
    const expected = keccak256(
      defaultAbiCoder.encode(
        [
          'bytes32',
          'uint256',
          'address',
          'address',
          'uint256',
          'bytes32',
          'bytes32',
          'bytes32',
        ],
        [
          id(
            'PaliGuardianRecoverySchedule(uint256 chainId,address account,address module,uint256 policyEpoch,bytes32 salt,bytes32 mode,bytes32 executionCalldataHash)'
          ),
          CHAIN_ID,
          ACCOUNT,
          RECOVERY_MODULE,
          '7',
          SALT,
          intent.mode,
          keccak256(intent.executionCalldata),
        ]
      )
    );
    expect(getSmartAccountGuardianRecoveryHash(intent)).toBe(expected);
    expect(
      getSmartAccountGuardianRecoveryHash({ ...intent, policyEpoch: '8' })
    ).not.toBe(expected);
    expect(
      getSmartAccountGuardianRecoveryHash(JSON.parse(JSON.stringify(intent)))
    ).toBe(expected);
  });

  it.each([
    undefined,
    '0',
    '-1',
    '01',
    '1.5',
    '0x1',
    (BigInt(1) << BigInt(256)).toString(),
  ])('rejects invalid epoch %s', (policyEpoch) => {
    expect(() =>
      getSmartAccountGuardianRecoveryHash({ ...intent, policyEpoch })
    ).toThrow();
  });
});

describe('invalidated pending recovery credentials', () => {
  const credential = {
    credentialId: 'existing-passkey',
    authenticator: { kind: 'p256-webauthn', publicKey: 'existing-key' },
    recoveryOperation: { policyEpoch: '7', executionCalldata: '0x1234' },
  };
  const policyChanged = new GuardianRecoveryPolicyChangedError();

  it.each([
    policyChanged,
    { code: policyChanged.code },
    { message: policyChanged.message },
    policyChanged.message,
  ])(
    'drops only the pending operation on a confirmed policy change (%p)',
    (error) => {
      const next = clearStaleGuardianRecoveryOperation(credential, error);
      expect(next.recoveryOperation).toBeUndefined();
      expect(next.credentialId).toBe(credential.credentialId);
      expect(next.authenticator).toBe(credential.authenticator);
      expect(credential.recoveryOperation).toBeDefined();
    }
  );

  it.each([
    new Error('RPC timeout'),
    new Error('Guardian recovery digest does not match the installed policy'),
    new Error('RPC failure: PALI_GUARDIAN_RECOVERY_POLICY_CHANGED'),
    undefined,
  ])('retains pending recovery on uncertain errors (%p)', (error) => {
    expect(clearStaleGuardianRecoveryOperation(credential, error)).toBe(
      credential
    );
  });
});
