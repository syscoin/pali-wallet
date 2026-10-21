/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { AddToken } from 'pages/Tokens/AddToken';
import SysAccountController from 'scripts/Background/controllers/account/syscoin';
import SysAssetsController from 'scripts/Background/controllers/assets/syscoin';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';

let mockStore: any;
let mockAssets: ReturnType<typeof SysAssetsController>;
let mockAccount: ReturnType<typeof SysAccountController>;
const mockFetch = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({
    fetchBackendAccountCached: (...args: any[]) => mockFetch(...args),
  })
);
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      key === 'tokens.importNamedToken'
        ? `Import ${values?.symbol} token`
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  getCurrentTab: jest.requireActual('utils/navigationState').getCurrentTab,
  createBrowsingNavigationContext: jest.requireActual('utils/navigationState')
    .createBrowsingNavigationContext,
  navigateWithContext: jest.requireActual('utils/navigationState')
    .navigateWithContext,
}));
jest.mock('utils/tokens', () => ({
  getTokenLogo: () => '',
  getTokenTypeBadgeColor: () => '',
}));

const token = (index: number) => ({
  assetGuid: String(1000 + index),
  symbol: `SPT${index}`,
  name: `SPT token ${index}`,
  decimals: 8,
  balance: '100000000',
  unconfirmedBalance: '0',
  totalReceived: '100000000',
  totalSent: '0',
  transfers: 1,
  type: 'SPTAllocated',
});

const importedTokens = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin;
const importButtons = () =>
  screen.getAllByRole('button', { name: /^Import SPT\d+ token$/ });
const tree = () => (
  <Provider store={mockStore}>
    <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
      <AddToken />
    </MemoryRouter>
  </Provider>
);
const mount = async (count: number, duplicateLast = false) => {
  const tokens = Array.from({ length: count }, (_, index) => token(index + 1));
  if (duplicateLast) tokens[tokens.length - 1] = token(count - 1);
  mockFetch.mockResolvedValue({ tokensAsset: tokens });
  const view = render(tree());
  await act(async () => undefined);
  expect(mockFetch).toHaveBeenCalledWith(
    'https://blockbook.synthetic.invalid/',
    'public-xpub',
    'details=tokenBalances&tokens=nonzero',
    true
  );
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: true,
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: {
          kind: 'syscoin',
          chainId: 5700,
          slip44: 1,
          url: 'https://blockbook.synthetic.invalid/',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: { id: 0, address: 'public-address', xpub: 'public-xpub' },
          },
        },
        accountAssets: {
          ...initial.accountAssets,
          HDAccount: { 0: { syscoin: [], ethereum: [] } },
        },
      } as any,
      vaultGlobal: {
        ...vaultGlobalReducer(undefined, { type: 'test/init' }),
        activeSlip44: 1,
      },
    },
  });
  mockAssets = SysAssetsController();
  mockAccount = SysAccountController(() => {
    throw Error('No keyring operation is permitted');
  });
  mockEmitter.mockImplementation(async ([, method]: string[], args: any[]) => {
    if (method === 'getUserOwnedTokens')
      return mockAssets.getUserOwnedTokens('public-xpub');
    if (method === 'saveTokenInfo') {
      const publish = await mockAccount.prepareTokenAddition(args[0]);
      mockStore.dispatch(publish());
      return;
    }
    throw Error(`Unexpected controller method ${method}`);
  });
});

it('shows and imports the thirty-first distinct owned SPT', async () => {
  await mount(31);
  expect(importButtons()).toHaveLength(31);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Import SPT31 token' }))
  );
  expect(importedTokens()).toEqual([
    expect.objectContaining({
      assetGuid: '1031',
      chainId: 5700,
      balance: '1.0',
      decimals: 8,
    }),
  ]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('keeps the remaining owned SPT discoverable after the first thirty are imported and the page reopens', async () => {
  const view = await mount(31);
  for (let index = 1; index <= 30; index += 1) {
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: `Import SPT${index} token` })
      )
    );
  }
  expect(importedTokens()).toHaveLength(30);
  view.unmount();
  render(tree());
  await act(async () => undefined);
  expect(importButtons()).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: 'Import SPT31 token' })
  ).toBeEnabled();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('aggregates duplicate UTXO rows and reuses the complete cached discovery result', async () => {
  await mount(31, true);
  expect(importButtons()).toHaveLength(30);
  const values = await mockAssets.getUserOwnedTokens('public-xpub');
  expect(values).toHaveLength(30);
  expect(values.find((value) => value.assetGuid === '1030')?.balance).toBe(
    '2.0'
  );
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('reveals all seventy-five owned SPTs with local Load More and no additional Blockbook request', async () => {
  await mount(75);
  expect(importButtons()).toHaveLength(50);
  expect(
    screen.getByRole('button', { name: 'Import SPT50 token' })
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Import SPT51 token' })
  ).toBeNull();
  const more = screen.getByRole('button', {
    name: 'buttons.loadMore (50/75)',
  });
  expect(more).toHaveAttribute('type', 'button');
  await act(async () => fireEvent.click(more));
  expect(importButtons()).toHaveLength(75);
  expect(
    screen.getByRole('button', { name: 'Import SPT75 token' })
  ).toBeEnabled();
  expect(screen.queryByRole('button', { name: /buttons.loadMore/ })).toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
