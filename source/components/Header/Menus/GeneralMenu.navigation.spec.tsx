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

import { GeneralMenu } from './GeneralMenu';

const mockEmitter = jest.fn();
const mockState = {
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { address: '0xabc', xpub: 'public' } } },
    activeNetwork: {
      chainId: 1,
      kind: 'ethereum',
      url: 'https://rpc.test',
    },
  },
  vaultGlobal: { activeSlip44: 60, advancedSettings: { refresh: false } },
  dapp: { dapps: {} },
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('antd', () => ({ Badge: () => null }));
jest.mock('components/index', () => ({
  Icon: () => <svg aria-hidden="true" />,
  Tooltip: ({ children }: any) => children,
  AccountMenu: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  KeySvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  TrashIconSvg: () => null,
  LanguageIconSvg: () => null,
  DollarSignIconSvg: () => null,
  HelpIconSvg: () => null,
  LockIconSvg: () => null,
}));

const originalChrome = global.chrome;
beforeEach(() => {
  mockEmitter.mockReset().mockResolvedValue(undefined);
  global.chrome = {
    ...originalChrome,
    tabs: { query: jest.fn().mockResolvedValue([]) },
  } as unknown as typeof chrome;
});
afterEach(() => {
  global.chrome = originalChrome;
});

let location: ReturnType<typeof useLocation>;
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
const Layout = () => {
  location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <GeneralMenu />
      <Routes>
        <Route
          path="/home"
          element={
            <button
              onClick={() =>
                navigate('/home?tab=assets#nfts', {
                  state: {
                    homeAssets,
                    walletScope: getWalletNavigationScope(),
                    returnContext: {
                      returnRoute: '/home/smart-account',
                      walletScope: getWalletNavigationScope(),
                    },
                  },
                })
              }
            >
              Open asset view
            </button>
          }
        />
        <Route
          path="*"
          element={
            <button onClick={() => navigateBack(navigate, location)}>
              Back
            </button>
          }
        />
      </Routes>
    </>
  );
};

const destinations = [
  ['settings.connectedSites', '/settings/networks/connected-sites'],
  ['generalMenu.manageEth', '/settings/remove-eth'],
  ['smartAccountHub.menuEntry', '/home/smart-account'],
  ['sentry.sentryOperators', '/settings/sentry'],
  ['generalMenu.walletSeedPhrase', '/settings/seed'],
  ['generalMenu.forget', '/settings/forget-wallet'],
  ['Languages', '/settings/languages'],
  ['generalMenu.currency', '/settings/currency'],
  ['generalMenu.infoHelp', '/settings/about'],
  ['generalMenu.advanced', '/settings/advanced'],
] as const;

it.each(destinations)(
  'opens %s with the latest browsing context and returns through the real Back helper',
  async (label, target) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/home?tab=activity']}>
        <Layout />
      </MemoryRouter>
    );
    await user.click(screen.getByRole('button', { name: 'Open asset view' }));
    const walletScope = getWalletNavigationScope();
    const scroller = document.createElement('div');
    scroller.dataset.navigationScroll = 'wallet-layout';
    scroller.scrollTop = 420;
    document.body.append(scroller);
    try {
      if (label !== 'settings.connectedSites') {
        await user.click(
          screen.getByRole('button', { name: 'generalMenu.generalOptions' })
        );
      }
      await user.click(
        screen.getByRole(
          label === 'settings.connectedSites' ? 'button' : 'menuitem',
          { name: label }
        )
      );
      expect(location.pathname).toBe(target);
      expect(location.search).toBe('');
      expect(location.hash).toBe('');
      expect(Object.keys(location.state).sort()).toEqual([
        'returnContext',
        'walletScope',
      ]);
      expect(location.state.walletScope).toEqual(walletScope);
      expect(location.state.returnContext).toEqual({
        returnRoute: '/home?tab=assets#nfts',
        state: { homeAssets },
        tab: undefined,
        scrollPosition: 0,
        scrollPositions: { 'wallet-layout': 420 },
        walletScope,
        returnContext: {
          returnRoute: '/home/smart-account',
          walletScope,
        },
      });
      expect(mockEmitter).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(location.pathname).toBe('/home');
      expect(location.search).toBe('?tab=assets');
      expect(location.hash).toBe('#nfts');
      expect(location.state.homeAssets).toEqual(homeAssets);
      expect(location.state.walletScope).toEqual(walletScope);
      expect(location.state.scrollPositions).toEqual({ 'wallet-layout': 420 });
      expect(location.state.returnContext.returnRoute).toBe(
        '/home/smart-account'
      );
      expect(location.state.fromMenu).toBeUndefined();
    } finally {
      scroller.remove();
    }
  }
);

it('keeps logout outside the browsing navigation helper', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/home?tab=activity']}>
      <Layout />
    </MemoryRouter>
  );
  await user.click(
    screen.getByRole('button', { name: 'generalMenu.generalOptions' })
  );
  await user.click(screen.getByRole('menuitem', { name: 'generalMenu.lock' }));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'lock']);
  expect(location.pathname).toBe('/');
  expect(location.state).toBeNull();
});
