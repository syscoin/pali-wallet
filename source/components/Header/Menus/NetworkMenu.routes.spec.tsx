/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { getWalletNavigationScope, navigateBack } from 'utils/navigationState';

import { NetworkMenu } from './NetworkMenu';

const mockState = {
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { address: '0xabc', xpub: 'public' } } },
    activeNetwork: {
      chainId: 1,
      kind: 'ethereum',
      url: 'https://rpc.test',
      label: 'Ethereum',
    },
    isBitcoinBased: false,
  },
  vaultGlobal: {
    advancedSettings: { refresh: false },
    networkStatus: 'idle',
    networks: { syscoin: {}, ethereum: {} },
  },
  dapp: { dapps: {} },
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  BtcIconSvg: () => null,
  EthIconSvg: () => null,
  WhiteSuccessIconSvg: () => null,
  NetworkIconSvg: () => null,
  EditIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => null,
}));

let location: ReturnType<typeof useLocation>;
const NavigationObserver = () => {
  location = useLocation();
  return null;
};
const SettingsDestination = () => {
  const currentLocation = useLocation();
  const navigate = useNavigate();
  return (
    <button onClick={() => navigateBack(navigate, currentLocation)}>
      Back
    </button>
  );
};

it.each([
  ['networkMenu.noConnected', '/settings/networks/connected-sites', true],
  ['networkMenu.trustedSites', '/settings/networks/trusted-sites', true],
  ['networkMenu.customRpc', '/settings/networks/custom-rpc', true],
  ['networkMenu.manageNetworks', '/settings/networks/edit', false],
] as const)(
  'opens %s with its exact route payload and returns to the saved asset view',
  async (label, target, fromMenu) => {
    const user = userEvent.setup();
    const walletScope = getWalletNavigationScope();
    const homeAssets = {
      scope: 'asset-view',
      value: {
        isCoinSelected: false,
        searchValue: 'NFT',
        sortByValue: 'Balance',
        tokensVisibleCount: 50,
        nftsVisibleCount: 100,
      },
    };
    const parentContext = {
      returnRoute: '/home/smart-account',
      walletScope,
    };
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/home',
            search: '?tab=assets',
            hash: '#nfts',
            state: { homeAssets, walletScope, returnContext: parentContext },
          },
        ]}
      >
        <NavigationObserver />
        <Routes>
          <Route path="/home" element={<NetworkMenu />} />
          <Route
            path="/settings/networks/*"
            element={<SettingsDestination />}
          />
        </Routes>
      </MemoryRouter>
    );
    await user.click(screen.getByRole('button', { name: /Ethereum/ }));
    await user.click(screen.getByRole('menuitem', { name: label }));
    expect(location.pathname).toBe(target);
    expect(location.search).toBe('');
    expect(location.hash).toBe('');
    expect(Object.keys(location.state).sort()).toEqual(
      (fromMenu
        ? ['fromMenu', 'returnContext', 'walletScope']
        : ['returnContext', 'walletScope']
      ).sort()
    );
    expect(location.state.fromMenu).toBe(fromMenu ? true : undefined);
    expect(location.state.walletScope).toEqual(walletScope);
    expect(location.state.returnContext).toEqual({
      returnRoute: '/home?tab=assets#nfts',
      state: { homeAssets },
      tab: undefined,
      scrollPosition: 0,
      scrollPositions: {},
      walletScope,
      returnContext: parentContext,
    });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(location.pathname).toBe('/home');
    expect(location.search).toBe('?tab=assets');
    expect(location.hash).toBe('#nfts');
    expect(location.state.homeAssets).toEqual(homeAssets);
    expect(location.state.walletScope).toEqual(walletScope);
    expect(location.state.returnContext.returnRoute).toBe(
      '/home/smart-account'
    );
    expect(location.state.fromMenu).toBeUndefined();
    expect(screen.getByRole('button', { name: /Ethereum/ })).toBeTruthy();
  }
);
