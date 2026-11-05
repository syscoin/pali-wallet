import { isValidMethod } from '../controllers/message-handler/method-registry';

import { watchApprovalSubmission } from './approvalSubmission';
import { handleMasterControllerResponses } from './handleMasterControllerResponses';

describe('restored-note review authority', () => {
  it.each([
    ['https://example.com', 'pali-extension', false],
    ['chrome-extension://other/app.html', 'other', false],
    ['chrome-extension://pali-extension/app.html', 'pali-extension', true],
  ])(
    'admits %s only as a trusted extension action',
    async (url, id, allowed) => {
      Object.assign(chrome.runtime, {
        getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
        id: 'pali-extension',
      });
      const reviewRestoredNote = jest.fn(async () => undefined);
      const sendResponse = jest.fn();
      const logging = jest.spyOn(console, 'error').mockImplementation();
      try {
        handleMasterControllerResponses({
          privateVault: { reviewRestoredNote },
        } as any);
        const add = chrome.runtime.onMessage.addListener as jest.Mock;
        const listener = add.mock.calls[add.mock.calls.length - 1][0];
        const result = listener(
          {
            type: 'CONTROLLER_ACTION',
            data: {
              methods: ['privateVault', 'reviewRestoredNote'],
              params: ['note', 'synthetic-password'],
            },
          },
          { id, url },
          sendResponse
        );
        expect(result).toBe(allowed);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(reviewRestoredNote).toHaveBeenCalledTimes(allowed ? 1 : 0);
        if (allowed)
          expect(reviewRestoredNote).toHaveBeenCalledWith(
            'note',
            'synthetic-password'
          );
        else
          expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Controller actions are not available from connected sites',
          });
        expect(isValidMethod('reviewRestoredNote')).toBe(false);
        expect(isValidMethod('privateVault.reviewRestoredNote')).toBe(false);
      } finally {
        logging.mockRestore();
      }
    }
  );
});

describe('native approval controller submission lifecycle', () => {
  it.each([true, false, undefined])(
    'clears possible submission only for an actual controller transactionNotBroadcast=%s result',
    async (transactionNotBroadcast) => {
      Object.assign(chrome.runtime, {
        getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
        id: 'pali-extension',
      });
      const send = jest
        .fn()
        .mockRejectedValue(
          Object.assign(Error('submission failed'), { transactionNotBroadcast })
        );
      handleMasterControllerResponses({
        wallet: { sendAndSaveEthTransaction: send },
      } as any);
      const add = chrome.runtime.onMessage.addListener as jest.Mock;
      const listener = add.mock.calls[add.mock.calls.length - 1][0];
      const possible = jest.fn();
      const stop = watchApprovalSubmission(
        'native-approval-document',
        possible
      );
      const logging = jest.spyOn(console, 'error').mockImplementation();
      try {
        listener(
          {
            type: 'CONTROLLER_ACTION',
            data: {
              methods: ['wallet', 'sendAndSaveEthTransaction'],
              params: [{}],
            },
          },
          {
            id: 'pali-extension',
            documentId: 'native-approval-document',
            url: 'chrome-extension://pali-extension/external/tx/send/ethTx',
          },
          jest.fn()
        );
        expect(possible).toHaveBeenCalledWith(true);
        expect(send).not.toHaveBeenCalled();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(send).toHaveBeenCalledTimes(1);
        expect(possible.mock.calls.map(([value]) => value)).toEqual(
          transactionNotBroadcast === true ? [true, false] : [true]
        );
      } finally {
        stop();
        logging.mockRestore();
      }
    }
  );
});

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

  it('preserves typed hardware cancellation through the controller response', async () => {
    await rejectControllerAction(
      Object.assign(new Error('Ledger window was closed'), {
        code: 'HARDWARE_REQUEST_CANCELLED',
      })
    );
    expect(sendResponse).toHaveBeenCalledWith({
      error: {
        message: 'Ledger window was closed',
        code: 'HARDWARE_REQUEST_CANCELLED',
      },
      success: false,
    });
  });
});

describe('controller actions during wallet setup', () => {
  const addListener = chrome.runtime.onMessage.addListener as jest.Mock;
  const sender = {
    id: 'pali-extension',
    url: 'chrome-extension://pali-extension/app.html',
  };
  let status: 'busy' | 'recovery-required' | undefined;
  let calls: Record<string, jest.Mock>;
  let sdkGetter: jest.Mock;
  let sendResponse: jest.Mock;
  let listener: any;
  let logging: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(chrome.runtime, {
      getURL: jest.fn(
        (path = '') => `chrome-extension://pali-extension/${path}`
      ),
      id: 'pali-extension',
    });
    status = undefined;
    logging = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    calls = Object.fromEntries(
      [
        'signSyscoinPsbt',
        'signPSBT',
        'ethSendTransaction',
        'ethSign',
        'rawProviderSend',
        'sendSignedErc20Transaction',
        'signAction',
        'getActiveKeyring',
        'lock',
        'createWallet',
        'recoverWalletFromSeed',
        'beginLockedWalletReset',
        'resetLockedWallet',
        'isSeedValid',
        'isUnlocked',
        'getBalance',
      ].map((name) => [name, jest.fn().mockResolvedValue(`${name} result`)])
    );
    const sdk = {
      signPSBT: calls.signPSBT,
      ethSendTransaction: calls.ethSendTransaction,
      ethSign: calls.ethSign,
      getBalance: calls.getBalance,
      sendSignedErc20Transaction: calls.sendSignedErc20Transaction,
      web3Provider: { send: calls.rawProviderSend },
    };
    sdkGetter = jest.fn(() => sdk);
    const wallet = {
      ...calls,
      getWalletSetupStatus: () => status,
    };
    Object.defineProperties(wallet, {
      syscoinTransaction: { get: sdkGetter },
      ethereumTransaction: { get: sdkGetter },
    });
    handleMasterControllerResponses({
      wallet,
      smartAccount: { signAction: calls.signAction },
    } as any);
    listener = addListener.mock.calls[0][0];
    sendResponse = jest.fn();
  });

  afterEach(() => logging.mockRestore());

  const invoke = (methods: string[], params: unknown[] = []) =>
    listener(
      {
        type: 'CONTROLLER_ACTION',
        data: { methods, params },
      },
      sender,
      sendResponse
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it.each(['busy', 'recovery-required'] as const)(
    'rejects signing and raw/nested aliases before member traversal while %s',
    async (setupStatus) => {
      status = setupStatus;
      for (const methods of [
        ['wallet', 'signSyscoinPsbt'],
        ['wallet', 'syscoinTransaction', 'signPSBT'],
        ['wallet', 'ethereumTransaction', 'ethSendTransaction'],
        ['wallet', 'getActiveKeyring'],
        ['wallet', 'isUnlocked', 'constructor'],
        ['smartAccount', 'signAction'],
        ['wallet', 'beginLockedWalletReset'],
        ['wallet', 'resetLockedWallet'],
      ]) {
        expect(invoke(methods)).toBe(false);
      }
      await settle();
      expect(sdkGetter).not.toHaveBeenCalled();
      for (const call of Object.values(calls))
        expect(call).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledTimes(8);
      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Wallet setup is in progress. Signing is unavailable.',
        success: false,
      });
    }
  );

  it('refuses raw wallet SDK submission paths before resolving their getters', () => {
    const routes = [
      ['wallet', 'getActiveKeyring'],
      ['wallet', 'syscoinTransaction', 'signPSBT'],
      ['wallet', 'ethereumTransaction', 'ethSendTransaction'],
      ['wallet', 'ethereumTransaction', 'sendSignedErc20Transaction'],
      ['wallet', 'ethereumTransaction', 'sendFormattedTransaction'],
      ['wallet', 'ethereumTransaction', 'web3Provider', 'broadcastTransaction'],
    ];
    for (const route of routes) expect(invoke(route)).toBe(false);
    expect(
      invoke(
        ['wallet', 'ethereumTransaction', 'web3Provider', 'send'],
        ['eth_sendRawTransaction', ['0x1234']]
      )
    ).toBe(false);
    expect(sdkGetter).not.toHaveBeenCalled();
    expect(calls.getActiveKeyring).not.toHaveBeenCalled();
    expect(calls.rawProviderSend).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      error: 'Use the approved wallet operation',
      success: false,
    });
  });

  it.each(['eth_call', 'eth_estimateGas', 'eth_getBlockByNumber'])(
    'preserves the explicit provider read for wallet transaction review: %s',
    async (method) => {
      expect(
        invoke(
          ['wallet', 'ethereumTransaction', 'web3Provider', 'send'],
          [method, []]
        )
      ).toBe(true);
      await settle();
      expect(calls.rawProviderSend).toHaveBeenCalledWith(method, []);
    }
  );

  it('rechecks admission before invoking a previously resolved SDK signing method', async () => {
    expect(invoke(['wallet', 'ethereumTransaction', 'ethSign'])).toBe(true);
    expect(sdkGetter).toHaveBeenCalledTimes(1);
    status = 'busy';
    await settle();
    expect(calls.ethSign).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      error: 'Wallet setup is in progress. Signing is unavailable.',
      success: false,
    });
  });

  it.each(['busy', 'recovery-required'] as const)(
    'preserves exact onboarding/status/lock calls while %s',
    async (setupStatus) => {
      status = setupStatus;
      for (const name of [
        'lock',
        'createWallet',
        'recoverWalletFromSeed',
        'isSeedValid',
        'isUnlocked',
      ]) {
        expect(invoke(['wallet', name])).toBe(true);
      }
      await settle();
      for (const name of [
        'lock',
        'createWallet',
        'recoverWalletFromSeed',
        'isSeedValid',
        'isUnlocked',
      ]) {
        expect(calls[name]).toHaveBeenCalledTimes(1);
      }
      expect(sendResponse).toHaveBeenCalledTimes(5);
    }
  );

  it('preserves normal SDK read access after setup completes', async () => {
    status = undefined;
    expect(invoke(['wallet', 'ethereumTransaction', 'getBalance'])).toBe(true);
    await settle();
    expect(calls.getBalance).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith('getBalance result');
  });
});
