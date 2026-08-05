/* eslint-disable camelcase */
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

jest.mock('./popup-promise', () => ({
  popupPromise: jest.fn().mockResolvedValue(null),
}));

import { getController } from 'scripts/Background';

import { getMethodConfig } from './method-registry';
import { popupPromise } from './popup-promise';
import {
  networkCompatibilityMiddleware,
  requestCoordinator,
} from './request-pipeline';
import { MethodRoute, NetworkEnforcement, NetworkPreference } from './types';

const host = 'connected.example';

const createContext = (method: string) =>
  ({
    methodConfig: getMethodConfig(method),
    originalRequest: {
      host,
      method,
      params:
        method === 'wallet_requestPermissions'
          ? [{ eth_accounts: {} }]
          : undefined,
      sender: {},
      type: 'METHOD_REQUEST',
    },
  } as any);

describe('networkCompatibilityMiddleware connection enforcement', () => {
  const isConnected = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    isConnected.mockReturnValue(true);
    (getController as jest.Mock).mockReturnValue({
      dapp: { isConnected },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps wallet_requestPermissions from opening a separate connection popup', () => {
    expect(getMethodConfig('wallet_requestPermissions')).toMatchObject({
      networkEnforcement: NetworkEnforcement.Always,
      networkPreference: NetworkPreference.EVM,
      requiresConnection: false,
    });
  });

  it.each(['wallet_requestPermissions', 'eth_requestAccounts'])(
    'forces an EVM type switch for %s despite an existing UTXO connection',
    async (method) => {
      mockGetState.mockReturnValue({
        vault: { isBitcoinBased: true },
      });
      const popupSpy = jest
        .spyOn(requestCoordinator, 'coordinatePopupRequest')
        .mockResolvedValue(null);
      const next = jest.fn().mockResolvedValue('continued');
      const context = createContext(method);

      await expect(networkCompatibilityMiddleware(context, next)).resolves.toBe(
        'continued'
      );

      expect(popupSpy).toHaveBeenCalledWith(
        context,
        expect.any(Function),
        MethodRoute.SwitchNetwork
      );
      await popupSpy.mock.calls[0][1]();
      expect(popupPromise).toHaveBeenCalledWith({
        data: {
          disabledNetworkType: 'syscoin',
          forceNetworkType: 'ethereum',
          isTypeSwitch: true,
        },
        eventName: 'switchNetwork',
        host,
        route: MethodRoute.SwitchNetwork,
      });
      expect(next).toHaveBeenCalledTimes(1);
    }
  );

  it('forces a UTXO type switch for sys_requestAccounts despite an existing EVM connection', async () => {
    mockGetState.mockReturnValue({
      vault: { isBitcoinBased: false },
    });
    const popupSpy = jest
      .spyOn(requestCoordinator, 'coordinatePopupRequest')
      .mockResolvedValue(null);
    const next = jest.fn().mockResolvedValue('continued');
    const context = createContext('sys_requestAccounts');

    await expect(networkCompatibilityMiddleware(context, next)).resolves.toBe(
      'continued'
    );

    expect(popupSpy).toHaveBeenCalledWith(
      context,
      expect.any(Function),
      MethodRoute.SwitchNetwork
    );
    await popupSpy.mock.calls[0][1]();
    expect(popupPromise).toHaveBeenCalledWith({
      data: {
        disabledNetworkType: 'ethereum',
        forceNetworkType: 'syscoin',
        isTypeSwitch: true,
      },
      eventName: 'switchNetwork',
      host,
      route: MethodRoute.SwitchNetwork,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wallet_requestPermissions', false],
    ['eth_requestAccounts', false],
    ['sys_requestAccounts', true],
  ])(
    'does not open a switch popup for %s on the correct network type',
    async (method, isBitcoinBased) => {
      mockGetState.mockReturnValue({
        vault: { isBitcoinBased },
      });
      const popupSpy = jest.spyOn(requestCoordinator, 'coordinatePopupRequest');
      const next = jest.fn().mockResolvedValue('continued');

      await expect(
        networkCompatibilityMiddleware(createContext(method as string), next)
      ).resolves.toBe('continued');

      expect(popupSpy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  );
});
