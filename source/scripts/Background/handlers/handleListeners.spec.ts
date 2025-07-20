/* eslint-disable @typescript-eslint/no-empty-function */

// Mock the chrome object completely for this test
const chrome = {
  alarms: {
    onAlarm: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
      callListeners: jest.fn(),
      clearListeners: jest.fn(),
    },
    clear: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(),
  },
  runtime: {
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
      callListeners: jest.fn(),
      clearListeners: jest.fn(),
    },
    onConnect: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
      callListeners: jest.fn(),
      clearListeners: jest.fn(),
    },
    getContexts: jest.fn(),
  },
};

// Make it available globally
Object.defineProperty(global, 'chrome', {
  value: chrome,
  writable: true,
});

import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { checkForUpdates } from 'scripts/Background/handlers/handlePaliUpdates';
import {
  startPolling,
  getPollingInterval,
} from 'scripts/Background/utils/startPolling';

import { handleListeners, resetListenersFlag } from './handleListeners';

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
  // Mock network utility functions used in constants.ts
  getSyscoinUTXOMainnetNetwork: jest.fn(() => ({
    chainId: 57,
    url: 'https://blockbook.elint.services/',
    label: 'Syscoin Mainnet',
    default: true,
    currency: 'sys',
    slip44: 57,
    kind: 'syscoin',
    explorer: 'https://explorer.syscoin.org/',
  })),
  getBitcoinMainnetNetwork: jest.fn(() => ({
    chainId: 0,
    url: 'https://btc1.trezor.io/',
    label: 'Bitcoin',
    default: false,
    currency: 'btc',
    slip44: 0,
    kind: 'syscoin',
    explorer: 'https://btc1.trezor.io/',
  })),
  getDefaultUTXONetworks: jest.fn(() => ({})),
}));
// --- End keyring mock ---

// Mock dependencies
jest.mock('scripts/Background/handlers/handleLogout');
jest.mock('state/store', () => ({
  getState: jest.fn(() => ({
    vault: {
      isBitcoinBased: false,
    },
    vaultGlobal: {
      hasEthProperty: true, // Mock relevant state parts
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
  checkForUpdates: jest.fn().mockResolvedValue(true), // Return a resolved promise
}));

jest.mock('scripts/Background/utils/startPolling', () => ({
  startPolling: jest.fn().mockResolvedValue(undefined),
  getPollingInterval: jest.fn(),
}));

describe('Background: handleListeners', () => {
  beforeEach(() => {
    // Mock console.emoji which is used by the real code
    (console as any).emoji = jest.fn();

    // Reset the listeners initialization flag for testing
    resetListenersFlag();

    // Reset mocks before each test
    jest.clearAllMocks();

    // Clear our chrome mock call history
    chrome.alarms.onAlarm.addListener.mockClear();
    chrome.alarms.onAlarm.removeListener.mockClear();
    chrome.runtime.onMessage.addListener.mockClear();
    chrome.runtime.onMessage.removeListener.mockClear();
    chrome.runtime.onConnect.addListener.mockClear();
    chrome.alarms.clear.mockClear();

    // Mock getPollingInterval to return a predictable value
    (getPollingInterval as jest.Mock).mockReturnValue(5);

    // Initialize listeners with the mocked controller
    handleListeners(mockMasterController);
  });

  describe('onAlarm Listener', () => {
    it('should call checkForUpdates and startPolling for check_for_updates alarm', async () => {
      // Get the alarm listener that was registered
      const addListenerCalls = chrome.alarms.onAlarm.addListener.mock.calls;
      expect(addListenerCalls.length).toBe(1);
      const alarmListener = addListenerCalls[0][0];

      // Call the listener with a mock alarm
      const alarm = { name: 'check_for_updates' };
      alarmListener(alarm);

      // Wait for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should call checkForUpdates directly
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
      // Should also call startPolling to refresh the alarm
      expect(startPolling).toHaveBeenCalledTimes(1);
      // Should not call setFiat
      expect(mockMasterController.wallet.setFiat).not.toHaveBeenCalled();
    });

    it('should call setFiat for update_fiat_price_initial alarm', () => {
      // Get the alarm listener that was registered
      const addListenerCalls = chrome.alarms.onAlarm.addListener.mock.calls;
      expect(addListenerCalls.length).toBe(1);
      const alarmListener = addListenerCalls[0][0];

      // Call the listener with a mock alarm
      const alarm = {
        name: 'update_fiat_price_initial',
      };
      alarmListener(alarm);

      // Should call setFiat
      expect(mockMasterController.wallet.setFiat).toHaveBeenCalledTimes(1);
      // Should not call checkForUpdates or startPolling
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(startPolling).not.toHaveBeenCalled();
    });
  });

  describe('onMessage Listener', () => {
    const sender = {} as chrome.runtime.MessageSender;
    const sendResponse = jest.fn();

    beforeEach(() => {
      sendResponse.mockClear();
    });

    it('should call dapp.setup for pw-msg-background/isInjected message', () => {
      // Get the message listener that was registered
      const addListenerCalls = chrome.runtime.onMessage.addListener.mock.calls;
      expect(addListenerCalls.length).toBe(1);
      const messageListener = addListenerCalls[0][0];

      const message = { type: 'pw-msg-background', action: 'isInjected' };
      messageListener(message, sender, sendResponse);
      expect(mockMasterController.dapp.setup).toHaveBeenCalledWith(sender);
      expect(sendResponse).toHaveBeenCalledWith({ isInjected: true }); // Based on mocked store
    });

    it('should call handleLogout for lock_wallet message', () => {
      // Get the message listener that was registered
      const addListenerCalls = chrome.runtime.onMessage.addListener.mock.calls;
      expect(addListenerCalls.length).toBe(1);
      const messageListener = addListenerCalls[0][0];

      const message = { type: 'lock_wallet' };
      messageListener(message, sender, sendResponse);
      expect(handleLogout).toHaveBeenCalledWith(mockMasterController);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('should call wallet.setActiveNetwork for changeNetwork message (Bitcoin-based)', () => {
      // Get the message listener that was registered
      const addListenerCalls = chrome.runtime.onMessage.addListener.mock.calls;
      expect(addListenerCalls.length).toBe(1);
      const messageListener = addListenerCalls[0][0];

      const message = {
        type: 'changeNetwork',
        data: { network: { chainId: 57 }, isBitcoinBased: true },
      };
      messageListener(message, sender, sendResponse);
      expect(mockMasterController.wallet.setActiveNetwork).toHaveBeenCalledWith(
        message.data.network
      );
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('should call wallet.setActiveNetwork for changeNetwork message (EVM)', () => {
      // Get the message listener that was registered
      const addListenerCalls = chrome.runtime.onMessage.addListener.mock.calls;
      expect(addListenerCalls.length).toBe(1);
      const messageListener = addListenerCalls[0][0];

      const message = {
        type: 'changeNetwork',
        data: { network: { chainId: 1 }, isBitcoinBased: false },
      };
      messageListener(message, sender, sendResponse);
      expect(mockMasterController.wallet.setActiveNetwork).toHaveBeenCalledWith(
        message.data.network
      );
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });
});
