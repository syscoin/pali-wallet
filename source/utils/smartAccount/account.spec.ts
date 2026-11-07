import { encodeP256WebAuthnAuthData } from '../passkey/account';
import type { SmartAccountValidatorModule } from 'types/network';
import { defaultAbiCoder } from 'utils/ethersV6Compat';
import { hexConcat } from 'utils/ethersV6Compat';
import { keccak256 } from 'utils/ethersV6Compat';
import { SLH_DSA_SIGNATURE_LIMIT } from 'utils/slhDsa';

import {
  buildSmartAccountUserOperation,
  buildSmartAccountValidatorSwitchPlan,
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  encodeBatchERC7579Execution,
  encodeEcdsaValidatorInitData,
  encodeERC7579Executions,
  encodeInstallValidatorModuleCall,
  encodeRotateValidatorModuleCall,
  encodeSLHDSAValidatorInitData,
  encodeUninstallValidatorModuleCall,
  getConfiguredAuthenticatorAddress,
  getPaliSmartAccountDeploymentSalt,
  getPaliSmartAccountDescriptor,
  getSmartAccountAuthHash,
  getSmartAccountUserOpGasFees,
  getSmartAccountUserOpRequiredPrefund,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
  SMART_ACCOUNT_ZERO_GAS_FEES,
} from './account';
import {
  createOwnedPaliSmartAccountFactory,
  toPaliSmartAccount,
} from './adapter';
import { buildHydratedSLHDSAAuthenticator } from './authenticators';
import {
  ERC7579_MODULE_TYPE_VALIDATOR,
  paliP256WebAuthnValidatorInterface,
  paliSmartAccountInterface,
  paliSmartAccountFactoryInterface,
} from './contracts';
import { derivePaliSmartAccountDeployment } from './counterfactual';
import {
  PALI_CANONICAL_FACTORY_ADDRESS,
  PALI_INFRASTRUCTURE_METADATA_BY_ID,
} from './deploymentMetadata';
import { encodeSmartAccountAuthenticatorSignature } from './execution';

describe('ERC-7579 smart account helpers', () => {
  const auth = {
    data: encodeP256WebAuthnAuthData({
      originHash:
        '0x0505050505050505050505050505050505050505050505050505050505050505',
      originLength: 23,
      rpIdHash:
        '0x0404040404040404040404040404040404040404040404040404040404040404',
      x: '0x0202020202020202020202020202020202020202020202020202020202020202',
      y: '0x0303030303030303030303030303030303030303030303030303030303030303',
    }),
    validator: '0x1111111111111111111111111111111111111111',
  };

  it('hashes auth configs by validator namespace and encoded config', () => {
    expect(getSmartAccountAuthHash(auth)).toBe(
      keccak256(
        defaultAbiCoder.encode(
          ['address', 'bytes32'],
          [auth.validator, keccak256(auth.data)]
        )
      )
    );
  });

  describe('validator switch planner', () => {
    const accountAddress = '0x9999999999999999999999999999999999999999';
    const activeValidator: SmartAccountValidatorModule = {
      address: '0x1111111111111111111111111111111111111111',
      config: {
        owners: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        threshold: 1,
      },
      data: '0xaaaa',
      id: 'ecdsa',
      type: 'validator',
    };
    const targetAuth = {
      data: '0xbbbb',
      module: 'slh-dsa',
      validator: '0x2222222222222222222222222222222222222222',
    } as const;
    const targetValidator = (data = '0x1234'): SmartAccountValidatorModule => ({
      address: targetAuth.validator,
      config: {
        keyId: 'test-key',
        parameterSet: 'SLH-DSA-SHA2-128-24',
        pkRoot:
          '0x1111111111111111111111111111111111111111111111111111111111111111',
        pkSeed:
          '0x2222222222222222222222222222222222222222222222222222222222222222',
        signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
      },
      data,
      id: 'slh-dsa',
      type: 'validator',
    });

    it('does nothing when the active validator already has the target config', () => {
      const plan = buildSmartAccountValidatorSwitchPlan({
        accountAddress,
        activeValidator: targetValidator(targetAuth.data),
        installedValidators: [],
        target: targetAuth,
      });

      expect(plan.executions).toEqual([]);
    });

    it('installs a fresh target validator and removes the previous active validator', () => {
      const plan = buildSmartAccountValidatorSwitchPlan({
        accountAddress,
        activeValidator,
        installedValidators: [activeValidator],
        target: targetAuth,
      });

      expect(plan.executions).toEqual([
        {
          data: encodeInstallValidatorModuleCall(
            targetAuth.validator,
            targetAuth.data
          ),
          target: accountAddress,
          value: '0x0',
        },
        {
          data: encodeUninstallValidatorModuleCall(activeValidator.address),
          target: accountAddress,
          value: '0x0',
        },
      ]);
    });

    it('rotates an already-installed inactive target instead of installing it again', () => {
      const plan = buildSmartAccountValidatorSwitchPlan({
        accountAddress,
        activeValidator,
        installedValidators: [activeValidator, targetValidator()],
        target: targetAuth,
      });

      expect(plan.executions).toEqual([
        {
          data: encodeRotateValidatorModuleCall(
            targetAuth.validator,
            targetAuth.data
          ),
          target: accountAddress,
          value: '0x0',
        },
        {
          data: encodeUninstallValidatorModuleCall(activeValidator.address),
          target: accountAddress,
          value: '0x0',
        },
      ]);
    });

    it('rotates the active validator when only its config changes', () => {
      const plan = buildSmartAccountValidatorSwitchPlan({
        accountAddress,
        activeValidator: targetValidator(activeValidator.data),
        installedValidators: [],
        target: targetAuth,
      });

      expect(plan.executions).toEqual([
        {
          data: encodeRotateValidatorModuleCall(
            targetAuth.validator,
            targetAuth.data
          ),
          target: accountAddress,
          value: '0x0',
        },
      ]);
    });
  });

  it('computes the EntryPoint prefund from packed userOp gas fields', () => {
    const userOperation = {
      accountGasLimits: encodeSmartAccountGasLimits({
        callGasLimit: 250_000,
        verificationGasLimit: 1_100_000,
      }),
      gasFees: encodeSmartAccountGasFees({
        maxFeePerGas: 2_500_000_000,
        maxPriorityFeePerGas: 1_000_000_000,
      }),
      preVerificationGas: '50000',
    };

    expect(getSmartAccountUserOpRequiredPrefund(userOperation).toString()).toBe(
      // (1_100_000 + 250_000 + 50_000) * 2.5 gwei
      (BigInt(1_400_000) * BigInt(2_500_000_000)).toString()
    );
  });

  it('zeros EntryPoint gas fees only for verified gas-tank mode', () => {
    const gasFees = getSmartAccountUserOpGasFees({
      maxFeePerGas: 2_500_000_000,
      maxPriorityFeePerGas: 1_000_000_000,
      useZkSysGasTank: true,
    });
    const userOperation = {
      accountGasLimits: encodeSmartAccountGasLimits({
        callGasLimit: 250_000,
        verificationGasLimit: 1_100_000,
      }),
      gasFees,
      preVerificationGas: '50000',
    };

    expect(gasFees).toBe(SMART_ACCOUNT_ZERO_GAS_FEES);
    expect(getSmartAccountUserOpRequiredPrefund(userOperation).isZero()).toBe(
      true
    );
  });

  it('keeps EntryPoint gas fees outside gas-tank mode', () => {
    expect(
      getSmartAccountUserOpGasFees({
        maxFeePerGas: 2_500_000_000,
        maxPriorityFeePerGas: 1_000_000_000,
        useZkSysGasTank: false,
      })
    ).toBe(
      encodeSmartAccountGasFees({
        maxFeePerGas: 2_500_000_000,
        maxPriorityFeePerGas: 1_000_000_000,
      })
    );
  });

  it('encodes ECDSA threshold config', () => {
    expect(
      encodeEcdsaValidatorInitData(
        ['0x1111111111111111111111111111111111111111'],
        1
      )
    ).toBe(
      defaultAbiCoder.encode(
        ['address[]', 'uint64'],
        [['0x1111111111111111111111111111111111111111'], 1]
      )
    );
  });

  it('encodes SLH-DSA public key config', () => {
    const pkSeed =
      '0x1111111111111111111111111111111100000000000000000000000000000000';
    const pkRoot =
      '0x2222222222222222222222222222222200000000000000000000000000000000';

    expect(encodeSLHDSAValidatorInitData({ pkRoot, pkSeed })).toBe(
      defaultAbiCoder.encode(
        ['tuple(bytes32 pkSeed,bytes32 pkRoot)'],
        [{ pkSeed, pkRoot }]
      )
    );
  });

  it('hydrates SLH-DSA metadata with the signer storage key id', () => {
    const pkSeed =
      '0x1111111111111111111111111111111100000000000000000000000000000000';
    const pkRoot =
      '0x2222222222222222222222222222222200000000000000000000000000000000';
    const built = buildHydratedSLHDSAAuthenticator({
      chainId: 57057,
      pkRoot,
      pkSeed,
    });
    const module = built.metadata.installedModules?.[0];

    expect(module?.type).toBe('validator');
    expect(module?.id).toBe('slh-dsa');
    expect((module as any).config.keyId).toBe(
      `SLH-DSA-SHA2-128-24:${pkSeed}:${pkRoot}`
    );
  });

  it('prefixes ERC-1271 smart-account signatures with the validator', () => {
    expect(
      encodeSmartAccountAuthenticatorSignature({
        signature: '0x1234',
        validator: auth.validator,
      })
    ).toBe(hexConcat([auth.validator, '0x1234']));
  });

  it('encodes ERC-7579 single and batch executions with matching modes', () => {
    const calls = [
      {
        data: '0x1234',
        target: '0x1111111111111111111111111111111111111111',
        value: '1',
      },
      {
        data: '0xabcd',
        target: '0x2222222222222222222222222222222222222222',
        value: '2',
      },
    ];

    expect(encodeERC7579Executions([calls[0]])).toEqual({
      executionCalldata:
        '0x111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000011234',
      executions: [calls[0]],
      mode: ERC7579_MODE_SINGLE_DEFAULT,
    });

    expect(encodeERC7579Executions(calls)).toEqual({
      executionCalldata: encodeBatchERC7579Execution(calls),
      executions: calls,
      mode: ERC7579_MODE_BATCH_DEFAULT,
    });

    const [decoded] = defaultAbiCoder.decode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      encodeBatchERC7579Execution(calls)
    );

    expect(
      decoded.map((entry: any) => [
        entry.target,
        entry.value.toString(),
        entry.callData,
      ])
    ).toEqual([
      ['0x1111111111111111111111111111111111111111', '1', '0x1234'],
      ['0x2222222222222222222222222222222222222222', '2', '0xabcd'],
    ]);
  });

  it('derives recoverable deployment descriptors from wallet anchor and index', () => {
    const descriptor = getPaliSmartAccountDescriptor({
      accountIndex: 0,
      accountVersion: 'PALI_SMART_ACCOUNT_ERC7579_V1',
      anchor: 'pali:eip155:57057:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 57057,
      factoryAddress: '0x2222222222222222222222222222222222222222',
    });

    expect(descriptor).toEqual({
      accountIndex: 0,
      accountVersion: 'PALI_SMART_ACCOUNT_ERC7579_V1',
      anchor: 'pali:eip155:57057:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      anchorHash: keccak256(
        defaultAbiCoder.encode(
          ['string'],
          ['pali:eip155:57057:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']
        )
      ),
      chainId: 57057,
      deploymentSalt: getPaliSmartAccountDeploymentSalt({
        accountIndex: 0,
        anchor: 'pali:eip155:57057:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 57057,
        factoryAddress: '0x2222222222222222222222222222222222222222',
      }),
      factoryAddress: '0x2222222222222222222222222222222222222222',
    });

    expect(
      getPaliSmartAccountDeploymentSalt({
        accountIndex: 1,
        anchor: 'pali:eip155:57057:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 57057,
        factoryAddress: '0x2222222222222222222222222222222222222222',
      })
    ).not.toBe(descriptor.deploymentSalt);

    expect(
      getPaliSmartAccountDeploymentSalt({
        accountIndex: 0,
        anchor: 'pali:eip155:57057:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 57057,
        factoryAddress: '0x2222222222222222222222222222222222222222',
      })
    ).toBe(descriptor.deploymentSalt);
  });

  it('encodes Pali factory account creation with initCode-bound salt', () => {
    const salt =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const initCode = defaultAbiCoder.encode(
      ['address', 'bytes'],
      ['0x1111111111111111111111111111111111111111', auth.data]
    );
    const calldata = paliSmartAccountFactoryInterface.encodeFunctionData(
      'createAccount',
      [salt, initCode]
    );

    expect(calldata.slice(0, 10)).toBe(
      paliSmartAccountFactoryInterface.getFunction(
        'createAccount(bytes32,bytes)'
      )!.selector
    );
    const decoded = paliSmartAccountFactoryInterface.decodeFunctionData(
      'createAccount',
      calldata
    );
    expect(decoded[0]).toBe(salt);
    expect(decoded[1]).toBe(initCode);
  });

  it('exposes the Pali ERC-7579 factory module creation ABI', () => {
    expect(
      paliSmartAccountFactoryInterface.getFunction(
        'createAccountWithModules(bytes32,(address,bytes)[],(address,bytes)[],(address,bytes),(address,bytes)[])'
      )!.selector
    ).toBe('0x731db2ac');
    expect(
      paliSmartAccountFactoryInterface.getFunction('getInitData(bytes)')!
        .selector
    ).toBe('0x19e925aa');
    expect(
      paliSmartAccountFactoryInterface.getFunction(
        'getInitData((address,bytes)[],(address,bytes)[],(address,bytes),(address,bytes)[])'
      )!.selector
    ).toBe('0xd8dcbebf');
  });

  it('carries factory deployment calldata in undeployed ERC-4337 UserOps', () => {
    const factory = '0x3333333333333333333333333333333333333333';
    const salt =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const initCode = '0x1234';
    const createAccountCalldata =
      paliSmartAccountFactoryInterface.encodeFunctionData('createAccount', [
        salt,
        initCode,
      ]);
    const deploymentInitCode = hexConcat([factory, createAccountCalldata]);

    const userOperation = buildSmartAccountUserOperation({
      callData: '0xabcd',
      initCode: deploymentInitCode,
      nonce: '0',
      sender: '0x4444444444444444444444444444444444444444',
    });

    expect(userOperation.initCode).toBe(deploymentInitCode);
    expect(userOperation.initCode.slice(0, 42)).toBe(factory);
    expect(`0x${userOperation.initCode.slice(42)}`).toBe(createAccountCalldata);
  });

  it('checks the factory owner at provider admission after ethers populates the call', async () => {
    let current = true;
    const provider = { call: jest.fn() };
    const factory = createOwnedPaliSmartAccountFactory(1, provider, () => {
      if (!current) throw new Error('Factory context retired');
    });
    const reading = factory['getInitData(address,bytes)'](
      auth.validator,
      auth.data
    );
    current = false;
    await expect(reading).rejects.toThrow('Factory context retired');
    expect(provider.call).not.toHaveBeenCalled();
  });

  it('builds a generic Pali smart account adapter over ERC-7579 factory and execute calls', async () => {
    const salt = '0x' + 'bb'.repeat(32);
    const {
      address: accountAddress,
      factory: factoryAddress,
      initCode,
    } = derivePaliSmartAccountDeployment({
      ...auth,
      deploySalt: salt,
      factoryAddress: PALI_CANONICAL_FACTORY_ADDRESS,
    });
    const factory = {
      'getAddress(bytes32,bytes)': jest.fn(async () => accountAddress),
      'getInitData(address,bytes)': jest.fn(async () => initCode),
    };

    const account = await toPaliSmartAccount({
      auth: {
        ...auth,
        module: 'ecdsa',
      },
      chainId: 57057,
      deploySalt: salt,
      factory,
      factoryAddress,
    });
    const factoryArgs = await account.getFactoryArgs();
    const executionCallData = account.encodeCalls([
      {
        data: '0x1234',
        target: '0x1111111111111111111111111111111111111111',
        value: '1',
      },
    ]);

    expect(account.address).toBe(accountAddress);
    expect(factoryArgs.factory).toBe(factoryAddress);
    expect(factoryArgs.factoryData.slice(0, 10)).toBe(
      paliSmartAccountFactoryInterface.getFunction(
        'createAccount(bytes32,bytes)'
      )!.selector
    );
    expect(await account.getDeploymentInitCode()).toBe(
      hexConcat([factoryAddress, factoryArgs.factoryData])
    );
    expect(factory['getInitData(address,bytes)']).toHaveBeenCalledTimes(1);
    expect(factory['getAddress(bytes32,bytes)']).toHaveBeenCalledTimes(1);
    expect(factory['getAddress(bytes32,bytes)']).toHaveBeenCalledWith(
      salt,
      initCode
    );

    const decodedExecution = paliSmartAccountInterface.decodeFunctionData(
      'execute',
      executionCallData
    );
    expect(decodedExecution[0]).toBe(ERC7579_MODE_SINGLE_DEFAULT);
    expect(decodedExecution[1]).toBe(
      '0x111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000011234'
    );

    const userOperation = account.prepareUserOperation({
      accountGasLimits: '0xaaaaaaaa',
      calls: [
        {
          data: '0x1234',
          to: '0x1111111111111111111111111111111111111111',
          value: '1',
        },
      ],
      gasFees: '0xbbbbbbbb',
      initCode: '0xcccc',
      nonce: '7',
      paymasterAndData: '0xdddd',
      preVerificationGas: '12345',
      signature: '0xeeee',
    });
    expect(userOperation).toMatchObject({
      accountGasLimits: '0xaaaaaaaa',
      gasFees: '0xbbbbbbbb',
      initCode: '0xcccc',
      nonce: '7',
      paymasterAndData: '0xdddd',
      preVerificationGas: '12345',
      sender: accountAddress,
      signature: '0xeeee',
    });
  });

  it.each([
    [
      '0xfFC854565ff83a49d3302821c0AD23822ca1A50C',
      '0xe4897f193cd6a810057530a5163274f74470c450bdb1d329ebde0d4c7897a766',
      '0x51A1459ad911dE3b4BD9ae8A8AD324480519f81F',
      '0xc08f6ee4e88037b1a376908ac44004aacfe8cdccb1092652f4cfa2893f0232e2',
    ],
    [
      '0x1111111111111111111111111111111111111111',
      '0xe4897f193cd6a810057530a5163274f74470c450bdb1d329ebde0d4c7897a766',
      '0x4e7CbEB3dA4e5ff8f1d927B161E0B4c23CAEf0Df',
      '0xd9508ef507c2d63ed19a825e28b5858e52d13273eb4dbdb9f1383abe298f8d7f',
    ],
    [
      '0xfFC854565ff83a49d3302821c0AD23822ca1A50C',
      '0x1e136f70a7a4e1b5161304a375665d380b832103d742eab1b3fb4c2f400aac52',
      '0xe2944dC461ecCda7a3589255EF68d7826847E1a8',
      '0xc08f6ee4e88037b1a376908ac44004aacfe8cdccb1092652f4cfa2893f0232e2',
    ],
  ])(
    'matches the canonical factory and deployed proxy for %s and salt %s',
    (owner, deploySalt, address, initHash) => {
      // Independent vectors from actual canonical factory calls and CREATE2 proxy deployments.
      const deployment = derivePaliSmartAccountDeployment({
        validator: PALI_INFRASTRUCTURE_METADATA_BY_ID.ecdsaValidator.address,
        data: encodeEcdsaValidatorInitData([owner], 1),
        deploySalt,
        factoryAddress: PALI_CANONICAL_FACTORY_ADDRESS,
      });
      expect(deployment.address).toBe(address);
      expect(keccak256(deployment.initCode)).toBe(initHash);
    }
  );

  it.each(['initialization', 'address'])(
    'rejects substituted factory %s before returning a new account',
    async (kind) => {
      const deploySalt = '0x' + 'ab'.repeat(32);
      const factoryAddress = PALI_CANONICAL_FACTORY_ADDRESS;
      const { initCode } = derivePaliSmartAccountDeployment({
        ...auth,
        deploySalt,
        factoryAddress,
      });
      const getAddress = jest.fn(
        async () => '0x4444444444444444444444444444444444444444'
      );
      const factory = {
        'getAddress(bytes32,bytes)': getAddress,
        'getInitData(address,bytes)': jest.fn(async () =>
          kind === 'initialization' ? '0x1234' : initCode
        ),
      };

      await expect(
        toPaliSmartAccount({
          auth: { ...auth, module: 'ecdsa' },
          chainId: 57057,
          deploySalt,
          factory,
          factoryAddress,
        })
      ).rejects.toThrow(
        `Smart account factory ${kind} does not match local derivation`
      );
      if (kind === 'initialization') expect(getAddress).not.toHaveBeenCalled();
    }
  );

  it('refuses deployment bytes for a substituted stored address', async () => {
    const account = await toPaliSmartAccount({
      address: '0x4444444444444444444444444444444444444444',
      auth: { ...auth, module: 'ecdsa' },
      chainId: 57057,
      deploySalt: '0x' + 'ab'.repeat(32),
    });
    await expect(account.getDeploymentInitCode()).rejects.toThrow(
      'Stored smart account address does not match local derivation'
    );
  });

  it('treats P-256 WebAuthn as a standard ERC-7579 validator module', () => {
    expect(getConfiguredAuthenticatorAddress(57057, 'p256-webauthn')).toMatch(
      /^0x[0-9a-fA-F]{40}$/
    );
    expect(
      paliP256WebAuthnValidatorInterface.getFunction('onInstall')!.selector
    ).toBe('0x6d61fe70');
    expect(
      paliP256WebAuthnValidatorInterface.getFunction('onUninstall')!.selector
    ).toBe('0x8a91b0e3');

    const isModuleTypeCalldata =
      paliP256WebAuthnValidatorInterface.encodeFunctionData('isModuleType', [
        ERC7579_MODULE_TYPE_VALIDATOR,
      ]);
    const decoded = paliP256WebAuthnValidatorInterface.decodeFunctionData(
      'isModuleType',
      isModuleTypeCalldata
    );
    expect(decoded[0].toString()).toBe(String(ERC7579_MODULE_TYPE_VALIDATOR));
  });
});
