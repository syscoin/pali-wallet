const originalTabs = chrome.tabs;
beforeEach(() => {
  // These admission tests use fake openers, so no browser tab is created.
  (chrome as any).tabs = {
    query: jest.fn((_query: unknown, callback: (tabs: any[]) => void) =>
      callback([])
    ),
  };
});
afterAll(() => {
  (chrome as any).tabs = originalTabs;
});

const mockGetState = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockGetState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));
jest.mock('./method-handlers', () => ({ clearProviderCache: jest.fn() }));

import { getMethodConfig } from './method-registry';
import {
  MAX_PENDING_REQUESTS,
  MAX_REQUESTS_PER_ORIGIN,
  NETWORK_READY_TIMEOUT_MS,
  RequestPipeline,
  networkStatusMiddleware,
  requestCoordinator,
} from './request-pipeline';

const context = (host: string, signal?: AbortSignal) =>
  ({
    methodConfig: {
      hasPopup: true,
      requiresAuth: true,
      requiresConnection: true,
    },
    originalRequest: { host, method: 'personal_sign', signal },
  } as any);

describe('provider request admission', () => {
  afterEach(() => jest.useRealTimers());

  it('rejects hostile signing work before admission or any middleware', async () => {
    const middleware = jest.fn();
    const pipeline = new RequestPipeline().use(middleware);
    const request = context('https://malicious.test');
    request.originalRequest.method = 'eth_signTypedData_v4';
    request.originalRequest.params = [
      '0x123',
      JSON.stringify({
        primaryType: 'A',
        types: {
          A: [
            { name: 'x', type: 'A' },
            { name: 'x', type: 'A' },
          ],
        },
        message: { x: {} },
      }),
    ];
    await expect(pipeline.execute(request)).rejects.toMatchObject({
      code: -32602,
    });
    expect(middleware).not.toHaveBeenCalled();
    expect(pipeline.getQueueLength()).toBe(0);
  });

  it('bounds each origin before its queued requests reach middleware', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline = new RequestPipeline().use(async () => {
      await blocked;
      return true;
    });
    const pending = Array.from({ length: MAX_REQUESTS_PER_ORIGIN }, () =>
      pipeline.execute(context('https://spam.test'))
    );
    await expect(
      pipeline.execute(context('https://spam.test'))
    ).rejects.toMatchObject({ code: -32005 });
    const other = pipeline.execute(context('https://other.test'));
    expect(pipeline.getQueueLength()).toBe(MAX_REQUESTS_PER_ORIGIN);
    release();
    await Promise.all([...pending, other]);
    await expect(pipeline.execute(context('https://spam.test'))).resolves.toBe(
      true
    );
  });

  it('bounds the global queue even when requests use different origins', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline = new RequestPipeline().use(async () => {
      await blocked;
      return true;
    });
    const pending = Array.from({ length: MAX_PENDING_REQUESTS }, (_, i) =>
      pipeline.execute(context(`https://${i}.test`))
    );
    await expect(
      pipeline.execute(context('https://overflow.test'))
    ).rejects.toMatchObject({ code: -32005 });
    release();
    await Promise.all(pending);
  });

  it('rejects a saturated origin before parsing another signing payload', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline = new RequestPipeline().use(async () => blocked);
    const pending = Array.from({ length: MAX_REQUESTS_PER_ORIGIN }, () =>
      pipeline.execute(context('https://spam.test'))
    );
    const extra = context('https://spam.test');
    extra.originalRequest.method = 'eth_signTypedData_v4';
    extra.originalRequest.params = ['0x123', '{malformed JSON'];
    // Parsing this would produce -32602; capacity rejection must happen first.
    await expect(pipeline.execute(extra)).rejects.toMatchObject({
      code: -32005,
    });
    release();
    await Promise.all(pending);
  });

  it('gives another origin a turn before draining one origin burst', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const pipeline = new RequestPipeline().use(async (request) => {
      order.push(request.originalRequest.host);
      if (order.length === 1) await blocked;
    });
    const first = pipeline.execute(context('https://spam.test'));
    const same = pipeline.execute(context('https://spam.test'));
    const other = pipeline.execute(context('https://other.test'));
    release();
    await Promise.all([first, same, other]);
    expect(order).toEqual([
      'https://spam.test',
      'https://other.test',
      'https://spam.test',
    ]);
  });

  it('removes cancelled queued requests without executing them', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = jest.fn(async () => {
      await blocked;
    });
    const pipeline = new RequestPipeline().use(execute);
    const first = pipeline.execute(context('https://first.test'));
    const abort = new AbortController();
    const cancelled = pipeline.execute(
      context('https://closed.test', abort.signal)
    );
    abort.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 4001 });
    expect(pipeline.getQueueLength()).toBe(0);
    release();
    await first;
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a stuck network wait and cleans its polling timer', async () => {
    jest.useFakeTimers();
    mockGetState.mockReturnValue({
      vaultGlobal: { networkStatus: 'switching' },
    });
    const next = jest.fn();
    const waiting = networkStatusMiddleware(context('https://site.test'), next);
    const rejected = expect(waiting).rejects.toMatchObject({ code: -32603 });
    await jest.advanceTimersByTimeAsync(NETWORK_READY_TIMEOUT_MS);
    await rejected;
    expect(next).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels a network wait immediately when its document closes', async () => {
    jest.useFakeTimers();
    mockGetState.mockReturnValue({
      vaultGlobal: { networkStatus: 'switching' },
    });
    const abort = new AbortController();
    const next = jest.fn();
    const waiting = networkStatusMiddleware(
      context('https://site.test', abort.signal),
      next
    );
    abort.abort();
    await expect(waiting).rejects.toMatchObject({ code: 4001 });
    expect(next).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

const recoveryMethods = [
  'wallet_addEthereumChain',
  'wallet_switchEthereumChain',
  'sys_switchChain',
  'eth_changeUTXOEVM',
  'sys_changeUTXOEVM',
];
const recoveryContext = (method: string, signal?: AbortSignal) => ({
  ...context('https://recovery.example', signal),
  methodConfig:
    getMethodConfig(method) ?? context('https://recovery.example').methodConfig,
  originalRequest: {
    ...context('https://recovery.example', signal).originalRequest,
    method,
    sender: { url: 'https://recovery.example/page', tab: { id: 8 } },
    params: [{ chainId: '0x1644' }],
  },
});

describe('network-control recovery admission', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each(recoveryMethods)(
    'allows %s to reach its existing handler from error only',
    async (method) => {
      mockGetState.mockReturnValue({
        vaultGlobal: { networkStatus: 'error', error: null },
      });
      const next = jest.fn().mockResolvedValue('handler');
      const waiting = networkStatusMiddleware(
        recoveryContext(method),
        next
      ).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await jest.advanceTimersByTimeAsync(0);
      const callsBeforeTimeout = next.mock.calls.length;
      await jest.advanceTimersByTimeAsync(NETWORK_READY_TIMEOUT_MS);
      const result = await waiting;
      expect(callsBeforeTimeout).toBe(1);
      expect(result).toEqual({ value: 'handler' });
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it.each(recoveryMethods)(
    'allows waiting %s once a connection attempt has settled as error',
    async (method) => {
      let status = 'connecting';
      mockGetState.mockImplementation(() => ({
        vaultGlobal: { networkStatus: status },
      }));
      const next = jest.fn().mockResolvedValue('handler');
      const waiting = networkStatusMiddleware(
        recoveryContext(method),
        next
      ).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await jest.advanceTimersByTimeAsync(100);
      expect(next).not.toHaveBeenCalled();
      status = 'error';
      await jest.advanceTimersByTimeAsync(100);
      const callsAfterError = next.mock.calls.length;
      await jest.advanceTimersByTimeAsync(NETWORK_READY_TIMEOUT_MS);
      const result = await waiting;
      expect(callsAfterError).toBe(1);
      expect(result).toEqual({ value: 'handler' });
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it.each([
    ['connecting', 'wallet_switchEthereumChain'],
    ['switching', 'wallet_switchEthereumChain'],
    ['connecting', 'eth_chainId'],
    ['switching', 'eth_chainId'],
  ])('does not allow %s to admit %s', async (status, method) => {
    mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: status } });
    const next = jest.fn();
    const waiting = networkStatusMiddleware(recoveryContext(method), next);
    const rejected = expect(waiting).rejects.toMatchObject({ code: -32603 });
    await jest.advanceTimersByTimeAsync(NETWORK_READY_TIMEOUT_MS);
    await rejected;
    expect(next).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('admits the selected chain identity read immediately on error', async () => {
    mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: 'error' } });
    const next = jest.fn().mockResolvedValue('0x3441');
    const result = networkStatusMiddleware(
      recoveryContext('eth_chainId'),
      next
    ).then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    await jest.advanceTimersByTimeAsync(0);
    const callsBeforeDeadline = next.mock.calls.length;
    await jest.advanceTimersByTimeAsync(NETWORK_READY_TIMEOUT_MS);
    expect(await result).toEqual({ value: '0x3441' });
    expect(callsBeforeDeadline).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    'personal_sign',
    'eth_sendTransaction',
    'eth_signTypedData_v4',
    'wallet_sendCalls',
    'wallet_getBalance',
    'fake_wallet_switchEthereumChain',
  ])('does not admit %s on a failed network', async (method) => {
    mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: 'error' } });
    const next = jest.fn();
    const waiting = networkStatusMiddleware(recoveryContext(method), next);
    const rejected = expect(waiting).rejects.toMatchObject({ code: -32603 });
    await jest.advanceTimersByTimeAsync(NETWORK_READY_TIMEOUT_MS);
    await rejected;
    expect(next).not.toHaveBeenCalled();
  });

  it.each([...recoveryMethods, 'eth_chainId'])(
    'retains document cancellation before %s recovery',
    async (method) => {
      mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: 'error' } });
      const abort = new AbortController();
      abort.abort();
      const next = jest.fn();
      await expect(
        networkStatusMiddleware(recoveryContext(method, abort.signal), next)
      ).rejects.toMatchObject({ code: 4001 });
      expect(next).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it('still admits ordinary methods after the existing idle transition', async () => {
    let status = 'error';
    mockGetState.mockImplementation(() => ({
      vaultGlobal: { networkStatus: status },
    }));
    const next = jest.fn().mockResolvedValue('handler');
    const waiting = networkStatusMiddleware(
      recoveryContext('personal_sign'),
      next
    );
    await jest.advanceTimersByTimeAsync(100);
    expect(next).not.toHaveBeenCalled();
    status = 'idle';
    await jest.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe('handler');
    expect(next).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('recovery approval remains explicit', () => {
  afterEach(() => {
    requestCoordinator.clearQueue();
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  it('reaches the held popup but still requires its existing approval result', async () => {
    jest.useFakeTimers();
    mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: 'error' } });
    let rejectApproval!: (error: { code: number }) => void;
    const opening = jest.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectApproval = reject;
        })
    );
    const pipeline = new RequestPipeline()
      .use(networkStatusMiddleware)
      .use((request) =>
        requestCoordinator.coordinatePopupRequest(request, opening)
      );
    let settled = false;
    const result = pipeline
      .execute(recoveryContext('wallet_switchEthereumChain'))
      .finally(() => {
        settled = true;
      });
    const rejected = expect(result).rejects.toMatchObject({ code: 4001 });
    await jest.advanceTimersByTimeAsync(100);
    expect(opening).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    rejectApproval({ code: 4001 });
    await rejected;
    expect(pipeline.isCurrentlyProcessing()).toBe(false);
    expect(pipeline.getQueueLength()).toBe(0);
  });
});

describe('queued network-control recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    requestCoordinator.clearQueue();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('routes an already queued network recovery after the previous popup settles in error', async () => {
    mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: 'error' } });
    let release!: () => void;
    const first = requestCoordinator.coordinatePopupRequest(
      recoveryContext('wallet_addEthereumChain'),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await jest.advanceTimersByTimeAsync(100);
    const executor = jest.fn().mockResolvedValue('rechecked');
    requestCoordinator.setRequestExecutor(executor);
    const queuedContext = recoveryContext('wallet_switchEthereumChain');
    const queued = requestCoordinator
      .coordinatePopupRequest(queuedContext, jest.fn())
      .then(
        (value) => ({ value }),
        (error) => ({ error })
      );
    release();
    await first;
    await jest.advanceTimersByTimeAsync(100);
    const calls = executor.mock.calls.length;
    await jest.advanceTimersByTimeAsync(30000);
    const result = await queued;
    expect(calls).toBe(1);
    expect(result).toEqual({ value: 'rechecked' });
    expect(executor).toHaveBeenCalledWith(
      queuedContext.originalRequest.host,
      {
        method: 'wallet_switchEthereumChain',
        params: queuedContext.originalRequest.params,
        network: undefined,
      },
      { sender: queuedContext.originalRequest.sender, signal: undefined }
    );
  });

  it.each(['connecting', 'switching'])(
    'keeps queued recovery blocked while %s',
    async (initial) => {
      let status = initial;
      mockGetState.mockImplementation(() => ({
        vaultGlobal: { networkStatus: status },
      }));
      let release!: () => void;
      const first = requestCoordinator.coordinatePopupRequest(
        recoveryContext('wallet_addEthereumChain'),
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      await jest.advanceTimersByTimeAsync(100);
      const executor = jest.fn().mockResolvedValue('rechecked');
      requestCoordinator.setRequestExecutor(executor);
      const queued = requestCoordinator.coordinatePopupRequest(
        recoveryContext('wallet_switchEthereumChain'),
        jest.fn()
      );
      release();
      await first;
      await jest.advanceTimersByTimeAsync(300);
      expect(executor).not.toHaveBeenCalled();
      status = 'idle';
      await jest.advanceTimersByTimeAsync(200);
      await queued;
      expect(executor).toHaveBeenCalledTimes(1);
    }
  );

  it('never routes a queued signing request from an error state', async () => {
    mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: 'error' } });
    let release!: () => void;
    const first = requestCoordinator.coordinatePopupRequest(
      recoveryContext('wallet_addEthereumChain'),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await jest.advanceTimersByTimeAsync(100);
    const executor = jest.fn();
    requestCoordinator.setRequestExecutor(executor);
    const queued = requestCoordinator.coordinatePopupRequest(
      recoveryContext('personal_sign'),
      jest.fn()
    );
    const rejected = expect(queued).rejects.toMatchObject({ code: 4001 });
    release();
    await first;
    await jest.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(executor).not.toHaveBeenCalled();
  });
});
