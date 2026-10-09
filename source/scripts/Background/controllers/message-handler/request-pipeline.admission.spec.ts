const mockGetState = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockGetState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));
jest.mock('./method-handlers', () => ({ clearProviderCache: jest.fn() }));

import {
  MAX_PENDING_REQUESTS,
  MAX_REQUESTS_PER_ORIGIN,
  NETWORK_READY_TIMEOUT_MS,
  RequestPipeline,
  networkStatusMiddleware,
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
