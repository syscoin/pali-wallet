jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/strings');

import { defaultAbiCoder } from '@ethersproject/abi';
import { hexConcat } from '@ethersproject/bytes';
import { id } from '@ethersproject/hash';

import { PALI_ENTRYPOINT_V09_ADDRESS } from './smartAccount/contracts';
import { getSmartAccountDisplayTransaction } from './transactions';

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
const ENTRYPOINT = PALI_ENTRYPOINT_V09_ADDRESS;
const SMART_ACCOUNT = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const BENEFICIARY = '0x3333333333333333333333333333333333333333';
const MODULE = '0x4444444444444444444444444444444444444444';

const encodeHandleOps = (callData: string) => {
  const userOperation = [
    SMART_ACCOUNT,
    0,
    '0x',
    callData,
    ZERO_BYTES32,
    50_000,
    ZERO_BYTES32,
    '0x',
    '0x1234',
  ];
  const encodedArgs = defaultAbiCoder.encode(
    [
      'tuple(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[]',
      'address',
    ],
    [[userOperation], BENEFICIARY]
  );

  return `${id(
    'handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)'
  ).slice(0, 10)}${encodedArgs.slice(2)}`;
};

const encodeAccountExecute = (mode: string, executionCalldata: string) => {
  const encodedArgs = defaultAbiCoder.encode(
    ['bytes32', 'bytes'],
    [mode, executionCalldata]
  );

  return `${id('execute(bytes32,bytes)').slice(0, 10)}${encodedArgs.slice(2)}`;
};

describe('smart account transaction display', () => {
  it('unwraps ERC-4337 handleOps with single ERC-7579 execution', () => {
    const executionCalldata = hexConcat([
      TARGET,
      defaultAbiCoder.encode(['uint256'], ['7']),
      '0xabcdef',
    ]);
    const tx = {
      data: encodeHandleOps(
        encodeAccountExecute(ZERO_BYTES32, executionCalldata)
      ),
      from: BENEFICIARY,
      smartAccountExecutionFrom: SMART_ACCOUNT,
      to: ENTRYPOINT,
      value: '0',
    };

    expect(getSmartAccountDisplayTransaction(tx)).toMatchObject({
      data: '0xabcdef',
      from: SMART_ACCOUNT,
      input: '0xabcdef',
      to: TARGET,
      value: '7',
    });
  });

  it('unwraps ERC-4337 handleOps with batch ERC-7579 execution', () => {
    const mode =
      '0x0100000000000000000000000000000000000000000000000000000000000000';
    const executionCalldata = defaultAbiCoder.encode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      [
        [
          [SMART_ACCOUNT, '0', '0x'],
          [TARGET, '9', '0x123456'],
        ],
      ]
    );
    const tx = {
      data: encodeHandleOps(encodeAccountExecute(mode, executionCalldata)),
      from: BENEFICIARY,
      smartAccountExecutionFrom: SMART_ACCOUNT,
      to: ENTRYPOINT,
      value: '0',
    };

    expect(getSmartAccountDisplayTransaction(tx)).toMatchObject({
      data: '0x123456',
      from: SMART_ACCOUNT,
      input: '0x123456',
      to: TARGET,
      value: '9',
    });
  });

  it('prefers module install over uninstall for module update batches', () => {
    const mode =
      '0x0100000000000000000000000000000000000000000000000000000000000000';
    const uninstallData = `${id('uninstallModule(uint256,address,bytes)').slice(
      0,
      10
    )}${defaultAbiCoder
      .encode(['uint256', 'address', 'bytes'], [2, MODULE, '0x'])
      .slice(2)}`;
    const installData = `${id('installModule(uint256,address,bytes)').slice(
      0,
      10
    )}${defaultAbiCoder
      .encode(['uint256', 'address', 'bytes'], [2, MODULE, '0x1234'])
      .slice(2)}`;
    const executionCalldata = defaultAbiCoder.encode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      [
        [
          [SMART_ACCOUNT, '0', uninstallData],
          [SMART_ACCOUNT, '0', installData],
        ],
      ]
    );
    const tx = {
      data: encodeHandleOps(encodeAccountExecute(mode, executionCalldata)),
      from: BENEFICIARY,
      smartAccountExecutionFrom: SMART_ACCOUNT,
      to: ENTRYPOINT,
      value: '0',
    };

    expect(getSmartAccountDisplayTransaction(tx)).toMatchObject({
      data: installData,
      from: SMART_ACCOUNT,
      input: installData,
      to: SMART_ACCOUNT,
      value: '0',
    });
  });
});
