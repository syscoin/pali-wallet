const mockGetState = jest.fn();

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockGetState(),
  },
}));

jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
}));

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  PsbtUtils: {},
}));

jest.mock('./method-handlers', () => ({
  clearProviderCache: jest.fn(),
}));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

import { getController } from 'scripts/Background';
import { KeyringAccountType } from 'types/network';

import { popupPromise } from './popup-promise';
import {
  accountSwitchingMiddleware,
  requestCoordinator,
} from './request-pipeline';

const host = 'connected.example';
const accountA = {
  address: '0x1111111111111111111111111111111111111111',
  id: 0,
};
const accountB = {
  address: '0x2222222222222222222222222222222222222222',
  id: 1,
};

const createContext = () =>
  ({
    methodConfig: {
      isBlocking: true,
      requiresConnection: true,
    },
    originalRequest: {
      host,
      method: 'eth_sendTransaction',
      params: [{ from: accountB.address }],
      sender: {},
      type: 'METHOD_REQUEST',
    },
  } as any);

describe('accountSwitchingMiddleware site-level account selection', () => {
  const changeAccount = jest.fn();
  const getDapp = jest.fn();
  const getDappAccount = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    changeAccount.mockResolvedValue(undefined);
    getDapp.mockReturnValue({
      accountId: accountA.id,
      accountType: KeyringAccountType.HDAccount,
      host,
    });
    getDappAccount.mockReturnValue(accountA);
    (getController as jest.Mock).mockReturnValue({
      dapp: {
        changeAccount,
        get: getDapp,
        getAccount: getDappAccount,
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not change a PSBT account using caller-provided proprietary address metadata', async () => {
    mockGetState.mockReturnValue({
      vault: {
        accounts: { HDAccount: { 0: accountA, 1: accountB } },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      },
    });
    const context = createContext();
    context.originalRequest.method = 'sys_sign';
    context.originalRequest.params = [
      { psbt: 'opaque-psbt', address: accountB.address },
    ];
    const popupSpy = jest.spyOn(requestCoordinator, 'coordinatePopupRequest');
    const next = jest.fn();
    await accountSwitchingMiddleware(context, next);
    expect(popupSpy).not.toHaveBeenCalled();
    expect(changeAccount).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'requests the connected UTXO account when another account is active (accepted=%s)',
    async (accepted) => {
      const connected = { ...accountA, address: 'sys1connected-account' };
      const active = { ...accountB, address: 'sys1active-account' };
      getDappAccount.mockReturnValue(connected);
      mockGetState.mockReturnValue({
        vault: {
          accounts: { HDAccount: { 0: connected, 1: active } },
          activeAccount: { id: 1, type: KeyringAccountType.HDAccount },
        },
      });
      jest.mocked(popupPromise).mockImplementation(async () => {
        if (!accepted) throw new Error('user rejected');
        return null;
      });
      jest
        .spyOn(requestCoordinator, 'coordinatePopupRequest')
        .mockImplementation(async (_context, openPopup) => openPopup());
      const context = createContext();
      context.originalRequest.method = 'sys_sign';
      context.originalRequest.params = [
        { psbt: 'opaque-psbt', address: active.address },
      ];
      const next = jest.fn();
      if (accepted) await accountSwitchingMiddleware(context, next);
      else
        await expect(
          accountSwitchingMiddleware(context, next)
        ).rejects.toMatchObject({ code: 4100 });
      expect(popupPromise).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            connectedAccount: connected,
            accountType: KeyringAccountType.HDAccount,
          },
        })
      );
      expect(next).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(changeAccount).not.toHaveBeenCalled();
    }
  );

  it('updates the host connection after the user accepts a required account switch', async () => {
    mockGetState.mockReturnValue({
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 0: accountA },
          [KeyringAccountType.Imported]: { 1: accountB },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      },
    });
    jest
      .spyOn(requestCoordinator, 'coordinatePopupRequest')
      .mockResolvedValue(null);
    const next = jest.fn().mockResolvedValue('continued');

    await expect(
      accountSwitchingMiddleware(createContext(), next)
    ).resolves.toBe('continued');

    expect(requestCoordinator.coordinatePopupRequest).toHaveBeenCalledTimes(1);
    expect(changeAccount).toHaveBeenCalledWith(
      host,
      accountB.id,
      KeyringAccountType.Imported
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requires selection consent before connecting an already-active requested account', async () => {
    mockGetState.mockReturnValue({
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 0: accountA },
          [KeyringAccountType.Imported]: { 1: accountB },
        },
        activeAccount: { id: 1, type: KeyringAccountType.Imported },
      },
    });
    const popupSpy = jest
      .spyOn(requestCoordinator, 'coordinatePopupRequest')
      .mockResolvedValue(null);
    const next = jest.fn().mockResolvedValue('continued');

    await expect(
      accountSwitchingMiddleware(createContext(), next)
    ).resolves.toBe('continued');

    expect(popupSpy).toHaveBeenCalledTimes(1);
    expect(changeAccount).toHaveBeenCalledWith(
      host,
      accountB.id,
      KeyringAccountType.Imported
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('connects an already-active requested account only after selection consent', async () => {
    mockGetState.mockReturnValue({
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 0: accountA },
          [KeyringAccountType.Imported]: { 1: accountB },
        },
        activeAccount: { id: 1, type: KeyringAccountType.Imported },
      },
    });
    const popupSpy = jest
      .spyOn(requestCoordinator, 'coordinatePopupRequest')
      .mockResolvedValue(null);
    const next = jest.fn().mockRejectedValue(new Error('action rejected'));

    await expect(
      accountSwitchingMiddleware(createContext(), next)
    ).rejects.toThrow('action rejected');

    expect(popupSpy).toHaveBeenCalledTimes(1);
    expect(changeAccount).toHaveBeenCalledTimes(1);
    expect(changeAccount).toHaveBeenCalledWith(
      host,
      accountB.id,
      KeyringAccountType.Imported
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(changeAccount.mock.invocationCallOrder[0]).toBeLessThan(
      next.mock.invocationCallOrder[0]
    );
  });

  it('does not re-emit an account change when the host already tracks the selected account', async () => {
    getDapp.mockReturnValue({
      accountId: accountB.id,
      accountType: KeyringAccountType.Imported,
      host,
    });
    mockGetState.mockReturnValue({
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 0: accountA },
          [KeyringAccountType.Imported]: { 1: accountB },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      },
    });
    const popupSpy = jest
      .spyOn(requestCoordinator, 'coordinatePopupRequest')
      .mockResolvedValue(null);
    const next = jest.fn().mockResolvedValue('continued');

    await expect(
      accountSwitchingMiddleware(createContext(), next)
    ).resolves.toBe('continued');

    expect(popupSpy).toHaveBeenCalledTimes(1);
    expect(changeAccount).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not update the host connection when the user rejects the account switch', async () => {
    mockGetState.mockReturnValue({
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 0: accountA },
          [KeyringAccountType.Imported]: { 1: accountB },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      },
    });
    jest
      .spyOn(requestCoordinator, 'coordinatePopupRequest')
      .mockRejectedValue(new Error('user rejected'));
    const next = jest.fn();

    await expect(
      accountSwitchingMiddleware(createContext(), next)
    ).rejects.toMatchObject({ code: 4100 });

    expect(changeAccount).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not connect an already-active account without selection consent', async () => {
    mockGetState.mockReturnValue({
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 0: accountA },
          [KeyringAccountType.Imported]: { 1: accountB },
        },
        activeAccount: { id: 1, type: KeyringAccountType.Imported },
      },
    });
    jest
      .spyOn(requestCoordinator, 'coordinatePopupRequest')
      .mockRejectedValue(new Error('user rejected'));
    const next = jest.fn();

    await expect(
      accountSwitchingMiddleware(createContext(), next)
    ).rejects.toMatchObject({ code: 4100 });

    expect(changeAccount).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
