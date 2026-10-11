jest.mock('../popup-promise', () => ({ popupPromise: jest.fn() }));
jest.mock('../request-pipeline', () => ({
  requestCoordinator: { registerPopupGuard: jest.fn() },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: jest.fn(),
  },
}));

import { requestCoordinator } from '../request-pipeline';
import store from 'state/store';

import { spamFilterMiddleware } from './spamFilterMiddleware';

const mockedStore = store as unknown as {
  dispatch: jest.Mock;
  getState: jest.Mock;
};

const context = {
  methodConfig: { hasPopup: true },
  originalRequest: {
    host: 'example.test',
    method: 'personal_sign',
  },
} as any;

describe('spamFilterMiddleware fulfilled request handling', () => {
  let openingGuard: () => Promise<void>;
  const unregisterGuard = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (requestCoordinator.registerPopupGuard as jest.Mock).mockImplementation(
      (_, guard) => {
        openingGuard = guard;
        return unregisterGuard;
      }
    );
    mockedStore.getState.mockReturnValue({
      spamFilter: {
        config: {
          blockDurationMs: 60_000,
          enabled: true,
          requestThreshold: 3,
          timeWindowMs: 10_000,
        },
        dapps: {},
      },
    });
  });

  it('resets the popup burst after a fulfilled request', async () => {
    const next = jest.fn(async () => {
      await openingGuard();
      return 'signed';
    });

    await expect(spamFilterMiddleware(context, next)).resolves.toBe('signed');

    expect(
      mockedStore.dispatch.mock.calls.map(([action]) => action.type)
    ).toEqual(['spamFilter/recordRequest', 'spamFilter/resetDappRequests']);
    expect(unregisterGuard).toHaveBeenCalledTimes(1);
  });

  it('keeps a rejected request in the popup burst', async () => {
    const rejection = new Error('User rejected the request');
    const next = jest.fn(async () => {
      await openingGuard();
      throw rejection;
    });

    await expect(spamFilterMiddleware(context, next)).rejects.toBe(rejection);

    expect(
      mockedStore.dispatch.mock.calls.map(([action]) => action.type)
    ).toEqual(['spamFilter/recordRequest']);
    expect(unregisterGuard).toHaveBeenCalledTimes(1);
  });

  it('disposes an unused guard without recording a pre-approval failure', async () => {
    const failure = new Error('Invalid request');
    await expect(
      spamFilterMiddleware(context, jest.fn().mockRejectedValue(failure))
    ).rejects.toBe(failure);
    expect(mockedStore.dispatch).not.toHaveBeenCalled();
    expect(unregisterGuard).toHaveBeenCalledTimes(1);
  });

  it('does not reset genuine history when a popup-capable method fulfills without opening', async () => {
    await expect(
      spamFilterMiddleware(context, jest.fn().mockResolvedValue(null))
    ).resolves.toBeNull();
    expect(mockedStore.dispatch).not.toHaveBeenCalled();
    expect(unregisterGuard).toHaveBeenCalledTimes(1);
  });
});
