import { defaultAbiCoder } from 'utils/ethersV6Compat';
import { hexConcat } from 'utils/ethersV6Compat';
import { id } from 'utils/ethersV6Compat';

import { PALI_ENTRYPOINT_V09_ADDRESS } from './smartAccount/contracts';
import {
  getSmartAccountDisplayTransaction,
  getSmartAccountExecutionTransactions,
  getTransactionDisplayInfo,
} from './transactions';

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
const ENTRYPOINT = PALI_ENTRYPOINT_V09_ADDRESS;
const SMART_ACCOUNT = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const BENEFICIARY = '0x3333333333333333333333333333333333333333';
const MODULE = '0x4444444444444444444444444444444444444444';
const TOKEN = '0x5555555555555555555555555555555555555555';

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
    expect(getSmartAccountExecutionTransactions(tx)).toEqual([
      expect.objectContaining({
        data: '0x',
        from: SMART_ACCOUNT,
        input: '0x',
        to: SMART_ACCOUNT,
        value: '0',
      }),
      expect.objectContaining({
        data: '0x123456',
        from: SMART_ACCOUNT,
        input: '0x123456',
        to: TARGET,
        value: '9',
      }),
    ]);
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

describe('token transaction display', () => {
  it('keeps zero-valued ERC-20 transfers on the token display path', async () => {
    const input = `${id('transfer(address,uint256)').slice(
      0,
      10
    )}${defaultAbiCoder.encode(['address', 'uint256'], [TARGET, 0]).slice(2)}`;

    await expect(
      getTransactionDisplayInfo(
        {
          input,
          to: TOKEN,
          value: '0',
        },
        'ETH',
        true
      )
    ).resolves.toMatchObject({
      actualRecipient: TARGET,
      displaySymbol: '0x5555...5555',
      displayValue: '0',
      formattedValue: '0',
      isErc20Transfer: true,
      isNft: false,
    });
  });

  it('keeps ERC-721 token id zero on the NFT display path', async () => {
    const input = `${id('transferFrom(address,address,uint256)').slice(
      0,
      10
    )}${defaultAbiCoder
      .encode(['address', 'address', 'uint256'], [SMART_ACCOUNT, TARGET, 0])
      .slice(2)}`;

    await expect(
      getTransactionDisplayInfo(
        {
          input,
          to: TOKEN,
          value: '0',
        },
        'ETH',
        true
      )
    ).resolves.toMatchObject({
      actualRecipient: TARGET,
      displaySymbol: 'NFT',
      displayValue: 1,
      formattedValue: '1',
      isErc20Transfer: true,
      isNft: true,
      tokenId: '0',
    });
  });
});
