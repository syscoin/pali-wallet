/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import { INetworkType, KeyringAccountType } from 'types/network';

import ConnectedSites from './ConnectedSites';
import ExternalWatchAsset from './ExternalWatchAsset';
import RemoveEth from './RemoveEth';

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
type Locale = keyof typeof resources;
const locales = Object.keys(resources) as Locale[];
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn() };
let mockState: any;
let mockQuery: any;
const tokenAddress = '0x' + '22'.repeat(20);
const publicScope = { account: 'public-account', network: 'public-network' };

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
  useQueryData: () => mockQuery,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: true }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => publicScope,
  navigateBack: jest.fn(),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({
  ellipsis: (value?: string) => value || '',
  formatCurrency: (value: string) => value,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({ EditIconSvg: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, type, onClick }: any) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  IconButton: ({ children, disabled, onClick, ...props }: any) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={props['aria-label']}
    >
      {children}
    </button>
  ),
  Icon: () => null,
  DefaultModal: () => null,
  LoadingComponent: () => <p>Public token information loading</p>,
  PageActionFooter: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    price: { fiat: { asset: 'usd' } },
    vaultGlobal: { hasEthProperty: true },
    vault: {
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        url: 'http://127.0.0.1:18545',
      },
      accounts: {
        [KeyringAccountType.HDAccount]: {
          0: {
            id: 0,
            label: 'Public account',
            address: '0x' + '11'.repeat(20),
          },
        },
      },
    },
    dapp: { dapps: {} },
  };
  mockQuery = {
    host: 'https://dapp.synthetic.invalid',
    eventName: 'wallet_watchAsset',
    asset: { type: 'ERC20', options: { address: tokenAddress } },
  };
  // This is a view-projection fixture, not an ownership/transport proof. The
  // existing context/retry suites cover controller admission separately.
  mockEmitter.mockImplementation(async ([area, method]) => {
    if (area !== 'wallet' || method !== 'getAssetInfo')
      throw new Error('No wallet mutation permitted in localized view tests');
    return {
      contractAddress: tokenAddress,
      symbol: 'PUBLIC',
      name: 'Public token',
      balance: 0,
      decimals: 6,
      // External market-data response field names are part of its contract.
      // eslint-disable-next-line camelcase
      market_data: {
        // eslint-disable-next-line camelcase
        current_price: { usd: 2 },
        // eslint-disable-next-line camelcase
        market_cap: { usd: 4000000 },
      },
    };
  });
});
afterEach(cleanup);

const mount = async (locale: Locale, component: React.ReactElement) => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    initImmediate: false,
    lng: locale,
    fallbackLng: 'en',
    resources: Object.fromEntries(
      Object.entries(resources).map(([language, translation]) => [
        language,
        { translation },
      ])
    ),
    react: { useSuspense: false },
    interpolation: { escapeValue: true },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{component}</MemoryRouter>
    </I18nextProvider>
  );
  expect(i18n.resolvedLanguage).toBe(locale);
  return i18n;
};

describe.each(locales)('%s settings display', (locale) => {
  it('preserves raw account-label characters in localized attribution without a write', async () => {
    mockState.vault.accounts[KeyringAccountType.HDAccount][1] = {
      id: 1,
      label: 'Family A&B',
      address: '0x' + '33'.repeat(20),
    };
    mockState.dapp.dapps = {
      'https://site.synthetic.invalid': {
        host: 'https://site.synthetic.invalid',
        accountId: 1,
        accountType: KeyringAccountType.HDAccount,
        chain: INetworkType.Ethereum,
      },
    };
    const initial = JSON.stringify(mockState);
    const i18n = await mount(locale, <ConnectedSites />);
    expect(
      screen.getByText(
        i18n.t('settings.connectedToAccount', {
          account: 'Family A&B',
          interpolation: { escapeValue: false },
        }),
        { exact: true }
      )
    ).toBeVisible();
    expect(screen.queryByText(/Family A&amp;B/)).not.toBeInTheDocument();
    expect(JSON.stringify(mockState)).toBe(initial);
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 5])(
    'localizes the actual connected-site count %s with proper plural selection',
    async (count) => {
      mockState.dapp.dapps = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          String(index),
          {
            host: `https://site-${index}.synthetic.invalid`,
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
            chain: INetworkType.Ethereum,
          },
        ])
      );
      const initial = JSON.stringify(mockState);
      await mount(locale, <ConnectedSites />);
      const suffix =
        count === 0 ? 'zero' : new Intl.PluralRules(locale).select(count);
      const expected = (resources[locale].settings as Record<string, string>)[
        `connectedSiteCount_${suffix}`
      ].replace('{{count}}', String(count));
      expect(screen.getByText(expected, { exact: true })).toBeVisible();
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(JSON.stringify(mockState)).toBe(initial);
    }
  );

  it.each([false, true])(
    'localizes the native default-wallet choice (enabled=%s) without mutating it',
    async (enabled) => {
      mockState.vaultGlobal.hasEthProperty = enabled;
      const i18n = await mount(locale, <RemoveEth />);
      const action = screen.getByRole('button', {
        name: i18n.t(
          enabled
            ? 'settings.disablePaliProvider'
            : 'settings.enablePaliProvider'
        ),
      });
      expect(action).toBeVisible();
      expect(action).toHaveAttribute('type', 'button');
      if (enabled) {
        expect(
          screen.getByText(resources[locale].settings.paliProviderEnabled)
        ).toBeVisible();
        expect(
          screen.getByText(
            resources[locale].settings.otherDefaultWalletHelpTitle
          )
        ).toBeVisible();
        expect(
          screen.getByText(resources[locale].settings.otherDefaultWalletHelp)
        ).toBeVisible();
        expect(
          screen.getByText(
            resources[locale].settings.disablePaliProviderWarning
          )
        ).toBeVisible();
      } else
        expect(
          screen.getByText(resources[locale].settings.paliProviderDisabled)
        ).toBeVisible();
      expect(mockState.vaultGlobal.hasEthProperty).toBe(enabled);
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );

  it('localizes market captions without changing token identity or amounts', async () => {
    await mount(locale, <ExternalWatchAsset />);
    const price = await screen.findByText(
      resources[locale].tokens.currentPrice
    );
    const cap = screen.getByText(resources[locale].tokens.marketCap);
    expect(price).toBeVisible();
    expect(cap).toBeVisible();
    expect(price).toHaveTextContent('2');
    expect(cap).toHaveTextContent('4');
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getAssetInfo'],
      [{ address: tokenAddress }, 'ERC20', publicScope]
    );
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('localizes asset-read error guidance and preserves the actual external message', async () => {
    mockEmitter.mockRejectedValueOnce(
      new Error('Opaque provider detail 0x1234')
    );
    await mount(locale, <ExternalWatchAsset />);
    expect(
      await screen.findByText(resources[locale].settings.assetNotFound)
    ).toBeVisible();
    expect(screen.getByText('Opaque provider detail 0x1234')).toBeVisible();
    expect(
      screen.getByText(resources[locale].settings.validTokenContract)
    ).toBeVisible();
    expect(
      screen.getByText(resources[locale].settings.matchingTokenType)
    ).toBeVisible();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).not.toHaveBeenCalled();
  });

  it('localizes the actual missing-request view while preserving its technical example', async () => {
    mockQuery.asset = undefined;
    await mount(locale, <ExternalWatchAsset />);
    expect(
      await screen.findByText(resources[locale].settings.invalidRequestFormat)
    ).toBeVisible();
    expect(
      screen.getByText(resources[locale].settings.assetParameterRequired)
    ).toBeVisible();
    expect(screen.getByText(/\/\/ ERC-20 Token/)).toHaveTextContent(
      'type: "ERC20"'
    );
    expect(screen.getByText(/\/\/ ERC-20 Token/)).toHaveTextContent(
      'address: "0x..."'
    );
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
