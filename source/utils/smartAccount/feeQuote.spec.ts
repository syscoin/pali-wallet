import { BigNumber } from 'utils/ethersV6Compat';

import {
  isSmartAccountFeeQuoteChanged,
  prepareSmartAccountFeeQuote,
} from './execution';

const sender = '0x' + '11'.repeat(20);
const executions = [
  { target: '0x' + '22'.repeat(20), data: '0x1234', value: '0x1' },
  { target: '0x' + '33'.repeat(20), data: '0x', value: '0' },
];
const packed = (a: number, b: number) =>
  '0x' + [a, b].map((n) => n.toString(16).padStart(32, '0')).join('');
const prepared = () => ({
  executionContextId: 'read-only-quote',
  executions: executions.map((execution) => ({ ...execution })),
  userOperation: {
    sender,
    accountGasLimits: packed(700000, 30000),
    preVerificationGas: '130000',
    gasFees: packed(0, 5),
  },
});

describe('trusted smart-account fee quote', () => {
  it.each([undefined, false, true])(
    'recognizes only a typed definite pre-broadcast fee error (%s)',
    (transactionNotBroadcast) => {
      expect(
        isSmartAccountFeeQuoteChanged({
          message: 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED',
          transactionNotBroadcast,
        })
      ).toBe(transactionNotBroadcast === true);
    }
  );
  it('quotes full ordered batch prefund through preparation only', async () => {
    const emitter = jest.fn().mockResolvedValue(prepared());
    await expect(
      prepareSmartAccountFeeQuote({
        accountAddress: sender,
        accountId: 19,
        controllerEmitter: emitter,
        executions,
        feeOverrides: { maxFeePerGas: '5', maxPriorityFeePerGas: '0' },
      })
    ).resolves.toEqual({ gasUnits: '860000', maximumFeeWei: '4300000' });
    expect(emitter).toHaveBeenCalledTimes(1);
    expect(emitter.mock.calls[0][0]).toEqual([
      'wallet',
      'prepareSmartAccountExecutions',
    ]);
    expect(emitter.mock.calls[0][1][0]).toEqual(executions);
    expect(emitter.mock.calls[0][1][1]).toBe(19);
  });

  it.each([
    [
      'sender',
      (result: any) => (result.userOperation.sender = executions[0].target),
    ],
    ['target', (result: any) => (result.executions[0].target = sender)],
    ['data', (result: any) => (result.executions[0].data = '0x5678')],
    ['value', (result: any) => (result.executions[0].value = '2')],
    ['order', (result: any) => result.executions.reverse()],
    ['length', (result: any) => result.executions.pop()],
    ['context', (result: any) => delete result.executionContextId],
    ['gas', (result: any) => (result.userOperation.accountGasLimits = '0x00')],
    ['fee cap', (result: any) => (result.userOperation.gasFees = packed(0, 6))],
    [
      'negative gas',
      (result: any) => (result.userOperation.preVerificationGas = '-1'),
    ],
    [
      'unsafe gas',
      (result: any) =>
        (result.userOperation.preVerificationGas = '9007199254740992'),
    ],
  ])('rejects changed or malformed %s', async (_, mutate) => {
    const result = prepared();
    mutate(result);
    await expect(
      prepareSmartAccountFeeQuote({
        accountAddress: sender,
        controllerEmitter: jest.fn().mockResolvedValue(result),
        executions,
        feeOverrides: { gasPrice: '5' },
      })
    ).rejects.toThrow();
  });

  it('uses verified gas-tank zero and honors an explicit maximum gas bound', async () => {
    const result = prepared();
    result.userOperation.gasFees = packed(0, 0);
    const params = {
      accountAddress: sender,
      controllerEmitter: jest.fn().mockResolvedValue(result),
      executions,
      feeOverrides: { gasPrice: '5' },
    };
    await expect(prepareSmartAccountFeeQuote(params)).resolves.toEqual({
      gasUnits: '860000',
      maximumFeeWei: '0',
    });
    await expect(
      prepareSmartAccountFeeQuote({
        ...params,
        maximumGasUnits: BigNumber.from(859999).toString(),
      })
    ).rejects.toThrow();
  });

  it('rejects an account/context mismatch before any controller call', async () => {
    const emitter = jest.fn();
    await expect(
      prepareSmartAccountFeeQuote({
        accountAddress: sender,
        executions,
        controllerEmitter: emitter,
        expectedContext: {
          account: {
            address: executions[0].target,
            id: 19,
            type: 'SmartAccount',
          },
          chainId: 57057,
          rpcUrl: 'rpc-a',
          slip44: 57,
        } as any,
      })
    ).rejects.toThrow();
    expect(emitter).not.toHaveBeenCalled();
  });
});
