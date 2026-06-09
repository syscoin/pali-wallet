jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

import { defaultAbiCoder } from '@ethersproject/abi';

import {
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  encodeEcdsaValidatorInitData,
} from './account';
import {
  ERC7579_MODULE_TYPE_VALIDATOR,
  paliSmartAccountInterface,
} from './contracts';
import { buildSmartAccountGuardianRecoveryOperation } from './recovery';

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

  it('replaces the recovery target when its validator is already installed', () => {
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: CHAIN_ID,
      recoveryModule: RECOVERY_MODULE,
      replaceExistingValidator: true,
      revokeValidator: VALIDATOR,
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
      'uninstallModule',
      'installModule',
    ]);
    expect(parsed[0].args.module).toBe(VALIDATOR);
    expect(parsed[1].args.module).toBe(VALIDATOR);
  });

  it('installs the recovery target and revokes a different active validator', () => {
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: CHAIN_ID,
      recoveryModule: RECOVERY_MODULE,
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

  it('updates an installed target before revoking a different active validator', () => {
    const operation = buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: CHAIN_ID,
      recoveryModule: RECOVERY_MODULE,
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
      'uninstallModule',
      'installModule',
      'uninstallModule',
    ]);
    expect(parsed[0].args.module).toBe(VALIDATOR);
    expect(parsed[1].args.module).toBe(VALIDATOR);
    expect(parsed[2].args.module).toBe(OLD_VALIDATOR);
  });
});
