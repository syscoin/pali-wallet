import { handleMasterControllerResponses } from './handleMasterControllerResponses';

describe('controller action sender authorization', () => {
  const addListener = chrome.runtime.onMessage.addListener as jest.Mock;
  const lock = jest.fn().mockResolvedValue('locked');
  const sendResponse = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(chrome.runtime, {
      getURL: jest.fn(
        (path = '') => `chrome-extension://pali-extension/${path}`
      ),
      id: 'pali-extension',
    });

    handleMasterControllerResponses({ wallet: { lock } } as any);
  });

  const getListener = () => addListener.mock.calls[0][0];

  it('rejects controller actions relayed from a file page', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const result = getListener()(
      {
        data: { methods: ['wallet', 'lock'], params: [] },
        type: 'CONTROLLER_ACTION',
      },
      {
        id: 'pali-extension',
        tab: { id: 1 },
        url: 'file:///tmp/malicious.html',
      },
      sendResponse
    );

    expect(result).toBe(false);
    expect(lock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      error: 'Controller actions are not available from connected sites',
      success: false,
    });
    consoleError.mockRestore();
  });

  it('preserves controller actions from extension pages', async () => {
    const result = getListener()(
      {
        data: { methods: ['wallet', 'lock'], params: [] },
        type: 'CONTROLLER_ACTION',
      },
      {
        id: 'pali-extension',
        url: 'chrome-extension://pali-extension/app.html',
      },
      sendResponse
    );

    expect(result).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lock).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith('locked');
  });

  const rejectControllerAction = async (error: unknown) => {
    const logging = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    lock.mockRejectedValueOnce(error);
    const result = getListener()(
      {
        data: { methods: ['wallet', 'lock'], params: [] },
        type: 'CONTROLLER_ACTION',
      },
      {
        id: 'pali-extension',
        url: 'chrome-extension://pali-extension/app.html',
      },
      sendResponse
    );
    expect(result).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    logging.mockRestore();
    expect(sendResponse).toHaveBeenCalledTimes(1);
  };

  it.each([true, false])(
    'preserves the exact submission boolean %s alongside the normalized message',
    async (transactionNotBroadcast) => {
      await rejectControllerAction(
        Object.assign(new Error('execution reverted: AA21'), {
          arbitraryPrivateData: 'must not be forwarded',
          transactionNotBroadcast,
        })
      );

      expect(sendResponse).toHaveBeenCalledWith({
        error: {
          message: 'PALI_NATIVE_GAS_REQUIRED',
          transactionNotBroadcast,
        },
        success: false,
      });
    }
  );

  it('preserves an acknowledged hash and boolean together with normalized revert text', async () => {
    const transactionHash = `0x${'aB'.repeat(32)}`;
    await rejectControllerAction(
      Object.assign(new Error('execution reverted'), {
        arbitraryPrivateData: 'must not be forwarded',
        data: '0x201b632a',
        transactionHash,
        transactionNotBroadcast: false,
      })
    );

    expect(sendResponse).toHaveBeenCalledWith({
      error: {
        message: 'PALI_GUARDIAN_RECOVERY_NOT_READY',
        transactionHash,
        transactionNotBroadcast: false,
      },
      success: false,
    });
  });

  it('retains a valid hash while discarding an invalid submission boolean', async () => {
    const transactionHash = `0x${'12'.repeat(32)}`;
    await rejectControllerAction({
      message: 'Submission failed',
      transactionHash,
      transactionNotBroadcast: 'false',
    });

    expect(sendResponse).toHaveBeenCalledWith({
      error: { message: 'Submission failed', transactionHash },
      success: false,
    });
  });

  it('retains a valid submission boolean while discarding an invalid hash', async () => {
    await rejectControllerAction({
      message: 'Submission failed',
      transactionHash: `0x${'12'.repeat(31)}`,
      transactionNotBroadcast: true,
    });

    expect(sendResponse).toHaveBeenCalledWith({
      error: { message: 'Submission failed', transactionNotBroadcast: true },
      success: false,
    });
  });

  it.each([
    { transactionHash: 'invalid', transactionNotBroadcast: 'true' },
    { transactionHash: `0x${'12'.repeat(33)}`, transactionNotBroadcast: 1 },
    { transactionHash: `0x${'gg'.repeat(32)}`, transactionNotBroadcast: null },
    {
      transactionHash: { hash: `0x${'12'.repeat(32)}` },
      transactionNotBroadcast: {},
    },
  ])(
    'discards invalid submission metadata without changing the error shape: %j',
    async (fields) => {
      await rejectControllerAction({
        ...fields,
        arbitraryPrivateData: 'must not be forwarded',
        message: 'Submission failed',
      });

      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Submission failed',
        success: false,
      });
    }
  );

  it.each([
    [new Error('Ordinary failure'), 'Ordinary failure'],
    ['String failure', 'String failure'],
    [null, 'Unknown error'],
    [new Error('execution reverted: AA21'), 'PALI_NATIVE_GAS_REQUIRED'],
  ])(
    'preserves ordinary controller error responses: %j',
    async (error, message) => {
      await rejectControllerAction(error);

      expect(sendResponse).toHaveBeenCalledWith({
        error: message,
        success: false,
      });
    }
  );

  it('preserves existing structured syscoin errors without wrapping them', async () => {
    const error = { code: 123, error: true, message: 'Structured failure' };
    await rejectControllerAction(error);

    expect(sendResponse).toHaveBeenCalledWith(error);
  });
});
