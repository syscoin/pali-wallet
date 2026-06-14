jest.unmock('@ethersproject/address');
jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

import { defaultAbiCoder } from '@ethersproject/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { hexConcat } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';

import { encodeP256WebAuthnAuthData } from '../passkey/account';

import {
  buildSmartAccountUserOperation,
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  encodeBatchERC7579Execution,
  encodeEcdsaValidatorInitData,
  encodeERC7579Executions,
  getConfiguredAuthenticatorAddress,
  getPaliSmartAccountDeploymentSalt,
  getPaliSmartAccountDescriptor,
  getSmartAccountAuthHash,
  getSmartAccountUserOpRequiredPrefund,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
  withSmartAccountPaymasterData,
} from './account';
import { toPaliSmartAccount } from './adapter';
import {
  ERC7579_MODULE_TYPE_VALIDATOR,
  paliP256WebAuthnValidatorInterface,
  paliSmartAccountInterface,
  paliSmartAccountFactoryInterface,
} from './contracts';
import { encodeSmartAccountAuthenticatorSignature } from './execution';
import {
  applySmartAccountPaymaster,
  buildSmartAccountPaymasterAndData,
  buildSmartAccountPaymasterApprovalSetup,
  canApplySmartAccountPaymaster,
  getSmartAccountPaymasterCapability,
  getSmartAccountPaymasterConfig,
  getSmartAccountPaymasterMaxTokenCost,
  hasSmartAccountFeeTokenTransfer,
} from './paymaster';

describe('ERC-7579 smart account helpers', () => {
  const auth = {
    data: encodeP256WebAuthnAuthData({
      credentialIdHash:
        '0x0101010101010101010101010101010101010101010101010101010101010101',
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

  it('attaches paymaster data to a packed smart-account UserOperation draft', () => {
    const op = buildSmartAccountUserOperation({
      callData: '0x1234',
      nonce: '1',
      sender: '0x1111111111111111111111111111111111111111',
    });

    expect(withSmartAccountPaymasterData(op, '0xpaymaster')).toEqual({
      ...op,
      paymasterAndData: '0xpaymaster',
    });
  });

  it('encodes ERC-4337 paymasterAndData from network paymaster config', () => {
    const config = getSmartAccountPaymasterConfig({
      smartAccountPaymaster: {
        address: '0x2222222222222222222222222222222222222222',
        feeToken: {
          address: '0x3333333333333333333333333333333333333333',
          symbol: 'zkSYS',
        },
        mode: 'required',
        paymasterData: '0xabcdef',
        paymasterPostOpGasLimit: 80_000,
        paymasterVerificationGasLimit: 120_000,
      },
    });
    const userOperation = buildSmartAccountUserOperation({
      callData: '0x1234',
      nonce: '1',
      sender: '0x1111111111111111111111111111111111111111',
    });

    expect(config).toBeDefined();
    expect(
      buildSmartAccountPaymasterAndData(config!, {
        chainId: 57057,
        entryPoint: '0x4444444444444444444444444444444444444444',
        userOperation,
      })
    ).toBe(
      '0x22222222222222222222222222222222222222220000000000000000000000000001d4c000000000000000000000000000013880abcdef'
    );
    expect(
      getSmartAccountPaymasterCapability({ smartAccountPaymaster: config! })
    ).toEqual({
      feeToken: {
        address: '0x3333333333333333333333333333333333333333',
        symbol: 'zkSYS',
      },
      mode: 'required',
      paymaster: '0x2222222222222222222222222222222222222222',
      status: 'supported',
    });
  });

  it('applies configured paymaster data before the UserOperation is signed', () => {
    const userOperation = buildSmartAccountUserOperation({
      callData: '0x1234',
      nonce: '1',
      sender: '0x1111111111111111111111111111111111111111',
      signature: '0x',
    });
    const sponsored = applySmartAccountPaymaster(
      userOperation,
      {
        address: '0x2222222222222222222222222222222222222222',
        paymasterData: '0x',
        paymasterPostOpGasLimit: 80_000,
        paymasterVerificationGasLimit: 120_000,
      },
      {
        chainId: 57057,
        entryPoint: '0x4444444444444444444444444444444444444444',
      }
    );

    expect(sponsored).toEqual({
      ...userOperation,
      paymasterAndData:
        '0x22222222222222222222222222222222222222220000000000000000000000000001d4c000000000000000000000000000013880',
    });
    expect(sponsored.signature).toBe('0x');
  });

  it('keeps paymaster sponsorship disabled when no network config exists', () => {
    expect(getSmartAccountPaymasterConfig({})).toBeUndefined();
    expect(getSmartAccountPaymasterCapability({})).toBeUndefined();
  });

  it('keeps paymaster sponsorship disabled when gas limits are missing', () => {
    expect(
      getSmartAccountPaymasterConfig({
        smartAccountPaymaster: {
          address: '0x2222222222222222222222222222222222222222',
        } as any,
      })
    ).toBeUndefined();
  });

  it('detects fee-token transfers that should not be paymaster sponsored', () => {
    const feeToken = '0x3333333333333333333333333333333333333333';
    const config = {
      feeToken: {
        address: feeToken,
        symbol: 'zkSYS',
      },
    };
    const transferData = hexConcat([
      '0xa9059cbb',
      defaultAbiCoder.encode(
        ['address', 'uint256'],
        ['0x4444444444444444444444444444444444444444', 123]
      ),
    ]);
    const transferFromData = hexConcat([
      '0x23b872dd',
      defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        [
          '0x5555555555555555555555555555555555555555',
          '0x4444444444444444444444444444444444444444',
          123,
        ]
      ),
    ]);

    expect(
      hasSmartAccountFeeTokenTransfer(
        [{ data: transferData, target: feeToken }],
        config
      )
    ).toBe(true);
    expect(
      hasSmartAccountFeeTokenTransfer(
        [{ data: transferFromData, target: feeToken }],
        config
      )
    ).toBe(true);
  });

  it('does not treat fee-token approvals as balance-spending transfers', () => {
    const feeToken = '0x3333333333333333333333333333333333333333';
    const approveData = hexConcat([
      '0x095ea7b3',
      defaultAbiCoder.encode(
        ['address', 'uint256'],
        ['0x2222222222222222222222222222222222222222', 123]
      ),
    ]);

    expect(
      hasSmartAccountFeeTokenTransfer(
        [{ data: approveData, target: feeToken }],
        {
          feeToken: {
            address: feeToken,
            symbol: 'zkSYS',
          },
        }
      )
    ).toBe(false);
  });

  it('rejects malformed local paymaster data before signing', () => {
    expect(() =>
      getSmartAccountPaymasterConfig({
        smartAccountPaymaster: {
          address: '0x2222222222222222222222222222222222222222',
          paymasterData: 'not-hex',
          paymasterPostOpGasLimit: 80_000,
          paymasterVerificationGasLimit: 120_000,
        },
      })
    ).toThrow('Smart account paymaster data must be hex encoded');
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

  it('includes paymaster gas when computing the ERC-20 paymaster precharge', () => {
    const userOperation = buildSmartAccountUserOperation({
      accountGasLimits: encodeSmartAccountGasLimits({
        callGasLimit: 250_000,
        verificationGasLimit: 200_000,
      }),
      callData: '0x1234',
      gasFees: encodeSmartAccountGasFees({
        maxFeePerGas: 2_500_000_000,
        maxPriorityFeePerGas: 1_000_000_000,
      }),
      nonce: '1',
      preVerificationGas: '50000',
      sender: '0x1111111111111111111111111111111111111111',
    });

    expect(
      getSmartAccountPaymasterMaxTokenCost(userOperation, {
        paymasterPostOpGasLimit: 80_000,
        paymasterVerificationGasLimit: 120_000,
      }).toString()
    ).toBe(
      // (200_000 + 250_000 + 50_000 + 120_000 + 80_000) * 2.5 gwei
      (BigInt(700_000) * BigInt(2_500_000_000)).toString()
    );
  });

  it('does not use an ERC-20 paymaster before the smart account is deployed', async () => {
    const userOperation = buildSmartAccountUserOperation({
      callData: '0x1234',
      nonce: '1',
      sender: '0x1111111111111111111111111111111111111111',
    });

    await expect(
      canApplySmartAccountPaymaster(
        {} as any,
        userOperation,
        {
          address: '0x2222222222222222222222222222222222222222',
          feeToken: {
            address: '0x3333333333333333333333333333333333333333',
            symbol: 'zkSYS',
          },
          paymasterPostOpGasLimit: 80_000,
          paymasterVerificationGasLimit: 120_000,
        },
        false
      )
    ).resolves.toBe(false);
  });

  it('builds a max ERC-20 approval setup for the configured paymaster', () => {
    const setup = buildSmartAccountPaymasterApprovalSetup(
      {
        address: '0x2222222222222222222222222222222222222222',
        feeToken: {
          address: '0x3333333333333333333333333333333333333333',
          symbol: 'zkSYS',
        },
        paymasterPostOpGasLimit: 80_000,
        paymasterVerificationGasLimit: 120_000,
      },
      BigNumber.from(123)
    );

    expect(setup).toEqual({
      execution: {
        data: '0x095ea7b30000000000000000000000002222222222222222222222222222222222222222ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        target: '0x3333333333333333333333333333333333333333',
        value: '0x0',
      },
      paymaster: '0x2222222222222222222222222222222222222222',
      required: false,
      requiredAllowance: '123',
      token: {
        address: '0x3333333333333333333333333333333333333333',
        symbol: 'zkSYS',
      },
    });
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
      paliSmartAccountFactoryInterface.getSighash(
        'createAccount(bytes32,bytes)'
      )
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
      paliSmartAccountFactoryInterface.getSighash(
        'createAccountWithModules(bytes32,(address,bytes)[],(address,bytes)[],(address,bytes),(address,bytes)[])'
      )
    ).toBe('0x731db2ac');
    expect(
      paliSmartAccountFactoryInterface.getSighash('getInitData(bytes)')
    ).toBe('0x19e925aa');
    expect(
      paliSmartAccountFactoryInterface.getSighash(
        'getInitData((address,bytes)[],(address,bytes)[],(address,bytes),(address,bytes)[])'
      )
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

  it('builds a generic Pali smart account adapter over ERC-7579 factory and execute calls', async () => {
    const factoryAddress = '0x3333333333333333333333333333333333333333';
    const accountAddress = '0x4444444444444444444444444444444444444444';
    const salt =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const initCode = defaultAbiCoder.encode(
      ['address', 'bytes'],
      [auth.validator, auth.data]
    );
    const factory = {
      getAddress: jest.fn(async () => accountAddress),
      getInitData: jest.fn(async () => initCode),
      interface: paliSmartAccountFactoryInterface,
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
      paliSmartAccountFactoryInterface.getSighash(
        'createAccount(bytes32,bytes)'
      )
    );
    expect(await account.getDeploymentInitCode()).toBe(
      hexConcat([factoryAddress, factoryArgs.factoryData])
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

  it('treats P-256 WebAuthn as a standard ERC-7579 validator module', () => {
    expect(getConfiguredAuthenticatorAddress(57057, 'p256-webauthn')).toMatch(
      /^0x[0-9a-fA-F]{40}$/
    );
    expect(paliP256WebAuthnValidatorInterface.getSighash('onInstall')).toBe(
      '0x6d61fe70'
    );
    expect(paliP256WebAuthnValidatorInterface.getSighash('onUninstall')).toBe(
      '0x8a91b0e3'
    );

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
