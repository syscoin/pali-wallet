import { getAddress } from '../ethersV6Compat';

import { encodeCompositeValidatorInitData } from './account';
import { paliSmartAccountInterface } from './contracts';
import {
  buildCompositeValidatorExecutions,
  buildCustomValidatorInstallExecutions,
  buildValidatorUninstallExecutions,
  canRemoveValidatorModule,
  SmartAccountModuleCommandError,
} from './moduleCommands';
import { isPaliValidatorAlgorithmSupported } from './validatorSignability';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network';

const address = (value: number) =>
  getAddress(`0x${value.toString(16).padStart(40, '0')}`);
const accountAddress = address(100);
const builtin = address(3);
const ecdsa = (id: number): SmartAccountValidatorModule => ({
  address: address(id),
  type: 'validator',
  id: 'ecdsa',
  data: '0x1234',
  config: { owners: [address(80)], threshold: 1 },
});
function metadata(): Pick<ISmartAccountMetadata, 'auth' | 'installedModules'> {
  return {
    auth: { module: 'ecdsa', validator: address(1), data: '0x1234' },
    installedModules: [ecdsa(1), ecdsa(2)],
  };
}
const build = (
  value = metadata(),
  children = [address(1), address(2)],
  threshold = 2
) =>
  buildCompositeValidatorExecutions({
    accountAddress,
    metadata: value,
    children,
    threshold,
    compositeValidatorAddress: builtin,
    isAlgorithmAvailable: isPaliValidatorAlgorithmSupported,
  });
const decode = (calls: ReturnType<typeof build>) =>
  calls.map((call) => {
    expect(call.target).toBe(accountAddress);
    expect(call.value).toBe('0x0');
    return paliSmartAccountInterface.parseTransaction({ data: call.data })!;
  });

describe('validator removal policy', () => {
  const policies = ['all-installed-composites', 'active-composite'] as const;

  it.each(policies)(
    'allows only an installed inactive validator with %s',
    (policy) => {
      const value = metadata();
      expect(canRemoveValidatorModule(value, address(2), policy)).toBe(true);
      expect(canRemoveValidatorModule(value, address(1), policy)).toBe(false);
      expect(canRemoveValidatorModule(value, address(9), policy)).toBe(false);
      value.installedModules!.push({
        address: address(9),
        type: 'executor',
        id: 'guardian-recovery',
        config: { guardians: [address(1)], threshold: 1, delaySeconds: 1 },
      });
      expect(canRemoveValidatorModule(value, address(9), policy)).toBe(false);
    }
  );

  it('preserves Hub protection of every installed composite and consent protection of only the active composite', () => {
    const value = metadata();
    value.installedModules!.push({
      address: builtin,
      type: 'validator',
      id: 'composite',
      config: { childValidators: [address(2)], threshold: 1 },
    });
    expect(
      canRemoveValidatorModule(value, address(2), 'all-installed-composites')
    ).toBe(false);
    expect(
      canRemoveValidatorModule(value, address(2), 'active-composite')
    ).toBe(true);
    value.auth = { module: 'composite', validator: builtin, data: '0x' };
    expect(
      canRemoveValidatorModule(value, address(2), 'active-composite')
    ).toBe(false);
    expect(canRemoveValidatorModule(value, builtin, 'active-composite')).toBe(
      false
    );
    expect(
      canRemoveValidatorModule(value, address(1), 'active-composite')
    ).toBe(true);
  });

  it.each(policies)(
    'normalizes addresses and refuses malformed removal inputs with %s',
    (policy) => {
      const value = metadata();
      value.installedModules!.push(ecdsa(0xab));
      expect(
        canRemoveValidatorModule(
          value,
          `0x${address(0xab).slice(2).toUpperCase()}`,
          policy
        )
      ).toBe(true);
      expect(canRemoveValidatorModule(value, 'invalid', policy)).toBe(false);
      expect(canRemoveValidatorModule(value, address(0), policy)).toBe(false);
      expect(
        canRemoveValidatorModule(
          { ...value, auth: undefined },
          address(2),
          policy
        )
      ).toBe(false);
      expect(
        canRemoveValidatorModule(
          { ...value, installedModules: undefined },
          address(2),
          policy
        )
      ).toBe(false);
      value.auth!.validator = 'invalid';
      expect(canRemoveValidatorModule(value, address(2), policy)).toBe(false);
    }
  );

  it.each(policies)(
    'refuses malformed composite references with %s',
    (policy) => {
      const value = metadata();
      const composite: SmartAccountValidatorModule = {
        address: builtin,
        type: 'validator',
        id: 'composite',
        config: { childValidators: ['invalid'], threshold: 1 },
      };
      value.installedModules!.push(composite);
      expect(canRemoveValidatorModule(value, address(2), policy)).toBe(false);
      composite.config.childValidators = null as never;
      expect(canRemoveValidatorModule(value, address(2), policy)).toBe(false);
    }
  );

  it('requires an explicit recognized reference policy', () => {
    expect(
      canRemoveValidatorModule(metadata(), address(2), undefined as never)
    ).toBe(false);
    expect(
      canRemoveValidatorModule(metadata(), address(2), 'unknown' as never)
    ).toBe(false);
  });
});

it('custom installation preserves install then restore-active-validator calldata for both callers', () => {
  const calls = buildCustomValidatorInstallExecutions({
    accountAddress,
    customValidatorAddress: address(9),
    customInitData: '0xabcd',
    activeValidatorAddress: address(1),
    activeValidatorData: '0x1234',
  });
  const [install, rotate] = decode(calls);
  expect(install.name).toBe('installModule');
  expect([...install.args]).toEqual([BigInt(1), address(9), '0xabcd']);
  expect(rotate.name).toBe('rotateValidator');
  expect([...rotate.args]).toEqual([address(1), '0x', '0x1234']);
});

it('uninstallation preserves the single validator-type call and empty deinit data', () => {
  const [uninstall] = decode(
    buildValidatorUninstallExecutions({
      accountAddress,
      validatorAddress: address(9),
    })
  );
  expect(uninstall.name).toBe('uninstallModule');
  expect([...uninstall.args]).toEqual([BigInt(1), address(9), '0x']);
});

for (const state of ['absent', 'active', 'inactive'] as const) {
  it(`preserves the ${state} composite transaction sequence and ordered threshold payload`, () => {
    const value = metadata();
    if (state !== 'absent')
      value.installedModules!.push({
        address: builtin,
        type: 'validator',
        id: 'composite',
        data: '0x',
        config: { childValidators: [address(1)], threshold: 1 },
      });
    if (state === 'active')
      value.auth = { module: 'composite', validator: builtin, data: '0x' };
    const calls = decode(build(value, [address(2), address(1)], 2));
    expect(calls.map((call) => call.name)).toEqual(
      state === 'active'
        ? ['rotateValidator']
        : state === 'inactive'
        ? ['uninstallModule', 'installModule']
        : ['installModule']
    );
    const configured = calls.at(-1)!;
    const init = encodeCompositeValidatorInitData([address(2), address(1)], 2);
    expect([...configured.args]).toEqual(
      state === 'active' ? [builtin, '0x', init] : [BigInt(1), builtin, init]
    );
    if (state === 'inactive')
      expect([...calls[0].args]).toEqual([BigInt(1), builtin, '0x']);
  });
}

it.each([
  [[], 1],
  [[address(1), address(1)], 1],
  [[address(0)], 1],
  [[address(9)], 1],
  [[address(1)], 0],
  [[address(1)], 2],
  [[address(1)], 1.5],
] as [string[], number][])(
  'refuses invalid composite children or threshold %j/%s',
  (children, threshold) => {
    expect(() => build(metadata(), children, threshold)).toThrow(
      'INVALID_COMPOSITE'
    );
  }
);

it('requires enough locally supported children even when a custom child advertises compatibility', () => {
  const value = metadata();
  value.installedModules!.push({
    address: address(9),
    type: 'validator',
    id: 'custom',
    data: '0x',
    config: {
      name: 'Custom child',
      initData: '0x',
      moduleType: 1,
      compositeCompatible: true,
    },
  });
  expect(build(value, [address(1), address(9)], 1)).toHaveLength(1);
  expect(() => build(value, [address(1), address(9)], 2)).toThrow(
    'COMPOSITE_LOCKOUT'
  );
  expect(() => build(value, [address(9)], 1)).toThrow('COMPOSITE_LOCKOUT');
  value.installedModules![2] = {
    ...value.installedModules![2],
    config: { initData: '0x', moduleType: 1, compositeCompatible: false },
  } as SmartAccountValidatorModule;
  expect(() => build(value, [address(1), address(9)], 1)).toThrow(
    'INVALID_COMPOSITE'
  );
});

it('host algorithm availability is explicit and cannot make an unavailable threshold signable', () => {
  expect(() =>
    buildCompositeValidatorExecutions({
      accountAddress,
      metadata: metadata(),
      children: [address(1), address(2)],
      threshold: 2,
      compositeValidatorAddress: builtin,
      isAlgorithmAvailable: (module) => module.address === address(1),
    })
  ).toThrow('COMPOSITE_LOCKOUT');
});

it('refuses unavailable catalogue support and nested composite children', () => {
  expect(() =>
    buildCompositeValidatorExecutions({
      accountAddress,
      metadata: metadata(),
      children: [address(1)],
      threshold: 1,
      compositeValidatorAddress: null,
      isAlgorithmAvailable: isPaliValidatorAlgorithmSupported,
    })
  ).toThrow('COMPOSITE_UNAVAILABLE');
  const value = metadata();
  value.installedModules!.push({
    address: builtin,
    type: 'validator',
    id: 'composite',
    data: '0x',
    config: { childValidators: [address(1)], threshold: 1 },
  });
  expect(() => build(value, [builtin], 1)).toThrow(
    SmartAccountModuleCommandError
  );
});
