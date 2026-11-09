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

describe('Smart account document-owned controller calls', () => {
  function portFixture() {
    const received = new Set<(value: unknown) => void>();
    const disconnected = new Set<() => void>();
    const port = {
      onMessage: {
        addListener: (listener: (value: unknown) => void) =>
          received.add(listener),
        removeListener: (listener: (value: unknown) => void) =>
          received.delete(listener),
      },
      onDisconnect: {
        addListener: (listener: () => void) => disconnected.add(listener),
        removeListener: (listener: () => void) => disconnected.delete(listener),
      },
      postMessage: jest.fn(),
      disconnect: jest.fn(() => {
        for (const listener of [...disconnected]) listener();
      }),
    };
    const connect = jest.fn(() => port);
    (chrome.runtime as any).connect = connect;
    (chrome.runtime as any).id = 'pali';
    return {
      port,
      connect,
      receive(value: unknown) {
        for (const listener of [...received]) listener(value);
      },
      retire() {
        for (const listener of [...disconnected]) listener();
      },
      received,
      disconnected,
    };
  }
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it.each([
    'signSmartAccountPreparedOwner',
    'registerSmartAccountOnChain',
    'submitSmartAccountExecution',
  ] as const)(
    'uses one actual browser Port without one-shot fallback for %s',
    async (method) => {
      const fixture = portFixture();
      const pending = controllerEmitter(['wallet', method], ['opaque-context']);
      expect(fixture.connect).toHaveBeenCalledWith({
        name: 'pali-smart-account-controller',
      });
      expect(fixture.port.postMessage).toHaveBeenCalledWith({
        type: 'CONTROLLER_ACTION',
        data: { methods: ['wallet', method], params: ['opaque-context'] },
      });
      fixture.receive({ hash: 'completed' });
      await expect(pending).resolves.toEqual({ hash: 'completed' });
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(fixture.port.disconnect).toHaveBeenCalledTimes(1);
      expect(fixture.received.size).toBe(0);
      expect(fixture.disconnected.size).toBe(0);
    }
  );
  it('retires the Port on timeout without retrying a signing operation', async () => {
    jest.useFakeTimers();
    const fixture = portFixture();
    const pending = controllerEmitter(
      ['wallet', 'signSmartAccountPreparedOwner'],
      [],
      100
    );
    const rejected = expect(pending).rejects.toThrow(
      'Network request timed out'
    );
    await jest.advanceTimersByTimeAsync(100);
    await rejected;
    fixture.receive('late-proof');
    await jest.advanceTimersByTimeAsync(10_000);
    expect(fixture.connect).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(fixture.port.disconnect).toHaveBeenCalledTimes(1);
  });
  it('does not retry or fall back after the actual document disconnects', async () => {
    const fixture = portFixture();
    const pending = controllerEmitter(
      ['wallet', 'submitSmartAccountExecution'],
      []
    );
    fixture.retire();
    await expect(pending).rejects.toThrow('document disconnected');
    expect(fixture.connect).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it('cleans up and returns the existing structured financial error unchanged', async () => {
    const fixture = portFixture();
    const pending = controllerEmitter(
      ['wallet', 'submitSmartAccountExecution'],
      []
    );
    const error = {
      error: true,
      code: 'PALI_TRANSACTION_UNKNOWN',
      transactionNotBroadcast: false,
    };
    fixture.receive(error);
    await expect(pending).rejects.toBe(error);
    expect(fixture.port.disconnect).toHaveBeenCalledTimes(1);
  });
});
