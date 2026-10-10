import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import { handleUpdateTransaction, UpdateTxAction } from './transactions';

jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: { isBitcoinBased: false } }) },
}));

const ORIGINAL = `0x${'11'.repeat(32)}`;
const REPLACEMENT = `0x${'22'.repeat(32)}`;
const cases = [
  {
    action: UpdateTxAction.Cancel,
    flag: 'isCanceled',
    send: ['wallet', 'cancelEvmTransaction'],
    setter: ['wallet', 'setEvmTransactionCancelSubmitted'],
    success: 'transactions.transactionCancelSubmitted',
    failure: 'transactions.transactionCancelFailed',
  },
  {
    action: UpdateTxAction.SpeedUp,
    flag: 'isSpeedUp',
    send: ['wallet', 'ethereumTransaction', 'sendTransactionWithEditedFee'],
    setter: ['wallet', 'setEvmTransactionAsAccelerated'],
    success: 'transactions.transactionAcceleratedSuccessfully',
    failure: 'transactions.transactionSpeedUpFailed',
  },
];

describe.each(cases)('$action submission metadata handoff', (testCase) => {
  let alert: { error: jest.Mock; success: jest.Mock; warning: jest.Mock };
  let t: jest.Mock;
  const submitted = (hash: any = REPLACEMENT) => ({
    [testCase.flag]: true,
    error: false,
    transaction: { hash },
  });
  const run = () =>
    handleUpdateTransaction({
      t,
      updateData: {
        txHash: ORIGINAL,
        chainId: 5700,
        isLegacy: false,
        updateType: testCase.action,
        alert,
      },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    alert = { error: jest.fn(), success: jest.fn(), warning: jest.fn() };
    t = jest.fn((key: string, options?: { hash: string }) =>
      options ? `${key}: ${options.hash}` : key
    );
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['Storage failed', 'PALI_TRANSACTION_CONTEXT_CHANGED'])(
    'warns with the acknowledged hash on %s without sending another replacement',
    async (message) => {
      jest
        .mocked(controllerEmitter)
        .mockResolvedValueOnce(submitted())
        // No custom error fields: the UI uses the acknowledged response hash.
        .mockRejectedValueOnce(new Error(message));
      const result = await run();
      expect(alert.warning).toHaveBeenCalledWith(
        `transactions.replacementHistoryWarning: ${REPLACEMENT}`
      );
      expect(t).toHaveBeenCalledWith('transactions.replacementHistoryWarning', {
        hash: REPLACEMENT,
      });
      expect(alert.error).not.toHaveBeenCalled();
      expect(alert.success).not.toHaveBeenCalled();
      expect(result).toBe(REPLACEMENT);
      expect(
        jest.mocked(controllerEmitter).mock.calls.map(([route]) => route)
      ).toEqual([testCase.send, testCase.setter]);
    }
  );

  it('waits for the metadata outcome before presenting the warning', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_resolve, fail) => (reject = fail));
    jest
      .mocked(controllerEmitter)
      .mockResolvedValueOnce(submitted())
      .mockReturnValueOnce(pending);
    const saving = run();
    await Promise.resolve();
    await Promise.resolve();
    expect(alert.warning).not.toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
    reject(new Error('Storage failed'));
    await expect(saving).resolves.toBe(REPLACEMENT);
    expect(alert.warning).toHaveBeenCalledTimes(1);
  });

  it('retains the existing error for a real send failure and never invokes the metadata setter', async () => {
    jest
      .mocked(controllerEmitter)
      .mockRejectedValueOnce(new Error('Send failed'));
    await run();
    expect(alert.error).toHaveBeenCalledWith(testCase.failure);
    expect(alert.warning).not.toHaveBeenCalled();
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
    expect(controllerEmitter).toHaveBeenCalledWith(
      testCase.send,
      expect.any(Array)
    );
  });

  it.each([null, '', 'invalid-hash'])(
    'does not acknowledge missing or invalid returned hash %j',
    async (hash) => {
      jest
        .mocked(controllerEmitter)
        .mockResolvedValueOnce(submitted(hash))
        .mockRejectedValueOnce(
          Object.assign(new Error('Save failed'), {
            transactionHash: REPLACEMENT,
            transactionNotBroadcast: false,
          })
        );
      expect(await run()).toBeUndefined();
      expect(alert.error).toHaveBeenCalledWith(testCase.failure);
      expect(alert.warning).not.toHaveBeenCalled();
      expect(alert.success).not.toHaveBeenCalled();
      expect(controllerEmitter).toHaveBeenCalledTimes(2);
    }
  );

  it('does not acknowledge a response without a transaction object', async () => {
    jest
      .mocked(controllerEmitter)
      .mockResolvedValueOnce({ [testCase.flag]: true, error: false })
      .mockRejectedValueOnce(new Error('Response missing transaction'));
    expect(await run()).toBeUndefined();
    expect(alert.error).toHaveBeenCalledWith(testCase.failure);
    expect(alert.warning).not.toHaveBeenCalled();
  });

  it('does not turn an error-marked send response into an acknowledgement', async () => {
    jest
      .mocked(controllerEmitter)
      .mockResolvedValueOnce({ ...submitted(), error: true })
      .mockRejectedValueOnce(new Error('Metadata failed'));
    expect(await run()).toBeUndefined();
    expect(alert.error).toHaveBeenCalledWith(testCase.failure);
    expect(alert.warning).not.toHaveBeenCalled();
  });

  it('retains success after the metadata setter completes without another send', async () => {
    jest
      .mocked(controllerEmitter)
      .mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce({ hash: REPLACEMENT });
    await run();
    expect(alert.success).toHaveBeenCalledWith(testCase.success);
    expect(alert.warning).not.toHaveBeenCalled();
    expect(alert.error).not.toHaveBeenCalled();
    expect(controllerEmitter).toHaveBeenCalledTimes(2);
  });
});
