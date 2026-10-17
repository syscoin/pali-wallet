import { controllerEmitter } from './controllerEmitter';

describe('controller submission timeout', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not cancel or retry the background send after its local timer expires', async () => {
    jest.useFakeTimers();
    (chrome.runtime as any).id = 'pali';
    let complete!: (response: unknown) => void;
    const send = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
      _message: unknown,
      callback: (response: unknown) => void
    ) => {
      complete = callback;
    }) as any);
    const pending = controllerEmitter(
      ['wallet', 'sendAndSaveEthTransaction'],
      [{}]
    );
    const rejected = expect(pending).rejects.toThrow(
      'Network request timed out'
    );
    await jest.advanceTimersByTimeAsync(10_000);
    await rejected;
    complete({ hash: `0x${'ab'.repeat(32)}` });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toThrow('Network request timed out');
  });

  it.each([
    { success: false, error: '' },
    { success: false, error: null },
    { success: false, error: false },
    { success: false, error: undefined },
  ])(
    'rejects an explicit failure even when no usable error message was serialized: %p',
    async (response) => {
      (chrome.runtime as any).id = 'pali';
      const send = jest
        .spyOn(chrome.runtime, 'sendMessage')
        .mockImplementation(((
          _message: unknown,
          callback: (value: unknown) => void
        ) => callback(response)) as any);
      await expect(
        controllerEmitter(['wallet', 'getSentrySettings'])
      ).rejects.toThrow('Wallet operation failed');
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    { success: false },
    {
      hash: `0x${'ab'.repeat(32)}`,
      success: false,
      status: 'failed',
      // Match the provider transaction schema without renaming its field.
      // eslint-disable-next-line camelcase
      txreceipt_status: '0',
      gasUsed: '21000',
      logs: [],
      revertReason: null,
    },
  ])(
    'preserves unsuccessful domain results without an error envelope: %p',
    async (response) => {
      (chrome.runtime as any).id = 'pali';
      const send = jest
        .spyOn(chrome.runtime, 'sendMessage')
        .mockImplementation(((
          _message: unknown,
          callback: (value: unknown) => void
        ) => callback(response)) as any);
      await expect(
        controllerEmitter(
          ['wallet', 'getEvmTransactionFromProvider'],
          [`0x${'ab'.repeat(32)}`]
        )
      ).resolves.toBe(response);
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it('still rejects an unknown-method transport response', async () => {
    (chrome.runtime as any).id = 'pali';
    const send = jest
      .spyOn(chrome.runtime, 'sendMessage')
      .mockImplementation(((
        _message: unknown,
        callback: (value: unknown) => void
      ) => callback({ success: false, error: 'Method not found' })) as any);
    await expect(
      controllerEmitter(['wallet', 'getSentrySettings'])
    ).rejects.toThrow('Method not found');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('preserves successful void responses and structured transaction errors', async () => {
    (chrome.runtime as any).id = 'pali';
    const error = { error: true, code: 'INSUFFICIENT_FUNDS', remainingFee: 1 };
    jest
      .spyOn(chrome.runtime, 'sendMessage')
      .mockImplementationOnce(((
        _message: unknown,
        callback: (value: unknown) => void
      ) => callback(undefined)) as any)
      .mockImplementationOnce(((
        _message: unknown,
        callback: (value: unknown) => void
      ) => callback(error)) as any);
    await expect(
      controllerEmitter(['wallet', 'getSentrySettings'])
    ).resolves.toBeUndefined();
    await expect(
      controllerEmitter(['wallet', 'getSentrySettings'])
    ).rejects.toEqual(error);
  });
});
