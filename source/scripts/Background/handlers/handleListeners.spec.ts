/* eslint-disable @typescript-eslint/no-empty-function */
import { chrome } from 'jest-chrome';

import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { checkForUpdates } from 'scripts/Background/handlers/handlePaliUpdates';
import { checkForPendingTransactionsUpdate } from 'scripts/Background/utils/checkForPendingTransactions';
import { startPendingTransactionsPolling } from 'scripts/Background/utils/startPendingTransactionsPolling';
import {
  startPolling,
  getPollingInterval,
} from 'scripts/Background/utils/startPolling';
import store from 'state/store';
import { setIsPolling } from 'state/vault';

import { handleListeners } from './handleListeners';

// Mock dependencies
jest.mock('scripts/Background/handlers/handleLogout');
jest.mock('scripts/Background/handlers/handlePaliUpdates');
jest.mock('scripts/Background/utils/checkForPendingTransactions');
jest.mock('scripts/Background/utils/startPendingTransactionsPolling');
jest.mock('scripts/Background/utils/startPolling');
jest.mock('state/store', () => ({
  getState: jest.fn(() => ({
    vault: {
      hasEthProperty: true, // Mock relevant state parts
      isBitcoinBased: false,
    },
  })),
  dispatch: jest.fn(),
}));
jest.mock('state/vault');

// Mock MasterController
const mockMasterController: jest.Mocked<IMasterController> = {
  appRoute: jest.fn(),
  callGetLatestUpdateForAccount: jest.fn(),
  createPopup: jest.fn(),
  dapp: {
    setup: jest.fn(),
    handleStateChange: jest.fn(),
    getState: jest.fn(),
    isConnected: jest.fn(),
    isDAppConnected: jest.fn(),
    isUpdatingConnectedAccount: jest.fn(),
    notifyConnections: jest.fn(),
    notifySwitchChain: jest.fn(),
    removeConnection: jest.fn(),
    setSig: jest.fn(),
    setSiteMetadata: jest.fn(),
    updateConnectedAccount: jest.fn(),
    validateConnection: jest.fn(),
  } as any, // Using 'as any' here for brevity in mocking the nested dapp object
  refresh: jest.fn(),
  rehydrate: jest.fn(),
  utils: {
    setFiat: jest.fn(),
  },
  // Mock wallet methods used in handleListeners
  wallet: {
    setActiveNetwork: jest.fn(),
  } as any, // Use 'as any' for brevity, ideally mock all methods
};

describe('Background: handleListeners', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    chrome.runtime.onInstalled.clearListeners();
    chrome.runtime.onStartup.clearListeners();
    chrome.alarms.onAlarm.clearListeners();
    chrome.runtime.onMessage.clearListeners();

    // Mock getPollingInterval to return a predictable value
    (getPollingInterval as jest.Mock).mockReturnValue(5);

    // Initialize listeners with the mocked controller
    handleListeners(mockMasterController);
  });

  describe('onInstalled Listener', () => {
    it('should create alarms on install', () => {
      // Simulate the onInstalled event
      chrome.runtime.onInstalled.callListeners();

      // Check if alarms are created
      expect(chrome.alarms.create).toHaveBeenCalledWith('check_for_updates', {
        periodInMinutes: 5, // Based on mocked getPollingInterval
      });
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'check_pending_transactions',
        { periodInMinutes: 120 }
      );
      expect(chrome.alarms.create).toHaveBeenCalledWith('update_fiat_price', {
        periodInMinutes: 3, // FIAT_UPDATE_INTERVAL_MINUTES
      });
      expect(chrome.alarms.create).toHaveBeenCalledTimes(3);
    });

    it('should trigger initial updates on install', () => {
      chrome.runtime.onInstalled.callListeners();

      expect(checkForUpdates).toHaveBeenCalledTimes(1);
      expect(checkForPendingTransactionsUpdate).toHaveBeenCalledTimes(1);
      expect(mockMasterController.utils.setFiat).toHaveBeenCalledTimes(1);
    });
  });

  describe('onStartup Listener', () => {
    it('should create alarms on startup', () => {
      chrome.runtime.onStartup.callListeners();

      expect(chrome.alarms.create).toHaveBeenCalledWith('check_for_updates', {
        periodInMinutes: 5,
      });
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'check_pending_transactions',
        { periodInMinutes: 120 }
      );
      expect(chrome.alarms.create).toHaveBeenCalledWith('update_fiat_price', {
        periodInMinutes: 3,
      });
      expect(chrome.alarms.create).toHaveBeenCalledTimes(3);
    });

    it('should trigger initial updates on startup', () => {
      chrome.runtime.onStartup.callListeners();

      expect(checkForUpdates).toHaveBeenCalledTimes(1);
      expect(checkForPendingTransactionsUpdate).toHaveBeenCalledTimes(1);
      expect(mockMasterController.utils.setFiat).toHaveBeenCalledTimes(1);
    });
  });

  describe('onAlarm Listener', () => {
    it('should call checkForUpdates for check_for_updates alarm', () => {
      const alarm = { name: 'check_for_updates' } as chrome.alarms.Alarm;
      chrome.alarms.onAlarm.callListeners(alarm);
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
      expect(checkForPendingTransactionsUpdate).not.toHaveBeenCalled();
      expect(mockMasterController.utils.setFiat).not.toHaveBeenCalled();
    });

    it('should call checkForPendingTransactionsUpdate for check_pending_transactions alarm', () => {
      const alarm = {
        name: 'check_pending_transactions',
      } as chrome.alarms.Alarm;
      chrome.alarms.onAlarm.callListeners(alarm);
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(checkForPendingTransactionsUpdate).toHaveBeenCalledTimes(1);
      expect(mockMasterController.utils.setFiat).not.toHaveBeenCalled();
    });

    it('should call setFiat for update_fiat_price alarm', () => {
      const alarm = { name: 'update_fiat_price' } as chrome.alarms.Alarm;
      chrome.alarms.onAlarm.callListeners(alarm);
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(checkForPendingTransactionsUpdate).not.toHaveBeenCalled();
      expect(mockMasterController.utils.setFiat).toHaveBeenCalledTimes(1);
    });

    it('should call setFiat for update_fiat_price_initial alarm', () => {
      const alarm = {
        name: 'update_fiat_price_initial',
      } as chrome.alarms.Alarm;
      chrome.alarms.onAlarm.callListeners(alarm);
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(checkForPendingTransactionsUpdate).not.toHaveBeenCalled();
      expect(mockMasterController.utils.setFiat).toHaveBeenCalledTimes(1);
    });
  });

  describe('onMessage Listener', () => {
    const sender = {} as chrome.runtime.MessageSender;
    const sendResponse = jest.fn();

    beforeEach(() => {
      sendResponse.mockClear();
    });

    it('should call dapp.setup for pw-msg-background/isInjected message', () => {
      const message = { type: 'pw-msg-background', action: 'isInjected' };
      chrome.runtime.onMessage.callListeners(message, sender, sendResponse);
      expect(mockMasterController.dapp.setup).toHaveBeenCalledWith(sender);
      expect(sendResponse).toHaveBeenCalledWith({ isInjected: true }); // Based on mocked store
    });

    it('should call handleLogout for lock_wallet message', () => {
      const message = { type: 'lock_wallet' };
      chrome.runtime.onMessage.callListeners(message, sender, sendResponse);
      expect(handleLogout).toHaveBeenCalledWith(mockMasterController);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('should call wallet.setActiveNetwork for changeNetwork message (Bitcoin-based)', () => {
      const message = {
        type: 'changeNetwork',
        data: { network: { chainId: 57 }, isBitcoinBased: true },
      };
      chrome.runtime.onMessage.callListeners(message, sender, sendResponse);
      expect(mockMasterController.wallet.setActiveNetwork).toHaveBeenCalledWith(
        message.data.network,
        'syscoin'
      );
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('should call wallet.setActiveNetwork for changeNetwork message (EVM)', () => {
      const message = {
        type: 'changeNetwork',
        data: { network: { chainId: 1 }, isBitcoinBased: false },
      };
      chrome.runtime.onMessage.callListeners(message, sender, sendResponse);
      expect(mockMasterController.wallet.setActiveNetwork).toHaveBeenCalledWith(
        message.data.network,
        'ethereum'
      );
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('should call startPolling for startPolling message', () => {
      const message = { type: 'startPolling' };
      chrome.runtime.onMessage.callListeners(message, sender, sendResponse);
      expect(startPolling).toHaveBeenCalledTimes(1);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('should dispatch setIsPolling and call startPendingTransactionsPolling for startPendingTransactionsPolling message', () => {
      const message = { type: 'startPendingTransactionsPolling' };
      chrome.runtime.onMessage.callListeners(message, sender, sendResponse);
      expect(store.dispatch).toHaveBeenCalledWith(setIsPolling(true));
      expect(startPendingTransactionsPolling).toHaveBeenCalledTimes(1);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });
});
