jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/strings');

import { defaultAbiCoder } from '@ethersproject/abi';
import { hexConcat } from '@ethersproject/bytes';

import { decodeSmartAccountTransactionData } from './ethUtil';
import {
  ERC7579_MODULE_TYPE_VALIDATOR,
  paliEntryPointInterface,
  paliSmartAccountFactoryInterface,
  paliSmartAccountInterface,
} from './smartAccount/contracts';

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
const SMART_ACCOUNT = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const BENEFICIARY = '0x3333333333333333333333333333333333333333';
const VALIDATOR = '0x4444444444444444444444444444444444444444';

describe('smart account transaction decoding', () => {
  it('decodes ERC-7579 single execute payloads', () => {
    const executionCalldata = hexConcat([
      TARGET,
      defaultAbiCoder.encode(['uint256'], ['7']),
      '0xabcdef',
    ]);
    const data = paliSmartAccountInterface.encodeFunctionData('execute', [
      ZERO_BYTES32,
      executionCalldata,
    ]);

    expect(decodeSmartAccountTransactionData(data)).toEqual({
      inputs: [ZERO_BYTES32, TARGET, expect.anything(), '0xabcdef'],
      method: 'execute',
      names: ['mode', 'target', 'value', 'data'],
      types: ['bytes32', 'address', 'uint256', 'bytes'],
    });
  });

  it('decodes EntryPoint handleOps summaries', () => {
    const userOperation = [
      SMART_ACCOUNT,
      0,
      '0x',
      '0x',
      ZERO_BYTES32,
      50_000,
      ZERO_BYTES32,
      '0x',
      '0x1234',
    ];
    const data = paliEntryPointInterface.encodeFunctionData('handleOps', [
      [userOperation],
      BENEFICIARY,
    ]);

    expect(decodeSmartAccountTransactionData(data)).toMatchObject({
      inputs: [1, SMART_ACCOUNT, BENEFICIARY],
      method: 'handleOps',
      names: ['operationCount', 'firstSender', 'beneficiary'],
      types: ['uint256', 'address', 'address'],
    });
  });

  it('decodes factory and module calls from current ABIs', () => {
    const createAccount = paliSmartAccountFactoryInterface.encodeFunctionData(
      'createAccount',
      [ZERO_BYTES32, '0x1234']
    );
    expect(decodeSmartAccountTransactionData(createAccount)).toMatchObject({
      inputs: [ZERO_BYTES32, '0x1234'],
      method: 'createAccount',
      names: ['salt', 'initCode'],
      types: ['bytes32', 'bytes'],
    });

    const installModule = paliSmartAccountInterface.encodeFunctionData(
      'installModule',
      [ERC7579_MODULE_TYPE_VALIDATOR, VALIDATOR, '0x5678']
    );
    const decodedInstallModule =
      decodeSmartAccountTransactionData(installModule);
    expect(decodedInstallModule).toMatchObject({
      method: 'installModule',
      names: ['moduleTypeId', 'module', 'initData'],
      types: ['uint256', 'address', 'bytes'],
    });
    expect(decodedInstallModule?.inputs[0].toString()).toBe(
      String(ERC7579_MODULE_TYPE_VALIDATOR)
    );
    expect(decodedInstallModule?.inputs.slice(1)).toEqual([
      VALIDATOR,
      '0x5678',
    ]);
  });
});
