import { defaultAbiCoder } from '../ethersV6Compat';

import {
  encodeGuardianRecoveryInitData,
  getConfiguredAuthenticatorAddress,
} from './account';
import {
  ERC7579_MODULE_TYPE_EXECUTOR,
  paliSmartAccountInterface,
} from './contracts';
import {
  buildGuardianPolicyExecutions,
  projectGuardianPolicyModule,
} from './guardianPolicy';

const accountAddress = '0x1111111111111111111111111111111111111111';
const guardian = '0x2222222222222222222222222222222222222222';
const previousModuleAddress = '0x3333333333333333333333333333333333333333';

function previousInstallBytes(chainId: number, delaySeconds: number) {
  return paliSmartAccountInterface.encodeFunctionData('installModule', [
    ERC7579_MODULE_TYPE_EXECUTOR,
    getConfiguredAuthenticatorAddress(chainId, 'guardian-recovery'),
    encodeGuardianRecoveryInitData({
      delaySeconds,
      expirationSeconds: delaySeconds * 2,
      guardians: [guardian],
      threshold: 1,
    }),
  ]);
}

it.each([
  [57057, 600],
  [57057, 259200],
  [1, 259200],
  [1, 604800],
])(
  'preserves single-guardian installation bytes on chain %s with delay %s',
  (chainId, delaySeconds) => {
    const [execution] = buildGuardianPolicyExecutions({
      kind: 'install',
      accountAddress,
      chainId,
      delaySeconds,
      guardian,
    });
    expect(execution).toEqual({
      target: accountAddress,
      value: '0x0',
      data: previousInstallBytes(chainId, delaySeconds),
    });
    const [, , initData] = paliSmartAccountInterface.decodeFunctionData(
      'installModule',
      execution.data
    );
    const [delay, expiration, guardians, threshold] = defaultAbiCoder.decode(
      ['uint32', 'uint32', 'address[]', 'uint64'],
      initData
    );
    expect(Number(delay)).toBe(delaySeconds);
    expect(Number(expiration)).toBe(delaySeconds * 2);
    expect(guardians).toEqual([guardian]);
    expect(Number(threshold)).toBe(1);
  }
);

it('preserves uninstall-before-install ordering when updating the current policy', () => {
  expect(
    buildGuardianPolicyExecutions({
      kind: 'update',
      accountAddress,
      chainId: 57057,
      delaySeconds: 600,
      guardian,
      previousModuleAddress,
    })
  ).toEqual([
    {
      target: accountAddress,
      value: '0x0',
      data: paliSmartAccountInterface.encodeFunctionData('uninstallModule', [
        ERC7579_MODULE_TYPE_EXECUTOR,
        previousModuleAddress,
        '0x',
      ]),
    },
    {
      target: accountAddress,
      value: '0x0',
      data: previousInstallBytes(57057, 600),
    },
  ]);
});

it('removes the exact observed executor without applying current installation delay choices', () => {
  expect(
    buildGuardianPolicyExecutions({
      kind: 'remove',
      accountAddress,
      moduleAddress: previousModuleAddress,
    })
  ).toEqual([
    {
      target: accountAddress,
      value: '0x0',
      data: paliSmartAccountInterface.encodeFunctionData('uninstallModule', [
        ERC7579_MODULE_TYPE_EXECUTOR,
        previousModuleAddress,
        '0x',
      ]),
    },
  ]);
});

it.each([
  [1, 600],
  [123456, 600],
  [57057, 60],
  [57057, 0],
  [57057, 259200.5],
])(
  'retains the editor delay restriction on chain %s with delay %s',
  (chainId, delaySeconds) => {
    expect(() =>
      buildGuardianPolicyExecutions({
        kind: 'install',
        accountAddress,
        chainId,
        delaySeconds,
        guardian,
      })
    ).toThrow('delay');
  }
);

it.each(['', 'guardian.eth', '0x1234'])(
  'refuses invalid guardian %s without constructing an installation',
  (invalid) =>
    expect(() =>
      buildGuardianPolicyExecutions({
        kind: 'install',
        accountAddress,
        chainId: 57057,
        delaySeconds: 600,
        guardian: invalid,
      })
    ).toThrow()
);

it('requires an explicit command and an exact observed module for update/removal', () => {
  expect(() =>
    buildGuardianPolicyExecutions({
      accountAddress,
      chainId: 57057,
      delaySeconds: 600,
      guardian,
    } as any)
  ).toThrow('command');
  expect(() =>
    buildGuardianPolicyExecutions({
      kind: 'update',
      accountAddress,
      chainId: 57057,
      delaySeconds: 600,
      guardian,
    } as any)
  ).toThrow();
  expect(() =>
    buildGuardianPolicyExecutions({ kind: 'remove', accountAddress } as any)
  ).toThrow();
});

it('preserves multi-guardian read metadata independently of the one-guardian editor', () => {
  const policy = {
    account: accountAddress,
    chainId: 57057,
    policyEpoch: '7',
    moduleAddress: previousModuleAddress,
    delaySeconds: 90,
    expirationSeconds: 3600,
    guardians: [guardian, accountAddress],
    threshold: 2,
  };
  const before = JSON.stringify(policy);
  const module = projectGuardianPolicyModule(policy);
  expect(module).toEqual({
    address: previousModuleAddress,
    config: {
      delaySeconds: 90,
      expirationSeconds: 3600,
      guardians: [guardian, accountAddress],
      threshold: 2,
    },
    data: encodeGuardianRecoveryInitData(policy),
    id: 'guardian-recovery',
    type: 'executor',
  });
  expect(JSON.stringify(policy)).toBe(before);
  policy.guardians.pop();
  expect(module.config.guardians).toEqual([guardian, accountAddress]);
  expect(policy.policyEpoch).toBe('7');
});
