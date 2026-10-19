/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { AppLayout } from 'components/Layout/AppLayout';
import vaultReducer, {
  setAccountAssets,
  setActiveAccount,
  setActiveNetwork,
} from 'state/vault';
import { KeyringAccountType } from 'types/network';
import {
  createBrowsingNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

import { DetailsView } from './Details';

const mockEmitter = jest.fn();
let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('components/Header/Header', () => ({ Header: () => null }));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useBrowsingNavigationScroll', () => ({
  useBrowsingNavigationScroll: jest.fn(),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
  }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: (explorer: string) => explorer,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: { info: jest.fn(), error: jest.fn() },
    navigate: jest.requireActual('react-router-dom').useNavigate(),
  }),
  useAdjustedExplorer: (explorer: string) => explorer,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  ExternalLinkSvg: () => null,
  Icon: () => null,
  LoadingOutlined: () => null,
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('utils/index', () => ({
  adjustUrl: (value: string) => value,
  ellipsis: (value: string) => value,
  formatCurrency: (value: string) => value,
  formatFullPrecisionBalance: (value: string) => String(value),
}));
jest.mock('utils/tokens', () => ({ getTokenTypeBadgeColor: () => '' }));
jest.mock('./TransactionDetails', () => ({ TransactionDetails: () => null }));

const token = {
  id: `0x${'11'.repeat(20)}-1`,
  contractAddress: `0x${'11'.repeat(20)}`,
  chainId: 1,
  tokenSymbol: 'PRIOR',
  name: 'Original asset',
  balance: 99,
  decimals: 18,
  isNft: false,
  tokenStandard: 'ERC-20' as const,
  // eslint-disable-next-line camelcase
  market_data: { current_price: { usd: 10 } },
};
const network = {
  chainId: 1,
  kind: 'Ethereum',
  label: 'Original chain',
  url: 'https://original-rpc.invalid/',
  explorer: 'https://original-explorer.invalid/',
};
const nextNetwork = {
  ...network,
  chainId: 42161,
  label: 'New chain',
  url: 'https://new-rpc.invalid/',
  explorer: 'https://new-explorer.invalid/',
};
const preview = {
  ...token,
  id: 'preview',
  name: 'Preview asset',
  isImportPreview: true,
};
const nextPreview = {
  ...preview,
  id: 'next-preview',
  name: 'Next preview',
  chainId: nextNetwork.chainId,
};

const mount = (routePatch = {}, scoped = true) => {
  const initial = vaultReducer(undefined, { type: 'test/init' });
  const store = configureStore({
    reducer: {
      vault: vaultReducer,
      price: (state = { fiat: { asset: 'usd' } }) => state,
      vaultGlobal: (
        state = {
          networkStatus: 'connected',
          isSwitchingAccount: false,
          loadingStates: { isLoadingBalances: false },
          isPollingUpdate: false,
        }
      ) => state,
    },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: false,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        activeNetwork: network,
      } as any,
    },
  });
  mockStore = store;
  store.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      assets: { syscoin: [], ethereum: [token] },
    })
  );
  const Launcher = ({ next = false }: { next?: boolean }) => {
    const navigate = useNavigate();
    const location = useLocation();
    return (
      <button
        onClick={() => {
          const payload = next ? nextPreview : { id: token.id, ...routePatch };
          if (scoped || next)
            navigateWithContext(
              navigate,
              '/home/details',
              payload,
              createBrowsingNavigationContext(location)
            );
          else navigate('/home/details', { state: payload });
        }}
      >
        {next ? 'Open next preview' : 'Open details'}
      </button>
    );
  };
  render(
    <Provider store={store}>
      <MemoryRouter
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
        initialEntries={['/open']}
      >
        <Routes>
          <Route path="/open" element={<Launcher />} />
          <Route element={<AppLayout />}>
            <Route
              path="/home/details"
              element={
                <>
                  <DetailsView />
                  <Launcher next />
                </>
              }
            />
            <Route path="/home" element={<h1>Home</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
  return store;
};
const switchNetwork = (store: ReturnType<typeof mount>) =>
  act(() => store.dispatch(setActiveNetwork(nextNetwork as any)));
const switchAccount = (store: ReturnType<typeof mount>) =>
  act(() =>
    store.dispatch(
      setActiveAccount({ type: KeyringAccountType.HDAccount, id: 1 })
    )
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
});

it('shows the current stored asset through the real details route', () => {
  mount();
  expect(screen.getByText('99 PRIOR')).toBeVisible();
  expect(screen.getByText('Original asset (Original chain)')).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'home.viewOnExplorer' })
  ).toHaveAttribute(
    'href',
    `https://original-explorer.invalid/token/${token.contractAddress}`
  );
});

it('does not relabel a prior-chain stored token after a network switch', () => {
  const store = mount();
  switchNetwork(store);
  expect(screen.queryByText('99 PRIOR')).not.toBeInTheDocument();
  expect(screen.getByText('Asset not found')).toBeVisible();
});

it('keeps stored assets available after changing only the same-chain endpoint', () => {
  const store = mount();
  act(() =>
    store.dispatch(
      setActiveNetwork({
        ...network,
        url: 'https://alternate-rpc.invalid',
      } as any)
    )
  );
  expect(screen.getByText('99 PRIOR')).toBeVisible();
});

it('uses the newly active account stored balance rather than the former account', () => {
  const store = mount();
  act(() =>
    store.dispatch(
      setAccountAssets({
        accountId: 1,
        accountType: KeyringAccountType.HDAccount,
        assets: { syscoin: [], ethereum: [{ ...token, balance: 7 }] },
      })
    )
  );
  switchAccount(store);
  expect(screen.getByText('7 PRIOR')).toBeVisible();
  expect(screen.queryByText('99 PRIOR')).not.toBeInTheDocument();
});

it.each(['account', 'network'])(
  'does not retain a scoped import preview after changing %s',
  (change) => {
    const store = mount(preview);
    expect(screen.getByText('Preview asset (Original chain)')).toBeVisible();
    if (change === 'account') switchAccount(store);
    else switchNetwork(store);
    expect(screen.queryByText(/Preview asset/)).not.toBeInTheDocument();
  }
);

it.each(['account', 'network'])(
  'does not retain an NFT ownership snapshot after changing %s',
  (change) => {
    const store = mount({
      id: undefined,
      nftCollection: true,
      nftData: {
        ...token,
        name: 'Original collection',
        isNft: true,
        tokenStandard: 'ERC-1155',
        tokenId: '123',
      },
    });
    expect(screen.getAllByText('Original collection').length).toBeGreaterThan(
      0
    );
    if (change === 'account') switchAccount(store);
    else switchNetwork(store);
    expect(screen.queryAllByText('Original collection')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible();
  }
);

it.each([true, false])(
  'preserves a legacy unscoped preview initially, then binds it to its opening context (chain included=%s)',
  (includeChain) => {
    const store = mount(
      { ...preview, chainId: includeChain ? network.chainId : undefined },
      false
    );
    expect(screen.getByText('Preview asset (Original chain)')).toBeVisible();
    switchAccount(store);
    expect(screen.queryByText(/Preview asset/)).not.toBeInTheDocument();
  }
);

it('does not accept a legacy preview explicitly belonging to another chain', () => {
  mount({ ...preview, chainId: nextNetwork.chainId }, false);
  expect(screen.queryByText(/Preview asset/)).not.toBeInTheDocument();
  expect(screen.getByText('Asset not found')).toBeVisible();
});

it('accepts a fresh preview in the new context and ignores an old pending market reply', async () => {
  let finishOld!: (value: any) => void;
  mockEmitter.mockImplementation(
    () => new Promise((resolve) => (finishOld = resolve))
  );
  const store = mount({ ...preview, ['market_data']: undefined });
  switchNetwork(store);
  fireEvent.click(screen.getByRole('button', { name: 'Open next preview' }));
  expect(screen.getByText('Next preview (New chain)')).toBeVisible();
  await act(async () =>
    finishOld({ ['market_data']: { ['current_price']: { usd: 555 } } })
  );
  expect(screen.getByText('Next preview (New chain)')).toBeVisible();
  expect(screen.queryByText('$555')).not.toBeInTheDocument();
});
