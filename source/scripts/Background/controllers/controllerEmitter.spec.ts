import {
  SMART_ACCOUNT_FEE_APPROVAL,
  SMART_ACCOUNT_FEE_REVIEW,
} from '../../../shared/smartAccountControllerAuthority';

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
  const fee = (id = 'fee-1') => ({
    id,
    maximumFeeUnits: '42000',
    maximumTotalUnits: '42000',
    validForMs: 90_000,
    transaction: {
      chainId: '57',
      from: '0x' + '11'.repeat(20),
      to: '0x' + '22'.repeat(20),
      value: '0',
      data: '0x',
      nonce: '0',
      gasLimit: '21000',
      type: 0 as const,
      gasPrice: '2',
    },
  });
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
  it('waits for explicit fee consent on the same Port before acknowledging an envelope', async () => {
    const fixture = portFixture();
    let approve!: (id: string | null) => void;
    const confirmFee = jest.fn((review: unknown, signal: AbortSignal) => {
      void review;
      void signal;
      return new Promise<string | null>((resolve) => (approve = resolve));
    });
    const pending = controllerEmitter(
      ['wallet', 'submitSmartAccountExecution'],
      [{}],
      10000,
      false,
      { confirmFee }
    );
    fixture.receive({ type: SMART_ACCOUNT_FEE_REVIEW, review: fee() });
    await Promise.resolve();
    expect(confirmFee).toHaveBeenCalledWith(fee(), expect.any(AbortSignal));
    expect(fixture.port.postMessage).toHaveBeenCalledTimes(1);
    approve('fee-1');
    await new Promise(setImmediate);
    expect(fixture.port.postMessage).toHaveBeenLastCalledWith({
      type: SMART_ACCOUNT_FEE_APPROVAL,
      id: 'fee-1',
      approved: true,
    });
    fixture.receive({ hash: 'accepted' });
    await expect(pending).resolves.toEqual({ hash: 'accepted' });
    expect(confirmFee.mock.calls[0][1].aborted).toBe(true);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it('sends a decline rather than silently approving a cancelled fee dialog', async () => {
    const fixture = portFixture();
    const pending = controllerEmitter(
      ['wallet', 'submitSmartAccountExecution'],
      [{}],
      10000,
      false,
      { confirmFee: async () => null }
    );
    fixture.receive({ type: SMART_ACCOUNT_FEE_REVIEW, review: fee() });
    await new Promise(setImmediate);
    expect(fixture.port.postMessage).toHaveBeenLastCalledWith({
      type: SMART_ACCOUNT_FEE_APPROVAL,
      id: 'fee-1',
      approved: false,
    });
    fixture.receive({ success: false, error: 'Cancelled' });
    await expect(pending).rejects.toThrow('Cancelled');
  });
  it('aborts a pending dialog on document retirement and never emits its late approval', async () => {
    const fixture = portFixture();
    let approve!: (id: string | null) => void;
    let signal!: AbortSignal;
    const pending = controllerEmitter(
      ['wallet', 'submitSmartAccountExecution'],
      [{}],
      10000,
      false,
      {
        confirmFee: (_review, ownedSignal) => {
          signal = ownedSignal;
          return new Promise((resolve) => (approve = resolve));
        },
      }
    );
    const rejected = expect(pending).rejects.toThrow('document disconnected');
    fixture.receive({ type: SMART_ACCOUNT_FEE_REVIEW, review: fee() });
    await Promise.resolve();
    fixture.retire();
    await rejected;
    expect(signal.aborted).toBe(true);
    approve('fee-1');
    await new Promise(setImmediate);
    expect(fixture.port.postMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it.each(['missing', 'wrong-id'])(
    'rejects %s fee consent without retry or automatic approval',
    async (mode) => {
      const fixture = portFixture();
      const pending = controllerEmitter(
        ['wallet', 'submitSmartAccountExecution'],
        [{}],
        10000,
        false,
        mode === 'missing' ? undefined : { confirmFee: async () => 'other-fee' }
      );
      const rejected = expect(pending).rejects.toThrow(
        /fee review|fee approval/
      );
      fixture.receive({ type: SMART_ACCOUNT_FEE_REVIEW, review: fee() });
      await rejected;
      expect(fixture.port.postMessage).toHaveBeenCalledTimes(1);
      expect(fixture.port.disconnect).toHaveBeenCalledTimes(1);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );
  it.each([
    'signSmartAccountPreparedOwner',
    'approveSmartAccountExecutionFeeQuote',
    'signSmartAccountCompositeOwner',
    'verifySmartAccountCompositePossession',
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
