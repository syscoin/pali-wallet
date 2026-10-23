/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import vault, {
  createAccount,
  setAccountAssets,
  setNetworkChange,
} from 'state/vault';
import vaultGlobal, { setActiveSlip44 } from 'state/vaultGlobal';
import { initialActiveHdAccountState, KeyringAccountType } from 'types/network';
import type { ITokenSysProps } from 'types/tokens';
import { getSyscoinUTXOTestnetNetwork } from 'utils/defaultNetworks';

import { SyscoinAssetDetails } from './SyscoinDetails';
import { SyscoinAssetsList } from './SyscoinList';

const locales = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh'];
let mockLocale = 'en';
let mockStore: any;
const mockController = jest.fn();
const mockNavigate = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) => {
      const dictionary = jest.requireActual(
        `assets/locales/${mockLocale}.json`
      );
      const value = key
        .split('.')
        .reduce((current: any, part) => current?.[part], dictionary);
      return typeof value === 'string'
        ? value.replace(/{{(\w+)}}/g, (_match, name) => values[name] ?? '')
        : key;
    },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    useCopyClipboard: () => [false, jest.fn(), () => true],
    alert: { info: jest.fn() },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockController }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockController(...args),
}));
jest.mock('components/Icon/Icon', () => ({
  HiTrash: () => null,
  RiShareForward2Line: () => null,
  FiExternalLink: () => null,
  FiCopy: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  TokenIcon: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
// Removal is not exercised here; the real list, details, buttons, selectors,
// locale resources and Redux updates own the balance-display assertions.
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
  syscoinKeysOfInterest:
    jest.requireActual('utils/constants').syscoinKeysOfInterest,
  getKnownSyscoinAsset: () => null,
  getTokenLogo: () => undefined,
}));

const GUID = '123';
const SYMBOL = 'BALANCE';
const NETWORK = {
  ...getSyscoinUTXOTestnetNetwork(),
  url: 'https://blockbook.synthetic.invalid/',
};
const PUBLIC_ACCOUNT = {
  ...initialActiveHdAccountState,
  id: 0,
  label: 'Public balance display fixture',
  address: 'tsys1qmk2wr58dse5esyw8xcrsp7k5r77zj2xzvhqhkl',
  xpub: 'tpubDF93avGi4A5M9SVXQ45xy1hJ5j7dEBkA4M9jTwt74wurbFoCfRSHoDshkoLaUQmobjYGSakehWisjK6CXHeB3fXwtCtPmGnrKnvEU6u8NwV',
};
const unknownAsset: ITokenSysProps = {
  assetGuid: GUID,
  chainId: NETWORK.chainId,
  symbol: SYMBOL,
  decimals: 2,
  type: 'SPTAllocated',
  totalSent: '0',
  totalReceived: '0',
};
const copy = (key: string) =>
  key
    .split('.')
    .reduce(
      (value: any, part) => value[part],
      jest.requireActual(`assets/locales/${mockLocale}.json`)
    ) as string;
const setAssets = (assets: ITokenSysProps[]) =>
  mockStore.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      property: 'syscoin',
      value: assets,
    })
  );
const currentAsset = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin[0];
const mount = (
  view: 'home' | 'details',
  assets = [unknownAsset],
  navigationState?: any
) => {
  setAssets(assets);
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={['/home?tab=assets']}
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
      >
        {view === 'home' ? (
          <SyscoinAssetsList scope="public-balance-fixture" />
        ) : (
          <SyscoinAssetDetails id={GUID} navigationState={navigationState} />
        )}
      </MemoryRouter>
    </Provider>
  );
};
const balanceElement = (view: 'home' | 'details') => {
  if (view === 'details')
    return screen
      .getByText(copy('send.balance'))
      .closest('li')!
      .querySelector('span.text-brand-white')!;
  return screen
    .getByRole('button', {
      name: copy('tokens.viewTokenDetails').replace('{{symbol}}', SYMBOL),
    })
    .closest('li')!
    .querySelector('span.font-semibold')!;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockController.mockImplementation(() => {
    throw new Error(
      'No I/O is needed to render complete public asset metadata'
    );
  });
  mockLocale = 'en';
  mockStore = configureStore({
    reducer: {
      vault,
      vaultGlobal,
      price: (state = { fiat: { asset: 'usd', price: 0 } }) => state,
    },
  });
  mockStore.dispatch(setActiveSlip44(1));
  mockStore.dispatch(setNetworkChange({ activeNetwork: NETWORK }));
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: PUBLIC_ACCOUNT,
    })
  );
});
afterEach(() => {
  cleanup();
  expect(mockController).not.toHaveBeenCalled();
});

describe.each(locales)('SPT unavailable balance in %s', (locale) => {
  it('shows Home unavailable and receives a known-zero Redux refresh without changing identity', () => {
    mockLocale = locale;
    mount('home');
    expect(currentAsset()).not.toHaveProperty('balance');
    expect(balanceElement('home')).toHaveTextContent(
      copy('settings.unavailable')
    );
    expect(balanceElement('home')).toHaveAttribute(
      'title',
      copy('settings.unavailable')
    );

    act(() => setAssets([{ ...unknownAsset, balance: '0' }]));
    expect(balanceElement('home')).toHaveTextContent(/^0$/);
    expect(balanceElement('home')).toHaveAttribute('title', '0');
    expect(currentAsset()).toEqual({ ...unknownAsset, balance: '0' });
  });

  it('renders an explicit Details Balance row for an omitted field and updates to a known positive value', () => {
    mockLocale = locale;
    mount('details');
    expect(currentAsset()).not.toHaveProperty('balance');
    expect(balanceElement('details')).toHaveTextContent(
      copy('settings.unavailable')
    );
    expect(balanceElement('details')).toHaveAttribute(
      'title',
      copy('settings.unavailable')
    );

    // The backend/SDK refresh is covered by the import integration fixture;
    // this tests the actual mounted display's ordinary Redux update boundary.
    act(() => setAssets([{ ...unknownAsset, balance: '25.0' }]));
    expect(balanceElement('details')).toHaveTextContent(/^25$/);
    expect(balanceElement('details')).toHaveAttribute('title', '25.0');
    expect(currentAsset()).toEqual({ ...unknownAsset, balance: '25.0' });
  });

  it('preserves an omitted balance through the ordinary Details import-preview props', () => {
    mockLocale = locale;
    mount('details', [], { ...unknownAsset, isImportPreview: true });
    expect(balanceElement('details')).toHaveTextContent(
      copy('settings.unavailable')
    );
    expect(balanceElement('details')).toHaveAttribute(
      'title',
      copy('settings.unavailable')
    );
    expect(
      mockStore.getState().vault.accountAssets.HDAccount[0].syscoin
    ).toEqual([]);
  });
});

describe.each(['home', 'details'] as const)('%s balance boundaries', (view) => {
  it.each([0, '0', '25.0'])(
    'keeps the existing known balance %s display and exact title',
    (balance) => {
      mount(view, [{ ...unknownAsset, balance }]);
      expect(balanceElement(view)).toHaveTextContent(
        balance === '25.0' ? /^25$/ : /^0$/
      );
      expect(balanceElement(view)).toHaveAttribute('title', String(balance));
    }
  );

  it.each([undefined, null, '', ' ', NaN, Infinity, 'corrupt'])(
    'does not mislabel an unavailable or corrupt balance %s as confirmed zero',
    (balance) => {
      mount(view, [{ ...unknownAsset, balance } as ITokenSysProps]);
      expect(balanceElement(view)).toHaveTextContent(
        copy('settings.unavailable')
      );
      expect(balanceElement(view)).toHaveAttribute(
        'title',
        copy('settings.unavailable')
      );
    }
  );
});
