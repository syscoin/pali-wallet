const mockGetState = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockGetState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));
jest.mock('./method-handlers', () => ({ clearProviderCache: jest.fn() }));
jest.mock('../externalWalletCreation', () => ({
  waitForExternalWalletClosure: jest.fn(),
}));

import { waitForExternalWalletClosure } from '../externalWalletCreation';

import { requestCoordinator } from './request-pipeline';
import { MethodRoute } from './types';

describe('popup coordinator window handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetState.mockReturnValue({ vaultGlobal: { networkStatus: 'idle' } });
  });
  const makeContext = (signal?: AbortSignal) =>
    ({
      methodConfig: { popupRoute: MethodRoute.EthSign },
      originalRequest: { host: 'https://site.example', signal },
    } as any);

  it('holds its slot until the old view closes before opening approval', async () => {
    let close!: () => void;
    jest.mocked(waitForExternalWalletClosure).mockReturnValue(
      new Promise((resolve) => {
        close = resolve;
      })
    );
    const abort = new AbortController();
    const open = jest.fn().mockResolvedValue('approved');
    const context = makeContext(abort.signal);
    const guard = jest.fn();
    requestCoordinator.registerPopupGuard(context, guard);
    const pending = requestCoordinator.coordinatePopupRequest(context, open);
    expect(requestCoordinator.isActive()).toBe(true);
    expect(waitForExternalWalletClosure).toHaveBeenCalledWith(abort.signal);
    expect(guard).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    close();
    await expect(pending).resolves.toBe('approved');
    expect(guard).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(requestCoordinator.isActive()).toBe(false);
  });

  it('never opens the next approval when the live window check fails', async () => {
    const failure = Object.assign(new Error('Dapp already has a open window'), {
      code: 4100,
    });
    jest.mocked(waitForExternalWalletClosure).mockRejectedValue(failure);
    const open = jest.fn();
    await expect(
      requestCoordinator.coordinatePopupRequest(makeContext(), open)
    ).rejects.toBe(failure);
    expect(open).not.toHaveBeenCalled();
    expect(requestCoordinator.isActive()).toBe(false);
  });

  it('returns a terminal result without an additional window check', async () => {
    jest.mocked(waitForExternalWalletClosure).mockResolvedValue(undefined);
    const open = jest.fn().mockResolvedValue('terminal result');
    await expect(
      requestCoordinator.coordinatePopupRequest(makeContext(), open)
    ).resolves.toBe('terminal result');
    expect(waitForExternalWalletClosure).toHaveBeenCalledTimes(1);
  });
});
