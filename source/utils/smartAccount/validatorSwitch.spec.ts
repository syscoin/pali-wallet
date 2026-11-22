import { AddressZero, getAddress } from '../ethersV6Compat';
import { getSLHDSAKeyId, SLH_DSA_SIGNATURE_LIMIT } from '../slhDsa/constants';

import {
  encodeEcdsaValidatorInitData,
  encodeCompositeValidatorInitData,
  getConfiguredAuthenticatorAddress,
} from './account';
import {
  buildECDSAAuthenticator,
  buildP256WebAuthnAuthenticator,
  buildSLHDSAAuthenticator,
} from './authenticators';
import type { SmartAccountAuthenticatorBuildResult } from './authenticators';
import { PALI_MODULE_REGISTRY, paliSmartAccountInterface } from './contracts';
import {
  assertSmartAccountValidatorSwitchApplied,
  assertSmartAccountValidatorSwitchCurrent,
  buildSmartAccountValidatorSwitch,
} from './validatorSwitch';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network';

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
  buildSmartAccountValidatorSwitch({
    accountAddress,
    chainId: 1,
    metadata: value,
    target: buildECDSAAuthenticator({
      chainId: 1,
      config: { owners: [ownerAddress], threshold: 1 },
    }),
  });

const slhTarget = (chainId = 1) => {
  const publicKey = {
    pkRoot: `0x${'44'.repeat(16)}${'00'.repeat(16)}`,
    pkSeed: `0x${'55'.repeat(16)}${'00'.repeat(16)}`,
  };
  return buildSLHDSAAuthenticator({
    chainId,
    config: {
      ...publicKey,
      keyId: getSLHDSAKeyId(publicKey),
      parameterSet: 'SLH-DSA-SHA2-128-24',
      signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
    },
  });
};
const applied = (
  target: SmartAccountAuthenticatorBuildResult
): ISmartAccountMetadata => ({
  ...metadata(),
  auth: { ...target.auth },
  installedModules: target.metadata.installedModules,
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
  assertSmartAccountValidatorSwitchApplied(command, metadata(ownerAddress));
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
  assertSmartAccountValidatorSwitchCurrent(command, metadata());
  expect(() =>
    assertSmartAccountValidatorSwitchCurrent(command, metadata(ownerAddress))
  ).toThrow();
  expect(() =>
    assertSmartAccountValidatorSwitchApplied(command, metadata())
  ).toThrow();
  assertSmartAccountValidatorSwitchApplied(command, metadata(ownerAddress));
  expect(() => build({ ...metadata(), chainId: 2 })).toThrow();
  expect(() => build({ ...metadata(), isDeployed: false })).toThrow();
  expect(() =>
    buildSmartAccountValidatorSwitch({
      accountAddress,
      chainId: 1,
      metadata: metadata(),
      target: buildECDSAAuthenticator({
        chainId: 1,
        config: { owners: [AddressZero], threshold: 1 },
      }),
    })
  ).toThrow();
});

it('uses the same exact plan and canonical metadata checks for an SLH-DSA target', () => {
  const target = slhTarget();
  const command = buildSmartAccountValidatorSwitch({
    accountAddress,
    chainId: 1,
    metadata: metadata(),
    target,
  });
  expect(command.targetModule.id).toBe('slh-dsa');
  expect(command.executions).toHaveLength(2);
  expect(
    paliSmartAccountInterface.parseTransaction({
      data: command.executions[0]!.data,
    })?.name
  ).toBe('installModule');
  expect(
    paliSmartAccountInterface.parseTransaction({
      data: command.executions[1]!.data,
    })?.name
  ).toBe('uninstallModule');
  assertSmartAccountValidatorSwitchCurrent(command, metadata());
  assertSmartAccountValidatorSwitchApplied(command, applied(target));
  const wrongConfig = applied(target);
  (
    wrongConfig.installedModules![0] as Extract<
      SmartAccountValidatorModule,
      { id: 'slh-dsa' }
    >
  ).config = {
    ...(
      target.metadata.installedModules![0] as Extract<
        SmartAccountValidatorModule,
        { id: 'slh-dsa' }
      >
    ).config,
    pkRoot: `0x${'66'.repeat(32)}`,
  };
  // Matching active auth bytes and address cannot conceal different hydrated config.
  expect(() =>
    assertSmartAccountValidatorSwitchApplied(command, wrongConfig)
  ).toThrow();
});

it('captures all public target config and execution bytes before caller mutation', () => {
  const target = buildECDSAAuthenticator({
    chainId: 1,
    config: { owners: [ownerAddress, priorOwner], threshold: 2 },
  });
  const command = buildSmartAccountValidatorSwitch({
    accountAddress,
    chainId: 1,
    metadata: metadata(),
    target,
  });
  const originalData = command.target.data;
  const module = target.metadata.installedModules![0] as Extract<
    SmartAccountValidatorModule,
    { id: 'ecdsa' }
  >;
  module.config.owners.reverse();
  module.config.threshold = 1;
  target.auth.data = '0x';
  expect(command.target.data).toBe(originalData);
  expect(command.targetModule.config).toEqual({
    owners: [getAddress(ownerAddress), getAddress(priorOwner)],
    threshold: 2,
  });
  expect(Object.isFrozen(command.target)).toBe(true);
  expect(Object.isFrozen(command.targetModule.config)).toBe(true);
  expect(
    Object.isFrozen(
      (
        command.targetModule as Extract<
          typeof command.targetModule,
          { id: 'ecdsa' }
        >
      ).config.owners
    )
  ).toBe(true);
  assertSmartAccountValidatorSwitchCurrent(command, metadata());
  expect(() =>
    assertSmartAccountValidatorSwitchCurrent(
      { ...command, executions: [] },
      metadata()
    )
  ).toThrow();
});

it.each(['p256-webauthn', 'composite'] as const)(
  'preserves %s public targets and exact no-op confirmation',
  (id) => {
    const target =
      id === 'p256-webauthn'
        ? buildP256WebAuthnAuthenticator({
            chainId: 1,
            config: {
              publicKey: {
                x: `0x${'11'.repeat(32)}`,
                y: `0x${'22'.repeat(32)}`,
                originHash: `0x${'33'.repeat(32)}`,
                rpIdHash: `0x${'44'.repeat(32)}`,
                originLength: 52,
              },
            },
          })
        : (() => {
            const address = getConfiguredAuthenticatorAddress(1, 'composite');
            const config = {
              childValidators: [validator, slhTarget().auth.validator],
              threshold: 2,
            };
            const data = encodeCompositeValidatorInitData(
              config.childValidators,
              config.threshold
            );
            return {
              auth: { module: 'composite' as const, validator: address, data },
              metadata: {
                installedModules: [
                  {
                    address,
                    config,
                    data,
                    id: 'composite' as const,
                    type: 'validator' as const,
                  },
                ],
              },
            };
          })();
    const current = applied(target);
    const command = buildSmartAccountValidatorSwitch({
      accountAddress,
      chainId: 1,
      metadata: current,
      target,
    });
    expect(command.executions).toEqual([]);
    assertSmartAccountValidatorSwitchApplied(command, current);
    const wrong = applied(target);
    wrong.installedModules = [{ ...wrong.installedModules![0]!, data: '0x' }];
    expect(() =>
      assertSmartAccountValidatorSwitchApplied(command, wrong)
    ).toThrow();
  }
);

it('requires target module identity, config and init bytes to agree', () => {
  const target = buildECDSAAuthenticator({
    chainId: 1,
    config: { owners: [ownerAddress], threshold: 1 },
  });
  const command = buildSmartAccountValidatorSwitch({
    accountAddress,
    chainId: 1,
    metadata: metadata(),
    target,
  });
  assertSmartAccountValidatorSwitchApplied(command, applied(target));
  const inconsistent = {
    ...target,
    auth: {
      ...target.auth,
      data: encodeEcdsaValidatorInitData([priorOwner], 1),
    },
  };
  expect(() =>
    buildSmartAccountValidatorSwitch({
      accountAddress,
      chainId: 1,
      metadata: metadata(),
      target: inconsistent,
    })
  ).toThrow();
  expect(() =>
    buildSmartAccountValidatorSwitch({
      accountAddress,
      chainId: 1,
      metadata: metadata(),
      target: { ...target, metadata: {} },
    })
  ).toThrow();
  expect(() =>
    buildSmartAccountValidatorSwitch({
      accountAddress: AddressZero,
      chainId: 1,
      metadata: metadata(),
      target,
    })
  ).toThrow();
  const installed = metadata();
  const slh = slhTarget();
  const slhCommand = buildSmartAccountValidatorSwitch({
    accountAddress,
    chainId: 1,
    metadata: metadata(),
    target: slh,
  });
  installed.installedModules!.push(slh.metadata.installedModules![0]!);
  expect(() =>
    assertSmartAccountValidatorSwitchCurrent(slhCommand, installed)
  ).toThrow();
});

it.each(['ecdsa', 'p256-webauthn', 'slh-dsa', 'composite'] as const)(
  'binds the %s builtin target to the configured chain address',
  (id) => {
    const targetFor = (
      chainId: number
    ): SmartAccountAuthenticatorBuildResult => {
      if (id === 'ecdsa')
        return buildECDSAAuthenticator({
          chainId,
          config: { owners: [ownerAddress], threshold: 1 },
        });
      if (id === 'slh-dsa') return slhTarget(chainId);
      if (id === 'p256-webauthn')
        return buildP256WebAuthnAuthenticator({
          chainId,
          config: {
            publicKey: {
              x: `0x${'11'.repeat(32)}`,
              y: `0x${'22'.repeat(32)}`,
              originHash: `0x${'33'.repeat(32)}`,
              rpIdHash: `0x${'44'.repeat(32)}`,
              originLength: 52,
            },
          },
        });
      const address = getConfiguredAuthenticatorAddress(chainId, id);
      const config = {
        childValidators: [validator, slhTarget(chainId).auth.validator],
        threshold: 2,
      };
      const data = encodeCompositeValidatorInitData(
        config.childValidators,
        config.threshold
      );
      return {
        auth: { module: id, validator: address, data },
        metadata: {
          installedModules: [{ type: 'validator', id, address, data, config }],
        },
      };
    };
    const foreignChain = 31337;
    const entry = PALI_MODULE_REGISTRY.find((module) => module.id === id)!;
    const priorAddress = entry.addresses[foreignChain];
    const alternate = getAddress(`0x${'77'.repeat(20)}`);
    try {
      // Use the real chain-aware builders/registry, without replacing address lookup.
      entry.addresses[foreignChain] = alternate;
      const foreign = targetFor(foreignChain);
      expect(getAddress(foreign.auth.validator)).toBe(alternate);
      expect(() =>
        buildSmartAccountValidatorSwitch({
          accountAddress,
          chainId: 1,
          metadata: metadata(),
          target: foreign,
        })
      ).toThrow();
      const forged = targetFor(1);
      forged.auth.validator = alternate;
      forged.metadata.installedModules![0]!.address = alternate;
      expect(() =>
        buildSmartAccountValidatorSwitch({
          accountAddress,
          chainId: 1,
          metadata: metadata(),
          target: forged,
        })
      ).toThrow();
      const correct = targetFor(1);
      const command = buildSmartAccountValidatorSwitch({
        accountAddress,
        chainId: 1,
        metadata: metadata(),
        target: correct,
      });
      assertSmartAccountValidatorSwitchApplied(command, applied(correct));
    } finally {
      if (priorAddress === undefined) delete entry.addresses[foreignChain];
      else entry.addresses[foreignChain] = priorAddress;
    }
  }
);

it('keeps explicitly identified custom modules outside the builtin address registry', () => {
  const address = getAddress(`0x${'88'.repeat(20)}`);
  const module: SmartAccountValidatorModule = {
    address,
    config: {
      initData: '0x1234',
      moduleType: 1,
      name: 'Explicit custom validator',
    },
    data: '0x1234',
    id: 'custom',
    type: 'validator',
  };
  // Builtin builders do not expose a custom signer. Preserve the existing
  // explicit custom metadata shape without registering it as a builtin.
  const target = {
    auth: { data: '0x1234', module: 'custom', validator: address },
    metadata: { installedModules: [module] },
  } as unknown as SmartAccountAuthenticatorBuildResult;
  const command = buildSmartAccountValidatorSwitch({
    accountAddress,
    chainId: 1,
    metadata: metadata(),
    target,
  });
  assertSmartAccountValidatorSwitchCurrent(command, metadata());
  assertSmartAccountValidatorSwitchApplied(command, applied(target));
});
