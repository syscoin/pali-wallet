const getControllerMock = jest.fn();
const getStateMock = jest.fn();

jest.mock('scripts/Background', () => ({
  getController: () => getControllerMock(),
}));

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => getStateMock(),
  },
}));

jest.mock('scripts/Provider/EthProvider', () => ({
  EthProvider: jest.fn(),
}));

jest.mock('scripts/Provider/SysProvider', () => ({
  SysProvider: jest.fn(),
}));

jest.mock('./popup-promise', () => ({
  popupPromise: jest.fn(),
}));

jest.mock('./request-pipeline', () => ({
  requestCoordinator: {
    coordinatePopupRequest: jest.fn(),
  },
}));

jest.mock('./sendCallsBundles', () => ({
  generateWalletBundleId: jest.fn(),
  isValidAppProvidedBundleId: jest.fn(),
  releaseSendCallsBundleReservation: jest.fn(),
  reserveSendCallsBundle: jest.fn(),
  resolveCallsStatus: jest.fn(),
}));

import {
  clearProviderCache,
  EthMethodHandler,
  WalletMethodHandler,
} from './method-handlers';
import {
  IEnhancedRequestContext,
  MethodHandlerType,
  NetworkEnforcement,
  NetworkPreference,
} from './types';

const ACTIVE_ADDRESS = '0x1111111111111111111111111111111111111111';
const CONNECTED_ADDRESS = '0x2222222222222222222222222222222222222222';

const activeAccount = {
  address: ACTIVE_ADDRESS,
  id: 0,
  type: 'HDAccount',
  xpub: 'active-xpub',
};

const connectedAccount = {
  address: CONNECTED_ADDRESS,
  id: 1,
  type: 'HDAccount',
  xpub: 'connected-xpub',
};

const activeTokens = [{ balance: '100', token: 'active-token' }];
const connectedTokens = [{ balance: '200', token: 'connected-token' }];

const makeContext = (
  method: string,
  host: string,
  handlerType: MethodHandlerType,
  cacheKey?: string
): IEnhancedRequestContext => ({
  methodConfig: {
    allowHardwareWallet: true,
    cacheKey,
    cacheTTL: cacheKey ? 10_000 : undefined,
    handlerType,
    hasPopup: false,
    name: method,
    networkEnforcement: NetworkEnforcement.Never,
    networkPreference: NetworkPreference.Any,
    requiresAuth: false,
    requiresConnection: false,
    requiresTabId: true,
  },
  originalRequest: {
    host,
    method,
    sender: { tab: { id: 1 } } as chrome.runtime.MessageSender,
    type: 'METHOD_REQUEST',
  },
});

describe('origin-scoped provider data', () => {
  const getAccount = jest.fn();
  const getDapp = jest.fn();
  const isUnlocked = jest.fn(() => true);

  beforeEach(() => {
    jest.clearAllMocks();
    clearProviderCache();

    getControllerMock.mockReturnValue({
      dapp: {
        get: getDapp,
        getAccount,
      },
      wallet: {
        isUnlocked,
      },
    });

    getStateMock.mockReturnValue({
      vault: {
        accountAssets: {
          HDAccount: {
            0: activeTokens,
            1: connectedTokens,
          },
        },
        accounts: {
          HDAccount: {
            0: activeAccount,
            1: connectedAccount,
          },
        },
        activeAccount: { id: 0, type: 'HDAccount' },
        activeNetwork: {
          chainId: 1,
          url: 'https://rpc.example',
        },
        isBitcoinBased: false,
      },
      vaultGlobal: {
        networks: { ethereum: {} },
      },
    });
  });

  it('does not expose the active account during provider initialization for an unconnected origin', async () => {
    getAccount.mockReturnValue(null);
    getDapp.mockReturnValue(null);

    const result = await new WalletMethodHandler().handle(
      makeContext(
        'wallet_getProviderState',
        'unconnected.example',
        MethodHandlerType.Wallet,
        'providerState'
      )
    );

    expect(result.accounts).toEqual([]);
  });

  it('does not expose the active UTXO account during provider initialization for an unconnected origin', async () => {
    const state = getStateMock();
    state.vault.isBitcoinBased = true;
    getStateMock.mockReturnValue(state);
    getAccount.mockReturnValue(null);
    getDapp.mockReturnValue(null);

    const result = await new WalletMethodHandler().handle(
      makeContext(
        'wallet_getSysProviderState',
        'unconnected.example',
        MethodHandlerType.Wallet,
        'sysProviderState'
      )
    );

    expect(result.accounts).toEqual([]);
    expect(result.xpub).toBeNull();
  });

  it('returns assets for the origin-connected account, not the globally active account', async () => {
    getAccount.mockReturnValue(connectedAccount);
    getDapp.mockReturnValue({ accountId: 1, accountType: 'HDAccount' });

    const result = await new WalletMethodHandler().handle(
      makeContext(
        'wallet_getTokens',
        'connected.example',
        MethodHandlerType.Wallet
      )
    );

    expect(result).toEqual(connectedTokens);
  });

  it('returns no assets to an unconnected origin', async () => {
    getAccount.mockReturnValue(null);
    getDapp.mockReturnValue(null);

    const result = await new WalletMethodHandler().handle(
      makeContext(
        'wallet_getTokens',
        'unconnected.example',
        MethodHandlerType.Wallet
      )
    );

    expect(result).toEqual([]);
  });

  it('returns no assets while the wallet is locked without prompting', async () => {
    isUnlocked.mockReturnValueOnce(false);
    getAccount.mockReturnValue(connectedAccount);
    getDapp.mockReturnValue({ accountId: 1, accountType: 'HDAccount' });

    const result = await new WalletMethodHandler().handle(
      makeContext(
        'wallet_getTokens',
        'connected.example',
        MethodHandlerType.Wallet
      )
    );

    expect(result).toEqual([]);
  });

  it('does not reuse a connected origin eth_accounts cache entry for another origin', async () => {
    getAccount.mockImplementation((host: string) =>
      host === 'connected.example' ? connectedAccount : null
    );

    const handler = new EthMethodHandler();
    const connectedResult = await handler.handle(
      makeContext(
        'eth_accounts',
        'connected.example',
        MethodHandlerType.Eth,
        'accounts'
      )
    );
    const unconnectedResult = await handler.handle(
      makeContext(
        'eth_accounts',
        'unconnected.example',
        MethodHandlerType.Eth,
        'accounts'
      )
    );

    expect(connectedResult).toEqual([CONNECTED_ADDRESS.toLowerCase()]);
    expect(unconnectedResult).toEqual([]);
  });
});
