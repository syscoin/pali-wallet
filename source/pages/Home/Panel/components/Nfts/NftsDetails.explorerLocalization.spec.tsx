/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createStore } from 'redux';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';

import { NftsDetails } from './NftsDetails';

const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
// Public network/icon decoration is unrelated to the real link and locale path.
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => <svg aria-hidden="true" />,
  RiFileCopyLine: () => <svg aria-hidden="true" />,
  LoadingOutlined: () => <svg aria-hidden="true" />,
  Icon: () => <svg aria-hidden="true" />,
}));
jest.mock('utils/index', () => jest.requireActual('utils/format'));

const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
const locales = Object.keys(resources) as Array<keyof typeof resources>;
const CONTRACT = '0x' + 'ab'.repeat(20);
const OWNER = '0x' + '11'.repeat(20);
const EXPLORER = 'https://explorer.synthetic.invalid/public/?view=compact';
const collection = {
  id: `${CONTRACT}-1-42`,
  contractAddress: CONTRACT,
  tokenStandard: 'ERC-1155',
  tokenId: '42',
  name: 'Public fixture collection',
  tokenSymbol: 'PUBLICNFT',
  chainId: 1,
  isNft: true,
  balance: 1,
  rawBalance: '1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(() => {
    throw new Error('No controller operation belongs to this stored NFT view');
  });
});

it.each(locales)(
  'uses the current %s locale for the ordinary NFT explorer link without changing its destination or account',
  async (locale) => {
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      initImmediate: false,
      lng: locale,
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: Object.fromEntries(
        Object.entries(resources).map(([language, translation]) => [
          language,
          { translation },
        ])
      ),
    });
    const state = {
      vault: {
        activeNetwork: {
          kind: 'ethereum',
          chainId: 1,
          slip44: 60,
          url: 'https://rpc.synthetic.invalid',
          explorer: EXPLORER,
        },
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: { HDAccount: { 0: { id: 0, address: OWNER } } },
        accountAssets: {
          HDAccount: { 0: { ethereum: [collection], syscoin: [] } },
        },
      },
    };
    const store = createStore(() => state);
    const dispatch = jest.spyOn(store, 'dispatch');
    const snapshot = JSON.stringify(store.getState());
    render(
      <I18nextProvider i18n={instance}>
        <Provider store={store}>
          <MemoryRouter
            future={{
              ['v7_startTransition']: true,
              ['v7_relativeSplatPath']: true,
            }}
            initialEntries={['/home/details']}
          >
            <NftsDetails
              nftData={
                store.getState().vault.accountAssets.HDAccount[0].ethereum[0]
              }
            />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>
    );

    // Establish genuine locale, ordinary stored data and link behavior before
    // the final localization assertion, so a scaffold failure is not proof.
    expect(instance.resolvedLanguage).toBe(locale);
    expect(
      screen.getByText(resources[locale].nftDetails.about, { exact: true })
    ).toBeVisible();
    expect(
      screen.getByText(resources[locale].nftDetails.technicalInfo, {
        exact: true,
      })
    ).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      `https://explorer.synthetic.invalid/public/address/${CONTRACT}?view=compact`
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    const user = userEvent.setup();
    for (
      let presses = 0;
      presses < 8 && document.activeElement !== link;
      presses += 1
    )
      await user.tab();
    expect(link).toHaveFocus();
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(mockAlert.info).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).toBe(snapshot);
    expect(link).toHaveAccessibleName(resources[locale].home.viewOnExplorer);
  }
);
