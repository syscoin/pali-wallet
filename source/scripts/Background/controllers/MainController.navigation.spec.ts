jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/vaultCache', () => ({
  __esModule: true,
  default: {
    emergencySave: jest.fn().mockResolvedValue(undefined),
    clearCache: jest.fn(),
  },
}));
jest.mock('utils/slhDsa/offscreenClient', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
}));

import { getController } from '..';
import store from 'state/store';
import { clearNavigationState } from 'utils/navigationState';

import MainController from './MainController';

it('clears popup browsing and unsigned drafts when the background locks with no UI document', () => {
  const wallet: any = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 1;
  wallet.networkRequestGeneration = 1;
  wallet.clearAllTimers = jest.fn();
  wallet.lockAllKeyrings = jest.fn();
  wallet.stopAutoLockTimer = jest.fn().mockResolvedValue(undefined);
  wallet.stopAllRapidPolling = jest.fn();
  const dispatch = jest.spyOn(store, 'dispatch').mockImplementation(jest.fn());
  (getController as jest.Mock).mockReturnValue({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  });
  try {
    wallet.lock();
    expect(wallet.walletSessionGeneration).toBe(2);
    expect(wallet.lockAllKeyrings).toHaveBeenCalledTimes(1);
    expect(clearNavigationState).toHaveBeenCalledTimes(1);
    expect(wallet.stopAllRapidPolling).toHaveBeenCalledTimes(1);
  } finally {
    dispatch.mockRestore();
  }
});
