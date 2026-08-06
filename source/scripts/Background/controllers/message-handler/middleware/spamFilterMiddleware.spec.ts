jest.mock('../popup-promise', () => ({ popupPromise: jest.fn() }));
jest.mock('../request-pipeline', () => ({
  requestCoordinator: { coordinatePopupRequest: jest.fn() },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: jest.fn(),
  },
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
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
    const next = jest.fn().mockResolvedValue('signed');

    await expect(spamFilterMiddleware(context, next)).resolves.toBe('signed');

    expect(
      mockedStore.dispatch.mock.calls.map(([action]) => action.type)
    ).toEqual(['spamFilter/recordRequest', 'spamFilter/resetDappRequests']);
  });

  it('keeps a rejected request in the popup burst', async () => {
    const rejection = new Error('User rejected the request');
    const next = jest.fn().mockRejectedValue(rejection);

    await expect(spamFilterMiddleware(context, next)).rejects.toBe(rejection);

    expect(
      mockedStore.dispatch.mock.calls.map(([action]) => action.type)
    ).toEqual(['spamFilter/recordRequest']);
  });
});
