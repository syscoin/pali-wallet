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

import { EthProvider } from 'scripts/Provider/EthProvider';

import {
  clearProviderCache,
  EthMethodHandler,
  MAX_PROVIDER_CACHE_ENTRIES,
  WalletMethodHandler,
} from './method-handlers';
import { getMethodConfig } from './method-registry';
import { popupPromise } from './popup-promise';
import { requestCoordinator } from './request-pipeline';
import {
  generateWalletBundleId,
  reserveSendCallsBundle,
} from './sendCallsBundles';
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

describe('Ethereum RPC result preservation', () => {
  const unrestricted = jest.fn();
  const restricted = jest.fn();
  const rpcContext = (method: string) => ({
    ...makeContext(method, 'rpc.example', MethodHandlerType.Eth),
    methodConfig: getMethodConfig(method)!,
    originalRequest: {
      ...makeContext(method, 'rpc.example', MethodHandlerType.Eth)
        .originalRequest,
      params: [],
    },
  });

  beforeEach(() => {
    unrestricted.mockReset();
    restricted.mockReset();
    getControllerMock.mockReturnValue({ dapp: {}, wallet: {} });
    getStateMock.mockReturnValue({
      vault: { activeNetwork: { chainId: 57 }, isBitcoinBased: false },
    });
    (EthProvider as jest.Mock).mockReturnValue({
      unrestrictedRPCMethods: unrestricted,
      restrictedRPCMethods: restricted,
    });
  });

  afterEach(() => (EthProvider as jest.Mock).mockReset());

  it.each([
    ['eth_syncing', false],
    ['net_listening', false],
    ['eth_uninstallFilter', false],
    ['net_peerCount', 0],
    ['web3_clientVersion', ''],
    ['eth_getTransactionReceipt', null],
  ])(
    'returns %s result %p without retrying another RPC branch',
    async (method, value) => {
      unrestricted.mockResolvedValue(value);
      restricted.mockResolvedValue(value);

      await expect(
        new EthMethodHandler().handle(rpcContext(method as string))
      ).resolves.toBe(value);
      expect(unrestricted).toHaveBeenCalledTimes(1);
      expect(restricted).not.toHaveBeenCalled();
    }
  );

  it('keeps an undefined RPC result unsupported without issuing a second request', async () => {
    await expect(
      new EthMethodHandler().handle(rpcContext('eth_syncing'))
    ).rejects.toMatchObject({ code: -32601 });
    expect(unrestricted).toHaveBeenCalledTimes(1);
    expect(restricted).not.toHaveBeenCalled();
  });

  it('routes connected-only methods directly to their registered RPC branch', async () => {
    restricted.mockResolvedValue('0xtransaction');
    await expect(
      new EthMethodHandler().handle(rpcContext('eth_sendRawTransaction'))
    ).resolves.toBe('0xtransaction');
    expect(unrestricted).not.toHaveBeenCalled();
    expect(restricted).toHaveBeenCalledTimes(1);
  });

  it.each(['eth_syncing', 'eth_sendRawTransaction'])(
    'preserves the original %s RPC error',
    async (method) => {
      const error = {
        code: -32005,
        message: 'Request limit exceeded',
        data: { retryAfter: 1 },
      };
      (method === 'eth_syncing' ? unrestricted : restricted).mockRejectedValue(
        error
      );
      await expect(
        new EthMethodHandler().handle(rpcContext(method))
      ).rejects.toBe(error);
    }
  );
});

describe('standard wallet_getCapabilities', () => {
  const getAccount = jest.fn();
  const capabilityContext = (params?: any[]) => {
    const context = makeContext(
      'wallet_getCapabilities',
      'https://capabilities.example',
      MethodHandlerType.Wallet
    );
    context.methodConfig = getMethodConfig('wallet_getCapabilities')!;
    context.originalRequest.params = params;
    return context;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getAccount.mockReturnValue(connectedAccount);
    getControllerMock.mockReturnValue({ dapp: { getAccount }, wallet: {} });
    getStateMock.mockReturnValue({
      vault: { activeNetwork: { chainId: 1 }, isBitcoinBased: false },
      vaultGlobal: { networks: { ethereum: {} } },
    });
  });

  it.each<[any[] | undefined]>([[undefined], [[]], [[CONNECTED_ADDRESS]]])(
    'keeps current-chain capability queries compatible: %p',
    async (params) => {
      await expect(
        new WalletMethodHandler().handle(capabilityContext(params))
      ).resolves.toEqual({ '0x1': { atomic: { status: 'unsupported' } } });
    }
  );

  it.each([
    [[], {}],
    [['0x2'], {}],
    [['0x2', '0x1'], { '0x1': { atomic: { status: 'unsupported' } } }],
    [['0x01'], { '0x1': { atomic: { status: 'unsupported' } } }],
  ])(
    'filters capabilities to the requested chains %p',
    async (chains, result) => {
      await expect(
        new WalletMethodHandler().handle(
          capabilityContext([CONNECTED_ADDRESS, chains])
        )
      ).resolves.toEqual(result);
    }
  );

  it("does not report another account's capabilities", async () => {
    await expect(
      new WalletMethodHandler().handle(capabilityContext([ACTIVE_ADDRESS]))
    ).rejects.toMatchObject({ code: 4100 });
  });

  it('rejects a missing authorized account instead of falling back to active state', async () => {
    getAccount.mockReturnValue(null);
    await expect(
      new WalletMethodHandler().handle(capabilityContext())
    ).rejects.toMatchObject({ code: 4100 });
  });

  it.each([
    [null],
    ['not-an-address'],
    [CONNECTED_ADDRESS, null],
    [CONNECTED_ADDRESS, '0x1'],
    [CONNECTED_ADDRESS, ['invalid']],
    [CONNECTED_ADDRESS, ['0x']],
    [CONNECTED_ADDRESS, [], 'extra'],
  ])('rejects malformed capability params %p', async (...params) => {
    await expect(
      new WalletMethodHandler().handle(capabilityContext(params))
    ).rejects.toMatchObject({ code: -32602 });
  });

  it.each([
    [1, 'supported'],
    [2, 'unsupported'],
  ])(
    'binds atomic support to the connected smart-account chain %s',
    async (chainId, status) => {
      getAccount.mockReturnValue({
        ...connectedAccount,
        isSmartAccount: true,
        smartAccount: { chainId },
      });
      await expect(
        new WalletMethodHandler().handle(capabilityContext([CONNECTED_ADDRESS]))
      ).resolves.toEqual({ '0x1': { atomic: { status } } });
    }
  );
});

describe('wallet_sendCalls capability admission', () => {
  const makeSendCallsContext = (changes: Record<string, unknown>) => {
    const context = makeContext(
      'wallet_sendCalls',
      'https://batch.example',
      MethodHandlerType.Wallet
    );
    context.methodConfig = getMethodConfig('wallet_sendCalls')!;
    context.originalRequest.params = [
      {
        version: '1.0',
        from: CONNECTED_ADDRESS,
        chainId: '0x1',
        atomicRequired: false,
        calls: [{ to: ACTIVE_ADDRESS, value: '0x0' }],
        ...changes,
      },
    ];
    return context;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getControllerMock.mockReturnValue({
      dapp: {
        getAccount: () => connectedAccount,
        get: () => ({ accountId: 1, accountType: 'HDAccount' }),
      },
      wallet: { getWalletSessionGeneration: () => 1 },
    });
    getStateMock.mockReturnValue({
      vault: { activeNetwork: { chainId: 1, url: 'https://rpc.example' } },
      vaultGlobal: { activeSlip44: 60 },
    });
    (generateWalletBundleId as jest.Mock).mockReturnValue('0x1234');
    (reserveSendCallsBundle as jest.Mock).mockResolvedValue(true);
    (requestCoordinator.coordinatePopupRequest as jest.Mock).mockImplementation(
      async (_context, openPopup) => openPopup()
    );
    (popupPromise as jest.Mock).mockResolvedValue({ id: '0x1234' });
  });

  it.each([
    { capabilities: { paymasterService: { url: 'https://example.test' } } },
    { capabilities: { unknown: { optional: false } } },
    { calls: [{ to: ACTIVE_ADDRESS, capabilities: { unknown: {} } }] },
    {
      calls: [
        { to: ACTIVE_ADDRESS, capabilities: { unknown: { optional: false } } },
      ],
    },
  ])(
    'rejects unsupported required capabilities before reservation or approval: %p',
    async (changes) => {
      await expect(
        new WalletMethodHandler().handle(makeSendCallsContext(changes))
      ).rejects.toMatchObject({ code: 5700 });
      expect(reserveSendCallsBundle).not.toHaveBeenCalled();
      expect(requestCoordinator.coordinatePopupRequest).not.toHaveBeenCalled();
      expect(popupPromise).not.toHaveBeenCalled();
    }
  );

  it.each([
    { capabilities: null },
    { capabilities: [] },
    { capabilities: { unknown: null } },
    { capabilities: { unknown: { optional: 'true' } } },
    { calls: [{ to: ACTIVE_ADDRESS, capabilities: false }] },
  ])(
    'rejects malformed capabilities with a numeric RPC error: %p',
    async (changes) => {
      await expect(
        new WalletMethodHandler().handle(makeSendCallsContext(changes))
      ).rejects.toMatchObject({ code: -32602 });
      expect(reserveSendCallsBundle).not.toHaveBeenCalled();
      expect(popupPromise).not.toHaveBeenCalled();
    }
  );

  it.each([
    {},
    { version: '2.0.0' },
    { capabilities: {} },
    {
      capabilities: {
        paymasterService: { optional: true, url: 'https://example.test' },
      },
    },
    {
      calls: [
        { to: ACTIVE_ADDRESS, capabilities: { unknown: { optional: true } } },
      ],
    },
  ])(
    'retains existing batch approval when no unsupported capability is required: %p',
    async (changes) => {
      await expect(
        new WalletMethodHandler().handle(makeSendCallsContext(changes))
      ).resolves.toEqual({ id: '0x1234' });
      expect(reserveSendCallsBundle).toHaveBeenCalledTimes(1);
      expect(popupPromise).toHaveBeenCalledTimes(1);
      expect(popupPromise).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining(changes),
        })
      );
    }
  );
});

describe('standard wallet_revokePermissions', () => {
  const host = 'https://revoking.example';
  const disconnect = jest.fn();

  const revokeContext = (
    permissions: Record<string, unknown> = { eth_accounts: {} }
  ) => {
    const context = makeContext(
      'wallet_revokePermissions',
      host,
      MethodHandlerType.Wallet
    );
    context.methodConfig = getMethodConfig('wallet_revokePermissions')!;
    context.originalRequest.params = [permissions];
    return context;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    disconnect.mockResolvedValue(undefined);
    getControllerMock.mockReturnValue({
      dapp: { getAccount: jest.fn(() => null), disconnect },
      wallet: {},
    });
    getStateMock.mockReturnValue({
      vault: {
        activeNetwork: { chainId: 57057, url: 'https://rpc.example' },
        isBitcoinBased: false,
      },
      vaultGlobal: { networks: { ethereum: {} } },
    });
  });

  it('allows an absent connection and requests idempotent error-aware removal', async () => {
    const context = revokeContext();
    expect(context.methodConfig.requiresConnection).toBe(false);
    await expect(new WalletMethodHandler().handle(context)).resolves.toBeNull();
    expect(disconnect).toHaveBeenCalledWith(host, true, {
      allowAlreadyDisconnected: true,
      propagateErrors: true,
    });
  });

  it('does not turn a real disconnect failure into success', async () => {
    const failure = new Error('Storage unavailable');
    disconnect.mockRejectedValueOnce(failure);
    await expect(
      new WalletMethodHandler().handle(revokeContext())
    ).rejects.toBe(failure);
  });

  it('keeps an empty permission request a no-op', async () => {
    await expect(
      new WalletMethodHandler().handle(revokeContext({}))
    ).resolves.toBeNull();
    expect(disconnect).not.toHaveBeenCalled();
  });
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

  it('does not expose a connected xpub from provider initialization while locked', async () => {
    const state = getStateMock();
    state.vault.isBitcoinBased = true;
    getStateMock.mockReturnValue(state);
    isUnlocked.mockReturnValue(false);
    getAccount.mockReturnValue(connectedAccount);
    const result = await new WalletMethodHandler().handle(
      makeContext(
        'wallet_getSysProviderState',
        'https://connected.example',
        MethodHandlerType.Wallet
      )
    );
    expect(result.accounts).toEqual([]);
    expect(result.xpub).toBeNull();
    isUnlocked.mockReturnValue(true);
  });

  it.each([
    'wallet_getAccount',
    'wallet_getPublicKey',
    'wallet_getAddress',
    'wallet_getBalance',
  ])('does not expose %s while locked', async (method) => {
    isUnlocked.mockReturnValue(false);
    getAccount.mockReturnValue(connectedAccount);
    await expect(
      new WalletMethodHandler().handle(
        makeContext(
          method,
          'https://connected.example',
          MethodHandlerType.Wallet
        )
      )
    ).resolves.toBeNull();
    isUnlocked.mockReturnValue(true);
  });

  it('does not fetch asset metadata from a page-selected backend URL', async () => {
    const state = getStateMock();
    state.vault.isBitcoinBased = true;
    const fetchMetadata = jest.fn().mockResolvedValue({ symbol: 'SPT' });
    getControllerMock().wallet.getSysAssetMetadata = fetchMetadata;
    const context = makeContext(
      'wallet_getSysAssetMetadata',
      'https://unconnected.example',
      MethodHandlerType.Wallet
    );
    context.originalRequest.params = ['123', 'https://localhost/private?path='];
    await expect(
      new WalletMethodHandler().handle(context)
    ).rejects.toMatchObject({ code: -32602 });
    expect(fetchMetadata).not.toHaveBeenCalled();
    context.originalRequest.params = ['123', 'https://rpc.example/'];
    await expect(new WalletMethodHandler().handle(context)).resolves.toEqual({
      symbol: 'SPT',
    });
    expect(fetchMetadata).toHaveBeenCalledWith('123', 'https://rpc.example');
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

  it.each(['lock', 'revocation'])(
    'rechecks local eth_accounts disclosure after %s without falling through to RPC',
    async (change) => {
      const context = makeContext(
        'eth_accounts',
        'https://connected.example',
        MethodHandlerType.Eth
      );
      context.methodConfig = getMethodConfig('eth_accounts')!;
      const handler = new EthMethodHandler();
      isUnlocked.mockReturnValue(true);
      getAccount.mockReturnValue(connectedAccount);
      await expect(handler.handle(context)).resolves.toEqual([
        CONNECTED_ADDRESS.toLowerCase(),
      ]);

      if (change === 'lock') isUnlocked.mockReturnValue(false);
      else getAccount.mockReturnValue(null);
      await expect(handler.handle(context)).resolves.toEqual([]);

      isUnlocked.mockReturnValue(true);
      getAccount.mockReturnValue(connectedAccount);
      await expect(handler.handle(context)).resolves.toEqual([
        CONNECTED_ADDRESS.toLowerCase(),
      ]);
      expect(EthProvider).not.toHaveBeenCalled();
    }
  );

  it('bounds the host-scoped provider cache and evicts the least recently used entry', async () => {
    getAccount.mockReturnValue(connectedAccount);
    const handler = new EthMethodHandler();
    const requestAccounts = (host: string) =>
      handler.handle(
        makeContext('eth_accounts', host, MethodHandlerType.Eth, 'accounts')
      );

    for (let index = 0; index < MAX_PROVIDER_CACHE_ENTRIES; index += 1) {
      await requestAccounts(`host-${index}.example`);
    }
    expect(getAccount).toHaveBeenCalledTimes(MAX_PROVIDER_CACHE_ENTRIES);

    // Refresh host 0, then insert one more host. Host 1 is now the LRU entry.
    await requestAccounts('host-0.example');
    await requestAccounts('host-overflow.example');
    await requestAccounts('host-0.example');
    expect(getAccount).toHaveBeenCalledTimes(MAX_PROVIDER_CACHE_ENTRIES + 1);

    await requestAccounts('host-1.example');
    expect(getAccount).toHaveBeenCalledTimes(MAX_PROVIDER_CACHE_ENTRIES + 2);
  });
});
