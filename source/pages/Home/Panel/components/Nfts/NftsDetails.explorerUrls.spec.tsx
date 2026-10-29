/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { clearRpcCaches, getEthRpc } from '@sidhujag/sysweb3-network';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createStore } from 'redux';

import { NftsDetails } from './NftsDetails';

const CONTRACT = '0x' + 'ab'.repeat(20);
const OWNER = '0x' + '11'.repeat(20);
const RPC = 'https://rpc.synthetic.invalid/readonly';
const mockEmitter = jest.fn();
const originalFetch = global.fetch;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  // Keep the actual explorer hook available so this regression also fails
  // against the previous production implementation.
  ...jest.requireActual('hooks/useAdjustedExplorer'),
  useUtils: () => ({ alert: { info: jest.fn(), error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  LoadingOutlined: () => null,
  Icon: () => null,
}));
jest.mock('utils/index', () => jest.requireActual('utils/format'));

beforeEach(() => {
  jest.clearAllMocks();
  clearRpcCaches();
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
  mockEmitter.mockImplementation(async (methods: string[], args: any[]) => {
    expect(methods).toEqual(['wallet', 'fetchNftTokenIds']);
    expect(args).toEqual([CONTRACT, OWNER, 'ERC-721']);
    return JSON.parse(
      JSON.stringify({
        tokens: [{ tokenId: '7', balance: 1 }],
        hasMore: true,
        requiresManualEntry: false,
      })
    );
  });
  jest.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const bases = [
  ['root', 'https://explorer.synthetic.invalid/', '/'],
  ['subpath', 'https://explorer.synthetic.invalid/public/', '/public/'],
  [
    'SDK-admitted query',
    'https://explorer.synthetic.invalid/public/?view=compact',
    '/public/',
  ],
] as const;

const mountNetwork = async (network: any) => {
  const state = {
    vault: {
      activeNetwork: network,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { id: 0, address: OWNER } } },
    },
  };
  const store = createStore(() => state);
  render(
    <Provider store={store}>
      <MemoryRouter>
        <NftsDetails
          nftData={{
            contractAddress: CONTRACT,
            tokenStandard: 'ERC-721',
            name: 'Synthetic public collection',
            chainId: 1,
            balance: 2,
          }}
        />
      </MemoryRouter>
    </Provider>
  );
  await screen.findByRole('button', { name: '#7' });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
};

describe.each(bases)('%s explorer', (_label, explorer, prefix) => {
  const mount = async () => {
    const result = await getEthRpc(
      { url: RPC, explorer, symbol: 'SYN', label: 'Synthetic EVM' } as any,
      false
    );
    expect(result.formattedNetwork.explorer).toBe(explorer);
    expect(result.formattedNetwork.url).toBe(RPC);
    await mountNetwork(result.formattedNetwork);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  };

  it('preserves the contract route and saved query in the actual anchor', async () => {
    await mount();
    const href = (
      screen.getByRole('link', {
        name: 'home.viewOnExplorer',
      }) as HTMLAnchorElement
    ).href;
    const url = new URL(href);
    const expected = new URL(explorer);
    expected.pathname = prefix + 'address/' + CONTRACT;
    expect(href).toBe(expected.href);
    expect(url.pathname).toBe(prefix + 'address/' + CONTRACT);
    expect(url.search).toBe(new URL(explorer).search);
    expect(url.origin).toBe(new URL(explorer).origin);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('preserves the collection route and saved query on the native button', async () => {
    await mount();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'send.viewAllOnExplorer' })
    );
    expect(window.open).toHaveBeenCalledTimes(1);
    const [href, target, features] = (window.open as jest.Mock).mock.calls[0];
    const url = new URL(href);
    const expected = new URL(explorer);
    expected.pathname = prefix + 'token/' + CONTRACT;
    expect(href).toBe(expected.href);
    expect(url.pathname).toBe(prefix + 'token/' + CONTRACT);
    expect(url.search).toBe(new URL(explorer).search);
    expect(url.origin).toBe(new URL(explorer).origin);
    expect(target).toBe('_blank');
    expect(features).toBe('noopener, noreferrer');
  });
});

it.each(['contract', 'collection'])(
  'uses the existing RPC fallback for a missing optional %s explorer',
  async (resource) => {
    const network = {
      chainId: 1,
      url: RPC,
      apiUrl: 'https://api.synthetic.invalid/?module=readonly',
    };
    const originalNetwork = { ...network };
    await mountNetwork(network);
    const user = userEvent.setup();
    if (resource === 'collection') {
      await user.click(
        screen.getByRole('button', { name: 'send.viewAllOnExplorer' })
      );
      expect(window.open).toHaveBeenCalledWith(
        RPC + '/token/' + CONTRACT,
        '_blank',
        'noopener, noreferrer'
      );
    } else {
      expect(
        screen.getByRole('link', { name: 'home.viewOnExplorer' })
      ).toHaveAttribute('href', RPC + '/address/' + CONTRACT);
    }
    expect(network).toEqual(originalNetwork);
    expect(global.fetch).not.toHaveBeenCalled();
  }
);

it('keeps token selection while omitting explorer actions for an explicitly blank EVM explorer', async () => {
  await mountNetwork({
    kind: 'ethereum',
    url: RPC,
    explorer: RPC,
    explorerExplicitlyAbsent: true,
  });
  expect(screen.getByRole('button', { name: '#7' })).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'home.viewOnExplorer' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'send.viewAllOnExplorer' })
  ).toBeNull();
  expect(window.open).not.toHaveBeenCalled();
});
