jest.unmock('@ethersproject/address');
jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

import { defaultAbiCoder } from '@ethersproject/abi';
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
