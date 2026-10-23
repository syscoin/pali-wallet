/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
import { getWalletNavigationScope } from 'utils/navigationState';

import { DetailsView } from './Details';
import { UtxoTransactionsListComponent } from './Transactions/UTXO/UtxoList';

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
const locales = Object.keys(resources) as Array<keyof typeof resources>;
const hash = 'ab'.repeat(32);
const explorer = 'https://explorer.synthetic.invalid/public/?view=compact';
const expectedUrl = `${explorer.split('?')[0]}tx/${hash}?view=compact`;
const historicalTransaction = {
  txid: hash,
  blockHeight: 42,
  confirmations: 3,
  blockTime: 1700000000,
  fees: '1000',
  addressValueIn: '100000',
  addressValueOut: '0',
  direction: 'sent',
  vin: [{ addresses: ['tsys1publicsender'], value: '100000', isOwn: true }],
  vout: [{ addresses: ['tsys1publicrecipient'], value: '99000', isOwn: false }],
};
const mockState = {
  vaultGlobal: { activeSlip44: 1 },
  vault: {
    activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
    activeNetwork: {
      kind: INetworkType.Syscoin,
      chainId: 5700,
      slip44: 1,
      currency: 'tsys',
      url: 'https://blockbook.synthetic.invalid',
      explorer,
    },
    isBitcoinBased: true,
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          label: 'Public account',
          address: 'tsys1publicsender',
          xpub: 'public-hd-identity',
        },
      },
    },
    accountAssets: { HDAccount: { 0: { syscoin: [], ethereum: [] } } },
    accountTransactions: {
      HDAccount: {
        0: { syscoin: { 5700: [historicalTransaction] }, ethereum: {} },
      },
    },
  },
};
const initialPublicState = JSON.stringify(mockState);
const mockEmitter = jest.fn();
const mockCopy = jest.fn();
const mockSubmit = jest.fn();

jest.mock('react-redux', () => ({
  ...jest.requireActual('react-redux'),
  useSelector: (select: any) => select(mockState),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('hooks/useSafeNavigate').useSafeNavigate(),
    useCopyClipboard: () => [false, mockCopy, () => true],
    alert: { success: jest.fn(), error: jest.fn() },
  }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('@ant-design/icons', () => ({}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
  getTokenLogo: () => undefined,
}));
jest.mock('./AssetDetails', () => ({ AssetDetails: () => null }));
jest.mock('./Nfts', () => ({ NftsDetails: () => null }));
jest.mock('./TransactionDetails', () => ({
  TransactionDetails: () => <p>Public transaction details</p>,
}));

const RouteState = () => {
  const location = useLocation();
  return (
    <output aria-label="Public route state">
      {JSON.stringify({
        path: location.pathname,
        hash: location.state?.hash,
        walletScope: location.state?.walletScope,
        returnRoute: location.state?.returnContext?.returnRoute,
      })}
    </output>
  );
};

const openDetailsFromRow = async (locale: keyof typeof resources) => {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
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
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
        initialEntries={['/home?tab=activity']}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mockSubmit();
          }}
        >
          <RouteState />
          <Routes>
            <Route
              path="/home"
              element={
                <UtxoTransactionsListComponent
                  tx={historicalTransaction as any}
                />
              }
            />
            <Route path="/home/details" element={<DetailsView />} />
          </Routes>
        </form>
      </MemoryRouter>
    </I18nextProvider>
  );
  expect(instance.resolvedLanguage).toBe(locale);
  await user.click(
    screen.getByRole('button', {
      name: resources[locale].notifications.clickToView,
    })
  );
  expect(await screen.findByText('Public transaction details')).toBeVisible();
  expect(
    JSON.parse(screen.getByLabelText('Public route state').textContent!)
  ).toEqual({
    path: '/home/details',
    hash,
    walletScope: getWalletNavigationScope(),
    returnRoute: '/home?tab=activity',
  });
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockCopy).not.toHaveBeenCalled();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(JSON.stringify(mockState)).toBe(initialPublicState);
  return user;
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('shared transaction explorer localization through an ordinary Activity row', () => {
  it.each(locales)(
    'uses the current %s label after real scoped row navigation',
    async (locale) => {
      await openDetailsFromRow(locale);
      // Observe the actual nonempty action before the localization assertion so
      // a missing route or button cannot masquerade as the expected red proof.
      const action = screen.getByRole('button');
      expect(action).toBeVisible();
      expect(action.textContent?.trim()).not.toBe('');
      expect(action).toHaveAttribute('type', 'button');
      expect(action.textContent?.trim()).toBe(
        resources[locale].home.viewOnExplorer
      );
    }
  );

  it.each(['{Enter}', ' '])(
    'keeps English native keyboard activation %s exact and nonmutating',
    async (key) => {
      const open = jest.spyOn(window, 'open').mockReturnValue(null);
      const user = await openDetailsFromRow('en');
      const action = screen.getByRole('button', {
        name: en.home.viewOnExplorer,
      });
      await user.tab();
      expect(action).toHaveFocus();
      await user.keyboard(key);
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(expectedUrl, '_blank');
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(mockCopy).not.toHaveBeenCalled();
      expect(JSON.stringify(mockState)).toBe(initialPublicState);
      expect(
        JSON.parse(screen.getByLabelText('Public route state').textContent!)
          .path
      ).toBe('/home/details');
    }
  );
});
