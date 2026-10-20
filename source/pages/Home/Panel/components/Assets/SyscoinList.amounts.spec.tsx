/** @jest-environment jsdom */
import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { AssetsPanel } from 'pages/Home/Panel/AssetsPanel';
import SysAssetsController from 'scripts/Background/controllers/assets/syscoin';
import vaultReducer, { setAccountAssets } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
const mockRead = jest.fn();
const mockNavigate = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({ fetchBackendAccountCached: (...args: any[]) => mockRead(...args) })
);
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: () => {
      throw new Error('No mutation permitted by amount display probe');
    },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('pages/Home/Panel/components/Assets', () => ({
  SyscoinAssetsList: jest.requireActual(
    'pages/Home/Panel/components/Assets/SyscoinList'
  ).SyscoinAssetsList,
  EvmAssetsList: () => null,
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: jest.fn() } }),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  getTokenLogo: () => '',
}));
jest.mock('components/Icon/Icon', () => ({
  CgImport: () => null,
  HiTrash: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/index', () => ({
  TokenIcon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: true,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        activeNetwork: {
          kind: INetworkType.Syscoin,
          chainId: 5700,
          slip44: 1,
          currency: 'tsys',
          label: 'Syscoin Testnet',
          url: 'https://blockbook.synthetic.invalid/',
        },
        accounts: {
          ...vault.accounts,
          HDAccount: {
            0: {
              id: 0,
              address: 'synthetic-public-address',
              xpub: 'zpub-public',
              label: 'Public fixture',
            },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 1, networkStatus: 'idle' },
    },
  });
});

it.each([
  { units: '42', decimals: 0, exact: '42', label: '42' },
  { units: '1234', decimals: 4, exact: '0.1234', label: '0.1234' },
  { units: '1234567', decimals: 0, exact: '1234567', label: '1.235M' },
  { units: '123456789', decimals: 0, exact: '123456789', label: '123.457M' },
  { units: '0', decimals: 8, exact: '0.0', label: '0' },
  { units: '1', decimals: 8, exact: '0.00000001', label: '< 0.0001' },
  { units: '12345678', decimals: 8, exact: '0.12345678', label: '0.1235' },
  {
    units: '18446744073709551615',
    decimals: 0,
    exact: '18446744073709551615',
    label: '1.84e19',
  },
  {
    units: '18446744073709551615',
    decimals: 8,
    exact: '184467440737.09551615',
    label: '184.467B',
  },
])(
  'preserves a normal SPT balance: $units at $decimals decimals',
  async ({ units, decimals, exact, label }) => {
    mockRead.mockResolvedValue({
      tokensAsset: [
        {
          assetGuid: '123456',
          symbol: 'PUBLICSPT',
          name: 'Public SPT',
          decimals,
          balance: units,
          unconfirmedBalance: '0',
          totalReceived: units,
          totalSent: '0',
          transfers: 1,
        },
      ],
    });
    const rows = await SysAssetsController().getUserOwnedTokens('zpub-public');
    expect(mockRead).toHaveBeenCalledWith(
      'https://blockbook.synthetic.invalid/',
      'zpub-public',
      'details=tokenBalances&tokens=nonzero',
      true
    );
    expect(rows).toHaveLength(1);
    act(() =>
      mockStore.dispatch(
        setAccountAssets({
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          property: 'syscoin',
          value: rows,
        })
      )
    );
    render(
      <Provider store={mockStore}>
        <MemoryRouter
          initialEntries={['/home?tab=assets']}
          future={{
            ['v7_startTransition']: true,
            ['v7_relativeSplatPath']: true,
          }}
        >
          <AssetsPanel />
        </MemoryRouter>
      </Provider>
    );
    const row = screen
      .getByRole('button', { name: 'View details for PUBLICSPT token' })
      .closest('li')!;
    const amount = row.querySelector('span.font-semibold') as HTMLElement;
    expect(rows[0].balance).toBe(exact);
    expect(amount.textContent).toBe(label);
    expect(amount.title).toBe(exact);
    expect(amount.textContent!.length).toBeLessThanOrEqual(12);
    // Exact title remains a decimal string, including beyond Number precision.
    expect(amount.title).toMatch(/^\d+(?:\.\d+)?$/);
    act(() =>
      screen
        .getByRole('button', { name: 'View details for PUBLICSPT token' })
        .click()
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      '/home/details',
      expect.objectContaining({
        state: expect.objectContaining({ id: '123456', hash: null }),
      })
    );
  }
);
