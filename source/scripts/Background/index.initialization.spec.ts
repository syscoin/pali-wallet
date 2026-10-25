type BackgroundModule = typeof import('./index');
type MessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];

const trustedSender = {
  id: 'pali-extension',
  url: 'chrome-extension://pali-extension/app.html',
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

// Initialization and controller responses each cross several promise boundaries.
const flushPromises = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

describe('background initialization ownership', () => {
  let background: BackgroundModule;
  let initializeController: jest.Mock;
  let restrictStorage: jest.Mock;
  let registerListeners: jest.Mock;
  let startPolling: jest.Mock;
  let controller: any;
  let state: any;
  let store: { getState: jest.Mock; subscribe: jest.Mock };
  let subscribers: Set<() => void>;
  let messageListeners: Set<MessageListener>;
  let privacyRegistrations: string[];
  let startPrivacyOperation: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    controller = {
      getInitializationStatus: () => ({
        isReady: true,
        attempts: 0,
        maxAttempts: 3,
      }),
      retryInitialization: jest.fn().mockResolvedValue({ retrying: false }),
      wallet: {
        getWalletSetupStatus: () => undefined,
        isUnlocked: () => false,
        lock: jest.fn().mockResolvedValue('locked'),
      },
    };
    initializeController = jest
      .fn()
      .mockRejectedValue(new Error('Controller construction failed'));
    restrictStorage = jest.fn().mockResolvedValue(undefined);
    registerListeners = jest.fn();
    startPolling = jest.fn();
    state = {
      dapp: {},
      price: {},
      spamFilter: {},
      vault: {
        accounts: {},
        activeAccount: {},
        activeNetwork: {
          chainId: 570,
          kind: 'ethereum',
          slip44: 60,
          url: 'https://rpc.example',
        },
      },
      vaultGlobal: { activeSlip44: 60, networkStatus: 'idle' },
    };
    subscribers = new Set();
    store = {
      getState: jest.fn(() => state),
      subscribe: jest.fn((subscriber: () => void) => {
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
      }),
    };
    messageListeners = new Set();
    privacyRegistrations = [];
    startPrivacyOperation = jest.fn();
    // These factories model evaluation/registration, not operation startup.
    jest.doMock('./controllers/privacyTransactions', () => {
      privacyRegistrations.push('transactions');
      return { createPrivacyTransactionsController: startPrivacyOperation };
    });
    jest.doMock('./controllers/privacyWithdrawals', () => {
      privacyRegistrations.push('withdrawals');
      return { createPrivacyWithdrawalsController: startPrivacyOperation };
    });
    jest.doMock('utils/privacy/relayers', () => {
      privacyRegistrations.push('relayers');
      return { createPrivacyRelayerClient: startPrivacyOperation };
    });
    jest.doMock('utils/privacy/withdrawal', () => {
      privacyRegistrations.push('withdrawal-builder');
      return { provePrivacyWithdrawal: startPrivacyOperation };
    });
    jest.doMock('utils/privacy/prover', () => {
      privacyRegistrations.push('prover');
      return { runPrivacyProof: startPrivacyOperation };
    });
    Object.assign(chrome.runtime, {
      getURL: jest.fn(
        (path = '') => `chrome-extension://pali-extension/${path}`
      ),
      id: trustedSender.id,
    });
    (chrome.runtime.onMessage.addListener as jest.Mock).mockImplementation(
      (listener: MessageListener) => messageListeners.add(listener)
    );
    (chrome.runtime.onMessage.removeListener as jest.Mock).mockImplementation(
      (listener: MessageListener) => messageListeners.delete(listener)
    );

    // Keep the startup coordinator, message authorization and state observer real.
    // Disk construction and unrelated scheduling are controlled by each test.
    jest.doMock('./handlers/handleMasterControllerInstance', () => ({
      handleMasterControllerInstance: initializeController,
    }));
    jest.doMock('./utils/restrictStorageAccess', () => ({
      restrictStorageAccess: restrictStorage,
    }));
    jest.doMock('./handlers/handleListeners', () => ({
      handleListeners: registerListeners,
    }));
    jest.doMock('./handlers/handleStartPolling', () => ({
      handleStartPolling: startPolling,
    }));
    jest.doMock('./handlers/handleFiatPrice', () => ({
      handleFiatPrice: jest.fn(),
    }));
    jest.doMock('./handlers/handleOffscreenPreload', () => ({
      initializeOffscreenPreload: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('./controllers/spamFilterCleanup', () => ({
      startSpamFilterCleanup: jest.fn(),
    }));
    jest.doMock('./controllers/walletRecovery', () => ({}));
    jest.doMock('./notification-manager', () => ({ notificationManager: {} }));
    jest.doMock('state/store', () => ({ __esModule: true, default: store }));
    jest.doMock('utils/index', () => ({
      extractErrorMessage: (error: Error, fallback: string) =>
        error?.message || fallback,
    }));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const loadBackground = async () => {
    background = require('./index');
    await flushPromises();
  };

  const getControllerListener = () => Array.from(messageListeners).at(-1)!;

  const request = (
    methods: string[],
    listener = getControllerListener(),
    sender: chrome.runtime.MessageSender = trustedSender
  ) => {
    const sendResponse = jest.fn();
    const accepted = listener(
      { type: 'CONTROLLER_ACTION', data: { methods, params: [] } },
      sender,
      sendResponse
    );
    return { accepted, sendResponse };
  };

  const expectStatus = (attempts: number, isReady = false) => {
    expect(background.getInitializationStatus()).toEqual({
      attempts,
      isReady,
      maxAttempts: 3,
    });
    expect(background.getIsReady()).toBe(isReady);
  };

  const enterDegradedMode = async () => {
    await loadBackground();
    expectStatus(1);
    await jest.advanceTimersByTimeAsync(2000);
    expectStatus(2);
    await jest.advanceTimersByTimeAsync(2000);
    expectStatus(3);
    const status = request(['getInitializationStatus']);
    await flushPromises();
    expect(status.accepted).toBe(true);
    expect(status.sendResponse).toHaveBeenCalledWith({
      attempts: 3,
      isReady: false,
      maxAttempts: 3,
    });
  };

  it('registers optional privacy chunks during startup without beginning an operation or waiting for wallet setup', async () => {
    const construction = deferred<any>();
    initializeController.mockReturnValue(construction.promise);
    await loadBackground();
    expect(privacyRegistrations).toEqual([
      'transactions',
      'withdrawals',
      'relayers',
      'withdrawal-builder',
      'prover',
    ]);
    expect(startPrivacyOperation).not.toHaveBeenCalled();
    expect(initializeController).toHaveBeenCalledTimes(1);
    expectStatus(0);
  });

  it('shares overlapping trusted retries across storage and controller awaits', async () => {
    await enterDegradedMode();
    const staleListener = getControllerListener();
    const untrusted = request(['retryInitialization'], staleListener, {
      id: trustedSender.id,
      url: 'https://connected-site.example',
    });
    expect(untrusted.accepted).toBe(false);
    expect(untrusted.sendResponse).toHaveBeenCalledWith({
      error: 'Controller actions are not available from connected sites',
      success: false,
    });
    expectStatus(3);
    expect(initializeController).toHaveBeenCalledTimes(3);

    const storage = deferred<void>();
    const construction = deferred<any>();
    restrictStorage.mockReturnValue(storage.promise);
    initializeController.mockReturnValue(construction.promise);
    const first = request(['retryInitialization']);
    const second = request(['retryInitialization']);
    await flushPromises();
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(first.sendResponse).not.toHaveBeenCalled();
    expect(second.sendResponse).not.toHaveBeenCalled();
    expect(restrictStorage).toHaveBeenCalledTimes(4);
    expect(initializeController).toHaveBeenCalledTimes(3);
    expectStatus(0);

    storage.resolve(undefined);
    await flushPromises();
    const third = request(['retryInitialization']);
    await flushPromises();
    expect(initializeController).toHaveBeenCalledTimes(4);
    expect(restrictStorage).toHaveBeenCalledTimes(4);
    construction.resolve(controller);
    await flushPromises();

    for (const action of [first, second, third]) {
      expect(action.sendResponse).toHaveBeenCalledTimes(1);
      expect(action.sendResponse).toHaveBeenCalledWith({ retrying: true });
    }
    expectStatus(0, true);
    expect(background.getController()).toBe(controller);
    expect(store.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each(['during', 'after'])(
    'cancels a queued automatic retry %s successful manual recovery',
    async (timerTiming) => {
      await enterDegradedMode();
      const construction = deferred<any>();
      initializeController
        .mockRejectedValueOnce(new Error('Temporary disk read failure'))
        .mockReturnValue(construction.promise);
      const failedRetry = request(['retryInitialization']);
      await flushPromises();
      expect(failedRetry.sendResponse).toHaveBeenCalledWith({ retrying: true });
      expectStatus(1);
      expect(initializeController).toHaveBeenCalledTimes(4);

      const recovery = request(['retryInitialization']);
      await flushPromises();
      expect(initializeController).toHaveBeenCalledTimes(5);
      if (timerTiming === 'during') {
        await jest.advanceTimersByTimeAsync(2000);
        expect(initializeController).toHaveBeenCalledTimes(5);
        expect(recovery.sendResponse).not.toHaveBeenCalled();
      }
      construction.resolve(controller);
      await flushPromises();
      expectStatus(0, true);
      await jest.advanceTimersByTimeAsync(4000);

      expect(initializeController).toHaveBeenCalledTimes(5);
      expect(restrictStorage).toHaveBeenCalledTimes(5);
      expect(store.subscribe).toHaveBeenCalledTimes(1);
      expect(recovery.sendResponse).toHaveBeenCalledWith({ retrying: true });
      expectStatus(0, true);
    }
  );

  it.each(['storage', 'constructor'])(
    'allows recovery after a failed %s without retaining a rejected attempt',
    async (failureStage) => {
      if (failureStage === 'storage') {
        restrictStorage.mockRejectedValue(new Error('Storage unavailable'));
      }
      await enterDegradedMode();
      expect(initializeController).toHaveBeenCalledTimes(
        failureStage === 'storage' ? 0 : 3
      );
      restrictStorage.mockResolvedValue(undefined);
      initializeController.mockResolvedValue(controller);

      const recovery = request(['retryInitialization']);
      await flushPromises();

      expect(recovery.sendResponse).toHaveBeenCalledWith({ retrying: true });
      expectStatus(0, true);
      expect(initializeController).toHaveBeenCalledTimes(
        failureStage === 'storage' ? 1 : 4
      );
      expect(restrictStorage).toHaveBeenCalledTimes(4);
      expect(background.getController()).toBe(controller);
    }
  );

  it('preserves live state and construction after recovery and a stale retry callback', async () => {
    await enterDegradedMode();
    // A controller response admitted before listener replacement may retain the
    // degraded retry function. Readiness must guard that function as well.
    const staleListener = getControllerListener();
    initializeController.mockResolvedValue(controller);
    const recovery = request(['retryInitialization']);
    await flushPromises();
    expect(recovery.sendResponse).toHaveBeenCalledWith({ retrying: true });

    state = { ...state, price: { fiat: { asset: 'usd', price: 456 } } };
    const liveState = state;
    for (const subscriber of subscribers) subscriber();
    await jest.advanceTimersByTimeAsync(50);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'CONTROLLER_STATE_CHANGE', data: liveState },
      expect.any(Function)
    );

    const lateRetry = request(['retryInitialization'], staleListener);
    const currentRetry = request(['retryInitialization']);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(4000);

    expect(lateRetry.sendResponse).toHaveBeenCalledWith({ retrying: true });
    expect(currentRetry.sendResponse).toHaveBeenCalledWith({ retrying: false });
    expect(initializeController).toHaveBeenCalledTimes(4);
    expect(restrictStorage).toHaveBeenCalledTimes(4);
    expect(store.subscribe).toHaveBeenCalledTimes(1);
    expect(state).toBe(liveState);
    expect(background.getController()).toBe(controller);
    expectStatus(0, true);
  });

  it('keeps a registration failure unready and reuses its constructed controller', async () => {
    initializeController.mockResolvedValue(controller);
    registerListeners.mockImplementation((instance) => {
      if (instance === controller)
        throw new Error('Listener registration failed');
    });
    await loadBackground();
    expectStatus(1);
    expect(() => background.getController()).toThrow(
      'Controller not yet initialized'
    );
    const walletAction = request(['wallet', 'lock']);
    expect(walletAction.sendResponse).toHaveBeenCalledWith({
      error: 'Method not found',
      success: false,
    });
    expect(controller.wallet.lock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2000);
    expectStatus(2);
    await jest.advanceTimersByTimeAsync(2000);
    expectStatus(3);
    expect(initializeController).toHaveBeenCalledTimes(1);
    expect(store.subscribe).not.toHaveBeenCalled();

    registerListeners.mockImplementation(() => undefined);
    const recovery = request(['retryInitialization']);
    await flushPromises();

    expect(recovery.sendResponse).toHaveBeenCalledWith({ retrying: true });
    expectStatus(0, true);
    expect(initializeController).toHaveBeenCalledTimes(1);
    expect(restrictStorage).toHaveBeenCalledTimes(4);
    expect(store.subscribe).toHaveBeenCalledTimes(1);
    expect(background.getController()).toBe(controller);
  });

  it('retains one state observer when later registration fails and retries', async () => {
    initializeController.mockResolvedValue(controller);
    startPolling.mockImplementation(() => {
      throw new Error('Polling registration failed');
    });
    await loadBackground();
    expectStatus(1);
    expect(store.subscribe).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expectStatus(2);
    await jest.advanceTimersByTimeAsync(2000);
    expectStatus(3);
    expect(store.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribers.size).toBe(1);
    expect(initializeController).toHaveBeenCalledTimes(1);

    startPolling.mockImplementation(() => undefined);
    const recovery = request(['retryInitialization']);
    await flushPromises();
    expect(recovery.sendResponse).toHaveBeenCalledWith({ retrying: true });
    expectStatus(0, true);
    expect(store.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribers.size).toBe(1);
    expect(initializeController).toHaveBeenCalledTimes(1);

    (chrome.runtime.sendMessage as jest.Mock).mockClear();
    state = { ...state, dapp: { connected: true } };
    for (const subscriber of subscribers) subscriber();
    await jest.advanceTimersByTimeAsync(50);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'CONTROLLER_DAPP_STATE_CHANGE', data: state.dapp },
      expect.any(Function)
    );
  });
});
