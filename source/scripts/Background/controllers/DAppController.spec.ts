const dispatchMock = jest.fn();
const getStateMock = jest.fn();
const saveMainStateMock = jest.fn();

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: (...args: any[]) => dispatchMock(...args),
    getState: () => getStateMock(),
  },
  saveMainState: (...args: any[]) => saveMainStateMock(...args),
}));

jest.mock('../notification-manager', () => ({
  notificationManager: {
    notifyDappConnection: jest.fn(),
  },
}));

jest.mock('./message-handler/provider-cache', () => ({
  clearProviderCache: jest.fn(),
}));

import { KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import { clearProviderCache } from './message-handler/provider-cache';

describe('DAppController account changes', () => {
  const account = {
    address: '0x2222222222222222222222222222222222222222',
    id: 1,
    xpub: 'connected-xpub',
  };
  const host = 'connected.example';

  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.runtime as any).id = 'test-extension';
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
    };
    (chrome as any).scripting = { executeScript: jest.fn() };
    saveMainStateMock.mockResolvedValue(undefined);
    getStateMock.mockReturnValue({
      dapp: {
        dapps: {
          [host]: {
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
            host,
          },
        },
      },
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 1: account },
        },
        isBitcoinBased: false,
      },
    });
  });

  it('clears cached provider accounts when the persisted connection changes', async () => {
    const controller = DAppController();

    await controller.changeAccount(
      host,
      account.id,
      KeyringAccountType.HDAccount
    );

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          accountId: account.id,
          accountType: KeyringAccountType.HDAccount,
          host,
        }),
        type: 'dapp/updateDAppAccount',
      })
    );
    expect(clearProviderCache).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.invocationCallOrder[0]).toBeLessThan(
      (clearProviderCache as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(
      (clearProviderCache as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(saveMainStateMock.mock.invocationCallOrder[0]);
  });

  it('does not clear the cache when the requested account does not exist', async () => {
    const controller = DAppController();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    await controller.changeAccount(host, 99, KeyringAccountType.HDAccount);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(clearProviderCache).not.toHaveBeenCalled();
    expect(saveMainStateMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
