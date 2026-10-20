/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen, within } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { DetailsView } from '../Details';
import SysAssetsController from 'scripts/Background/controllers/assets/syscoin';
import vaultReducer, { setAccountAssets } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
const mockRead = jest.fn();
const mockController = jest.fn(() => {
  throw new Error('Unexpected controller request from complete SPT record');
});
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({ fetchBackendAccountCached: (...args: any[]) => mockRead(...args) })
);
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: () => mockController(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    useCopyClipboard: () => [false, jest.fn(), () => true],
    alert: { info: jest.fn() },
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: (url: string) => url,
}));
jest.mock('pages/Home/Panel/components/Assets/index', () => ({
  SyscoinAssetDetails: jest.requireActual(
    'pages/Home/Panel/components/Assets/SyscoinDetails'
  ).SyscoinAssetDetails,
  EvmAssetDetails: () => null,
}));
jest.mock('pages/Home/Panel/components/TransactionDetails', () => ({
  TransactionDetails: () => null,
}));
jest.mock('pages/Home/Panel/components/Nfts', () => ({
  NftsDetails: () => null,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  syscoinKeysOfInterest:
    jest.requireActual('utils/constants').syscoinKeysOfInterest,
  adjustUrl: (url: string) => url,
  getKnownSyscoinAsset: () => null,
  getTokenLogo: () => undefined,
}));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  ExternalLinkSvg: () => null,
  FiExternalLink: () => null,
  FiCopy: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      price: (state = { fiat: { asset: 'usd', price: 0 } }) => state,
    },
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

describe.each([
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
])('normal SPT details amounts: $units at $decimals decimals', (fixture) => {
  it.each(['received', 'sent'] as const)(
    'preserves the exact %s and balance totals behind readable labels',
    async (direction) => {
      // Both are ordinary histories: an unspent receipt or a fully spent one.
      mockRead.mockResolvedValue({
        tokensAsset: [
          {
            assetGuid: '123456',
            symbol: 'PUBLICSPT',
            name: 'Public SPT',
            decimals: fixture.decimals,
            balance: direction === 'received' ? fixture.units : '0',
            unconfirmedBalance: '0',
            totalReceived: fixture.units,
            totalSent: direction === 'sent' ? fixture.units : '0',
            transfers: direction === 'received' ? 1 : 2,
          },
        ],
      });
      const rows = await SysAssetsController().getUserOwnedTokens(
        'zpub-public'
      );
      expect(mockRead).toHaveBeenCalledWith(
        'https://blockbook.synthetic.invalid/',
        'zpub-public',
        'details=tokenBalances&tokens=nonzero',
        true
      );
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
            initialEntries={[
              {
                pathname: '/home/details',
                state: { id: '123456', hash: null },
              },
            ]}
            future={{
              ['v7_startTransition']: true,
              ['v7_relativeSplatPath']: true,
            }}
          >
            <Routes>
              <Route path="/home/details" element={<DetailsView />} />
            </Routes>
          </MemoryRouter>
        </Provider>
      );
      expect(
        screen.getByText('PUBLICSPT (Syscoin Testnet)')
      ).toBeInTheDocument();
      for (const [field, title] of [
        ['balance', 'Balance'],
        ['totalReceived', 'Total Received'],
        ['totalSent', 'Total Sent'],
      ]) {
        const hasAmount =
          field === 'totalReceived' ||
          (field === 'balance' && direction === 'received') ||
          (field === 'totalSent' && direction === 'sent');
        const row = screen.getByText(title).closest('li')!;
        const amount = row.querySelector('span.text-brand-white')!;
        expect(within(row).getByText('PUBLICSPT')).toBeInTheDocument();
        expect(rows[0][field]).toBe(
          hasAmount ? fixture.exact : fixture.decimals === 0 ? '0' : '0.0'
        );
        expect(amount.textContent).toBe(hasAmount ? fixture.label : '0');
        expect(amount).toHaveAttribute('title', rows[0][field]);
      }
      expect(mockController).not.toHaveBeenCalled();
    }
  );
});
