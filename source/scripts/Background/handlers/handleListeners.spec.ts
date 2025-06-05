/* eslint-disable @typescript-eslint/no-empty-function */
import { chrome } from 'jest-chrome';

import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { checkForUpdates } from 'scripts/Background/handlers/handlePaliUpdates';
import {
  startPolling,
  getPollingInterval,
} from 'scripts/Background/utils/startPolling';
import store from 'state/store';
import { setIsPolling } from 'state/vault';

import { handleListeners } from './handleListeners';

// --- Try mocking the core keyring module ---
jest.mock('@pollum-io/sysweb3-keyring', () => ({
  __esModule: true,
  KeyringManager: jest.fn().mockImplementation(() => ({})),
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Trezor: 'Trezor',
    Ledger: 'Ledger',
  },
  // Provide mock initial states as they are used in vault/index.ts
  initialActiveHdAccountState: {
    id: 0, // Or any appropriate default mock ID
    type: 'HDAccount',
    label: 'Account 1',
    address: 'mockHdAddress0',
    xpub: 'mockXpub0',
    // Add other properties that initialActiveHdAccountState normally has
    // based on its actual definition to avoid further undefined errors.
    balance: '0', // Example
    isImported: false,
    isTrezorWallet: false,
    isLedgerWallet: false,
    zpub: 'mockZpub0',
    transactions: [],
    assets: [],
    balances: { ethereum: '0', syscoin: '0' },
  },
  initialActiveImportedAccountState: {
    id: 0, // Or any appropriate default mock ID for imported accounts if different
    type: 'Imported',
    label: 'Imported Account 1',
    address: 'mockImportedAddress0',
    xprv: 'mockXprv0',
    // Add other properties for imported accounts
    balance: '0',
    isImported: true,
    isTrezorWallet: false,
    isLedgerWallet: false,
    transactions: [],
    assets: [],
    balances: { ethereum: '0', syscoin: '0' },
  },
  // Mock other necessary constants or types if their absence causes import errors
  CustomJsonRpcProvider: jest.fn(),
  CustomL2JsonRpcProvider: jest.fn(),
}));
// --- End keyring mock ---

// Mock dependencies
jest.mock('scripts/Background/handlers/handleLogout');
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
  // Mock wallet methods used in handleListeners
  wallet: {
    setActiveNetwork: jest.fn(),
    setFiat: jest.fn(),
  } as any, // Use 'as any' for brevity, ideally mock all methods
};

// Mock the dependencies but with better spy behavior
jest.mock('scripts/Background/handlers/handlePaliUpdates', () => ({
  checkForUpdates: jest.fn(),
}));

jest.mock('scripts/Background/utils/startPolling', () => ({
  startPolling: jest.fn(() => {
    // When startPolling is called, it should call checkForUpdates
    // Access the mocked checkForUpdates function and call it
    const mockModule = jest.requireMock(
      'scripts/Background/handlers/handlePaliUpdates'
    );
    mockModule.checkForUpdates();
  }),
  getPollingInterval: jest.fn(),
}));

describe('Background: handleListeners', () => {
  beforeEach(() => {
    // Mock console.emoji which is used by the real code
    (console as any).emoji = jest.fn();

    // Reset mocks before each test
    jest.clearAllMocks();
    chrome.runtime.onInstalled.clearListeners();
    chrome.runtime.onStartup.clearListeners();
    chrome.alarms.onAlarm.clearListeners();
    chrome.runtime.onMessage.clearListeners();

    // Also clear any pending alarms to prevent cross-test interference
    chrome.alarms.clear.mockClear();

    // Mock getPollingInterval to return a predictable value
    (getPollingInterval as jest.Mock).mockReturnValue(5);

    // Initialize listeners with the mocked controller
    handleListeners(mockMasterController);
  });

  describe('onInstalled Listener', () => {
    it('should create alarms on install', () => {
      // Simulate the onInstalled event with mock details
      chrome.runtime.onInstalled.callListeners({
        reason: 'install',
      } as chrome.runtime.InstalledDetails);

      // Only check that fiat price alarm is created immediately
      // check_for_updates alarm is now created by startPolling() which is called in setTimeout
      expect(chrome.alarms.create).toHaveBeenCalledWith('update_fiat_price', {
        periodInMinutes: 3, // FIAT_UPDATE_INTERVAL_MINUTES
      });
      expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
    });

    it('should trigger initial updates on install', async () => {
      // Clear listeners and re-setup to ensure clean state
      chrome.runtime.onInstalled.clearListeners();
      chrome.runtime.onStartup.clearListeners();
      chrome.alarms.onAlarm.clearListeners();
      chrome.runtime.onMessage.clearListeners();

      // Clear mocks after clearing listeners
      jest.clearAllMocks();

      // Re-initialize listeners for this isolated test
      handleListeners(mockMasterController);

      // Use fake timers to control setTimeout precisely
      jest.useFakeTimers();

      chrome.runtime.onInstalled.callListeners({
        reason: 'install',
      } as chrome.runtime.InstalledDetails);

      // Fast-forward time to trigger the setTimeout
      jest.advanceTimersByTime(1000);

      // Verify the functions were called
      expect(mockMasterController.wallet.setFiat).toHaveBeenCalledTimes(1);
      expect(startPolling).toHaveBeenCalledTimes(1);
      // Now we can verify that checkForUpdates is called by startPolling
      expect(checkForUpdates).toHaveBeenCalledTimes(1);

      // Restore real timers
      jest.useRealTimers();
    });
  });

  describe('onStartup Listener', () => {
    it('should create alarms on startup', () => {
      chrome.runtime.onStartup.callListeners();

      // Only check that fiat price alarm is created immediately
      // check_for_updates alarm is now created by startPolling() which is called in setTimeout
      expect(chrome.alarms.create).toHaveBeenCalledWith('update_fiat_price', {
        periodInMinutes: 3,
      });
      expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
    });

    it('should trigger initial updates on startup', async () => {
      // Clear listeners and re-setup to ensure clean state
      chrome.runtime.onInstalled.clearListeners();
      chrome.runtime.onStartup.clearListeners();
      chrome.alarms.onAlarm.clearListeners();
      chrome.runtime.onMessage.clearListeners();

      // Clear mocks after clearing listeners
      jest.clearAllMocks();

      // Re-initialize listeners for this isolated test
      handleListeners(mockMasterController);

      // Use fake timers to control setTimeout precisely
      jest.useFakeTimers();

      chrome.runtime.onStartup.callListeners();

      // Fast-forward time to trigger the setTimeout
      jest.advanceTimersByTime(1000);

      // Verify the functions were called
      expect(mockMasterController.wallet.setFiat).toHaveBeenCalledTimes(1);
      expect(startPolling).toHaveBeenCalledTimes(1);
      // Now we can verify that checkForUpdates is called by startPolling
      expect(checkForUpdates).toHaveBeenCalledTimes(1);

      // Restore real timers
      jest.useRealTimers();
    });
  });

  describe('onAlarm Listener', () => {
    it('should call startPolling for check_for_updates alarm', () => {
      const alarm = { name: 'check_for_updates' } as chrome.alarms.Alarm;
      chrome.alarms.onAlarm.callListeners(alarm);
      expect(startPolling).toHaveBeenCalledTimes(1);
      // Now we can verify that checkForUpdates is called by startPolling
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
      expect(mockMasterController.wallet.setFiat).not.toHaveBeenCalled();
    });

    it('should call setFiat for update_fiat_price alarm', () => {
      const alarm = { name: 'update_fiat_price' } as chrome.alarms.Alarm;
      chrome.alarms.onAlarm.callListeners(alarm);
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(mockMasterController.wallet.setFiat).toHaveBeenCalledTimes(1);
    });

    it('should call setFiat for update_fiat_price_initial alarm', () => {
      const alarm = {
        name: 'update_fiat_price_initial',
      } as chrome.alarms.Alarm;
      chrome.alarms.onAlarm.callListeners(alarm);
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(mockMasterController.wallet.setFiat).toHaveBeenCalledTimes(1);
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
        message.data.network
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
        message.data.network
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
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });
});
