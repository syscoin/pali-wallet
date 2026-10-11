const mockGetState = jest.fn();
const mockDispatch = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockGetState(),
    dispatch: (action: any) => mockDispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));
jest.mock('./method-handlers', () => ({ clearProviderCache: jest.fn() }));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

import reducer, { blockDapp } from 'state/spamFilter';
import { isDappBlocked } from 'state/spamFilter/selectors';

import { spamFilterMiddleware } from './middleware/spamFilterMiddleware';
import { typedDataValidationMiddleware } from './middleware/typedDataValidationMiddleware';
import { popupPromise } from './popup-promise';
import { assertRequestActive } from './request-lifetime';
import { RequestPipeline, requestCoordinator } from './request-pipeline';
import { MethodRoute } from './types';

const host = 'https://test-dapp.example';
const account = '0x942db9399f51805f9a84664587210b7ce67e052e';
const createContext = (method = 'personal_sign', signal?: AbortSignal) =>
  ({
    methodConfig: { hasPopup: true, popupRoute: MethodRoute.EthSign },
    originalRequest: { host, method, signal, sender: {} },
  } as any);
const invalidTypedContext = () => ({
  ...createContext('eth_signTypedData_v4'),
  originalRequest: {
    ...createContext('eth_signTypedData_v4').originalRequest,
    params: [
      account,
      {
        domain: { verifyingContract: 'invalid-address' },
        types: {
          EIP712Domain: [{ name: 'verifyingContract', type: 'address' }],
          Message: [{ name: 'account', type: 'address' }],
        },
        primaryType: 'Message',
        message: { account },
      },
    ],
  },
});

describe('spam counting at the actual approval boundary', () => {
  let state: ReturnType<typeof reducer>;
  let opening: jest.Mock;
  let pipeline: RequestPipeline;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    state = reducer(undefined, { type: '@@INIT' });
    mockGetState.mockImplementation(() => ({
      spamFilter: state,
      vaultGlobal: { networkStatus: 'idle' },
    }));
    mockDispatch.mockImplementation((action) => {
      state = reducer(state, action);
      return action;
    });
    jest.mocked(popupPromise).mockResolvedValue({ action: 'allow' });
    opening = jest.fn().mockRejectedValue({
      code: 4001,
      message: 'User closed popup',
    });
    pipeline = new RequestPipeline()
      .use(spamFilterMiddleware)
      .use(typedDataValidationMiddleware)
      .use((context) =>
        requestCoordinator.coordinatePopupRequest(context, opening)
      );
  });

  afterEach(() => {
    expect(requestCoordinator.isActive()).toBe(false);
    expect(pipeline.getQueueLength()).toBe(0);
    jest.useRealTimers();
  });

  const rejectActualApproval = async (request = createContext()) => {
    const assertion = expect(pipeline.execute(request)).rejects.toMatchObject({
      code: 4001,
    });
    await jest.advanceTimersByTimeAsync(300);
    await assertion;
  };

  const rejectInvalidTypedData = async () => {
    const assertion = expect(
      pipeline.execute(invalidTypedContext())
    ).rejects.toMatchObject({ code: -32602 });
    await jest.advanceTimersByTimeAsync(300);
    await assertion;
  };

  it('does not open a spam warning for sequential invalid typed-data requests', async () => {
    for (let index = 0; index < 5; index += 1) {
      await rejectInvalidTypedData();
    }
    expect(state.dapps[host]).toBeUndefined();
    expect(opening).not.toHaveBeenCalled();
    expect(popupPromise).not.toHaveBeenCalled();
  });

  it('keeps two genuine rejections through malformed requests and warns on the next real attempt', async () => {
    await rejectActualApproval();
    await rejectActualApproval();
    const genuineHistory = state.dapps[host].requests;
    for (let index = 0; index < 5; index += 1) {
      await rejectInvalidTypedData();
      expect(state.dapps[host].requests).toEqual(genuineHistory);
    }
    expect(popupPromise).not.toHaveBeenCalled();
    await rejectActualApproval();
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(popupPromise).toHaveBeenCalledWith(
      expect.objectContaining({
        host,
        route: 'spam-warning',
        data: { requestCount: 3 },
      })
    );
    expect(opening).toHaveBeenCalledTimes(3);
  });

  it('counts popup-creation failures regardless of their error code', async () => {
    opening.mockRejectedValue({
      code: -32602,
      message: 'Window creation failed',
    });
    for (let index = 0; index < 2; index += 1) {
      const assertion = expect(
        pipeline.execute(createContext())
      ).rejects.toMatchObject({
        code: -32602,
      });
      await jest.advanceTimersByTimeAsync(100);
      await assertion;
    }
    expect(state.dapps[host].requests).toHaveLength(2);
  });

  it('records one request when it opens multiple approval steps', async () => {
    pipeline = new RequestPipeline()
      .use(spamFilterMiddleware)
      .use(async (context) => {
        await requestCoordinator.coordinatePopupRequest(
          context,
          async () => null
        );
        return requestCoordinator.coordinatePopupRequest(context, opening);
      });
    await rejectActualApproval();
    expect(state.dapps[host].requests).toHaveLength(1);
    expect(opening).toHaveBeenCalledTimes(1);
  });

  it('does not count cancellation during the opening delay', async () => {
    const abort = new AbortController();
    const assertion = expect(
      pipeline.execute(createContext('personal_sign', abort.signal))
    ).rejects.toMatchObject({ code: 4001 });
    abort.abort();
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(state.dapps[host]).toBeUndefined();
    expect(opening).not.toHaveBeenCalled();
  });

  it('does not count a queued request whose document is cancelled before its handler runs', async () => {
    let release!: (value: unknown) => void;
    const occupied = new Promise((resolve) => {
      release = resolve;
    });
    const active = requestCoordinator.coordinatePopupRequest(
      createContext(),
      () => occupied,
      MethodRoute.Connect
    );
    await jest.advanceTimersByTimeAsync(100);
    const abort = new AbortController();
    requestCoordinator.setRequestExecutor(async (_, __, request) => {
      assertRequestActive(request?.signal);
      throw new Error('A cancelled request must not execute');
    });
    const assertion = expect(
      pipeline.execute(createContext('personal_sign', abort.signal))
    ).rejects.toMatchObject({ code: 4001 });
    abort.abort();
    release(null);
    await active;
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(state.dapps[host]).toBeUndefined();
    expect(opening).not.toHaveBeenCalled();
  });

  it('holds the slot through a warning and never opens approval after explicit blocking', async () => {
    await rejectActualApproval();
    await rejectActualApproval();
    let answerWarning!: (value: unknown) => void;
    jest.mocked(popupPromise).mockImplementation(
      () =>
        new Promise((resolve) => {
          answerWarning = resolve;
        })
    );
    const assertion = expect(
      pipeline.execute(createContext())
    ).rejects.toMatchObject({ code: 4100 });
    await jest.advanceTimersByTimeAsync(100);
    expect(requestCoordinator.isActive()).toBe(true);
    expect(opening).toHaveBeenCalledTimes(2);
    const blockedAt = Date.now();
    answerWarning({ action: 'block' });
    await assertion;
    expect(opening).toHaveBeenCalledTimes(2);
    expect(state.dapps[host].blockedUntil).toBe(blockedAt + 60_000);
    await expect(pipeline.execute(createContext())).rejects.toMatchObject({
      code: 4100,
    });
    expect(state.dapps[host].blockedUntil).toBe(blockedAt + 60_000);
    jest.setSystemTime(blockedAt + 59_999);
    expect(isDappBlocked({ spamFilter: state }, host)).toBe(true);
    jest.setSystemTime(blockedAt + 60_000);
    expect(isDappBlocked({ spamFilter: state }, host)).toBe(false);
    await rejectActualApproval();
    expect(opening).toHaveBeenCalledTimes(3);
  });

  it('rechecks a newly blocked site before opening a queued approval', async () => {
    const assertion = expect(
      pipeline.execute(createContext())
    ).rejects.toMatchObject({ code: 4100 });
    state = reducer(state, blockDapp({ host }));
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(opening).not.toHaveBeenCalled();
    expect(state.dapps[host].requests).toEqual([]);
  });

  it('keeps warning and approval serialized when allowing a burst with another request queued', async () => {
    await rejectActualApproval();
    await rejectActualApproval();
    let answerWarning!: (value: unknown) => void;
    jest.mocked(popupPromise).mockImplementation(
      () =>
        new Promise((resolve) => {
          answerWarning = resolve;
        })
    );
    const third = expect(
      pipeline.execute(createContext())
    ).rejects.toMatchObject({ code: 4001 });
    await jest.advanceTimersByTimeAsync(100);
    expect(requestCoordinator.isActive()).toBe(true);
    expect(opening).toHaveBeenCalledTimes(2);
    const fourth = expect(
      pipeline.execute(createContext())
    ).rejects.toMatchObject({ code: 4001 });
    expect(pipeline.getQueueLength()).toBe(1);
    await expect(
      requestCoordinator.coordinatePopupRequest(createContext(), opening)
    ).rejects.toMatchObject({ code: 4001 });
    expect(opening).toHaveBeenCalledTimes(2);
    answerWarning({ action: 'allow' });
    await jest.advanceTimersByTimeAsync(300);
    await Promise.all([third, fourth]);
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(opening).toHaveBeenCalledTimes(4);
    expect(state.dapps[host].requests).toHaveLength(1);
  });

  it('does not open approval if its document closes after allowing the warning', async () => {
    await rejectActualApproval();
    await rejectActualApproval();
    let answerWarning!: (value: unknown) => void;
    jest.mocked(popupPromise).mockImplementation(
      () =>
        new Promise((resolve) => {
          answerWarning = resolve;
        })
    );
    const abort = new AbortController();
    const assertion = expect(
      pipeline.execute(createContext('personal_sign', abort.signal))
    ).rejects.toMatchObject({ code: 4001 });
    await jest.advanceTimersByTimeAsync(100);
    answerWarning({ action: 'allow' });
    abort.abort();
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(opening).toHaveBeenCalledTimes(2);
    expect(state.dapps[host].requests).toEqual([]);
  });

  it('keeps a replacement guard when an earlier owner disposes its registration', async () => {
    const request = createContext();
    const earlier = jest.fn(async () => undefined);
    const replacement = jest.fn(async () => undefined);
    const disposeEarlier = requestCoordinator.registerPopupGuard(
      request,
      earlier
    );
    requestCoordinator.registerPopupGuard(request, replacement);
    disposeEarlier();
    const result = requestCoordinator.coordinatePopupRequest(
      request,
      async () => 'signed'
    );
    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('signed');
    expect(earlier).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  it('resets fulfilled approval history and never counts read-only requests', async () => {
    await rejectActualApproval();
    opening.mockResolvedValue('signed');
    const success = pipeline.execute(createContext());
    await jest.advanceTimersByTimeAsync(100);
    await expect(success).resolves.toBe('signed');
    expect(state.dapps[host].requests).toEqual([]);
    const readOnly = new RequestPipeline()
      .use(spamFilterMiddleware)
      .use(async () => '0x1');
    await expect(
      readOnly.execute({
        ...createContext('eth_chainId'),
        methodConfig: { hasPopup: false },
      } as any)
    ).resolves.toBe('0x1');
    expect(state.dapps[host].requests).toEqual([]);
  });

  it('preserves genuine rejections when optimization fulfills without a popup', async () => {
    await rejectActualApproval();
    await rejectActualApproval();
    const genuineHistory = state.dapps[host].requests;
    const optimized = new RequestPipeline()
      .use(spamFilterMiddleware)
      .use(async () => null);
    const optimizedResult = optimized.execute(createContext());
    await jest.advanceTimersByTimeAsync(300);
    await expect(optimizedResult).resolves.toBeNull();
    expect(state.dapps[host].requests).toEqual(genuineHistory);
    expect(popupPromise).not.toHaveBeenCalled();
    await rejectActualApproval();
    expect(popupPromise).toHaveBeenCalledTimes(1);
  });
});
