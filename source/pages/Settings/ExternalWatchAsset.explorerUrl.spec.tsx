/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { clearRpcCaches, getEthRpc } from '@sidhujag/sysweb3-network';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';

import { onMessage } from 'scripts/Background/controllers/message-handler';

import ExternalWatchAsset from './ExternalWatchAsset';

let mockState: any;
let mockQuery: any;
const TOKEN = '0x' + 'ab'.repeat(20);
const OWNER = '0x' + '11'.repeat(20);
const HOST = 'https://watchasset-explorer.synthetic.invalid';
const RPC = 'https://rpc.synthetic.invalid/readonly';
const mockPopup = jest.fn(async (options: any) => {
  mockQuery = {
    ...options.data,
    host: options.host,
    eventName: options.eventName,
  };
  return true;
});
const mockEmitter = jest.fn(async (methods: string[], args: any[]) => {
  if (methods.join('.') !== 'wallet.getAssetInfo')
    throw new Error('Mutation/signing/broadcast is denied by this test');
  expect(args[0]).toEqual(mockQuery.asset.options);
  expect(args[1]).toBe('ERC20');
  return {
    name: 'Synthetic reviewed token',
    symbol: 'SYN',
    decimals: 18,
    contractAddress: TOKEN,
    chainId: 1,
    balance: 0,
    tokenStandard: 'ERC-20',
  };
});

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('react-redux', () => ({ useSelector: (fn: any) => fn(mockState) }));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: { info: jest.fn(), error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('components/index', () => ({
  LoadingComponent: () => <div>Loading</div>,
  Button: ({ children, disabled, onClick, type }: any) => (
    <button disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  ),
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({
    wallet: { isUnlocked: () => true },
    dapp: {
      isConnected: () => true,
      get: () => ({ accountId: 0, accountType: 'HDAccount', host: HOST }),
      getAccount: () => mockState.vault.accounts.HDAccount[0],
    },
  }),
}));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({
    popupPromise: (options: any) => mockPopup(options),
  })
);
jest.mock('utils/security/blacklistService', () => ({
  blacklistService: {
    checkUrl: jest.fn(async () => ({ isBlacklisted: false })),
  },
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: () => {
    throw new Error('Approval mutation is denied by this test');
  },
}));

const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  clearRpcCaches();
  mockQuery = {};
  global.fetch = jest.fn(async (url: any, init: any) => {
    expect(String(url)).toBe(RPC);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    } as Response;
  });
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
  jest.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it.each([
  [
    'root URL',
    'https://explorer.synthetic.invalid/',
    'https://explorer.synthetic.invalid/address/' + TOKEN,
  ],
  [
    'path URL',
    'https://explorer.synthetic.invalid/public/',
    'https://explorer.synthetic.invalid/public/address/' + TOKEN,
  ],
  [
    'query URL admitted unchanged by the SDK',
    'https://explorer.synthetic.invalid/public/?view=compact/',
    'https://explorer.synthetic.invalid/public/address/' +
      TOKEN +
      '?view=compact/',
  ],
  [
    'query with SDK trailing-slash normalization',
    'https://explorer.synthetic.invalid/public/?view=compact',
    'https://explorer.synthetic.invalid/public/address/' +
      TOKEN +
      '?view=compact/',
  ],
  [
    'hash route',
    'https://explorer.synthetic.invalid/#/public/',
    'https://explorer.synthetic.invalid/#/public/address/' + TOKEN,
  ],
  [
    'hash route with outer and inner queries',
    'https://explorer.synthetic.invalid/?outer=1#/public/?inner=2/',
    'https://explorer.synthetic.invalid/?outer=1#/public/address/' +
      TOKEN +
      '?inner=2/',
  ],
  [
    'hashbang route',
    'https://explorer.synthetic.invalid/#!/public/',
    'https://explorer.synthetic.invalid/#!/public/address/' + TOKEN,
  ],
  [
    'hashbang route with outer and inner queries and an anchor',
    'https://explorer.synthetic.invalid/?outer=a%2Fb#!/public/?inner=x%2Fy#section/',
    'https://explorer.synthetic.invalid/?outer=a%2Fb#!/public/address/' +
      TOKEN +
      '?inner=x%2Fy#section/',
  ],
  [
    'ordinary fragment',
    'https://explorer.synthetic.invalid/public/#overview/',
    'https://explorer.synthetic.invalid/public/address/' + TOKEN + '#overview/',
  ],
  [
    'encoded path and query',
    'https://explorer.synthetic.invalid/public%20chain/?view=a%2Fb/',
    'https://explorer.synthetic.invalid/public%20chain/address/' +
      TOKEN +
      '?view=a%2Fb/',
  ],
])(
  'opens the actual reviewed contract from a %s',
  async (_label, explorer, expected) => {
    const result = await getEthRpc(
      { url: RPC, explorer, symbol: 'SYN', label: 'Synthetic EVM' } as any,
      false
    );
    const network = result.formattedNetwork;
    expect(network.explorer).toBe(
      explorer.endsWith('/') ? explorer : explorer + '/'
    );
    mockState = {
      vault: {
        isBitcoinBased: false,
        activeNetwork: network,
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          HDAccount: { 0: { id: 0, address: OWNER, xpub: 'public-fixture' } },
        },
        accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
      },
      vaultGlobal: {
        networkStatus: 'idle',
        activeSlip44: 60,
        networks: { ethereum: { 1: network } },
      },
      price: { fiat: { asset: 'usd' } },
      spamFilter: { config: { enabled: false }, dapps: {} },
    };
    const descriptor = {
      type: 'ERC20',
      options: { address: TOKEN, symbol: 'SYN', decimals: 18 },
    };
    expect(
      await onMessage(
        {
          type: 'METHOD_REQUEST',
          data: { method: 'wallet_watchAsset', params: [descriptor] },
        },
        {
          url: HOST + '/request',
          tab: { id: 50 },
        } as chrome.runtime.MessageSender
      )
    ).toBe(true);
    expect(mockPopup).toHaveBeenCalledTimes(1);
    expect(mockQuery).toEqual({
      host: HOST,
      eventName: 'wallet_watchAsset',
      asset: descriptor,
    });
    render(<ExternalWatchAsset />);
    await act(async () => undefined);
    expect(screen.getByText('Synthetic reviewed token')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: TOKEN }));
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(expected, '_blank');
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }
);
