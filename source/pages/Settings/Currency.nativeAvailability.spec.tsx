/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { formatNumber } from 'utils/format';
import Currency from './Currency';

// Synthetic public balances only. Real Currency, usePrice and formatting
// distinguish unavailable native data from known zero; no network is claimed.
let mockState: any;
const mockEmitter = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings/currency' }),
}));
jest.mock('hooks/index', () => ({
  usePrice: jest.requireActual('hooks/usePrice').usePrice,
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));
jest.mock('components/Icon/Icon', () => ({ ArrowDownSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  PageActionFooter: ({ children, error }: any) => (
    <div>
      {error && <p role="alert">{error}</p>}
      {children}
    </div>
  ),
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DefaultModal: ({ show, title }: any) =>
    show ? <div role="dialog">{title}</div> : null,
}));

const networks = [
  { name: 'UTXO', chainId: 57, isBitcoinBased: true },
  { name: 'EVM chain 5700', chainId: 5700, isBitcoinBased: false },
  { name: 'custom EVM', chainId: 31337, isBitcoinBased: false },
];
const balanceKey = () =>
  mockState.vault.isBitcoinBased ? 'syscoin' : 'ethereum';
const setNative = (value: unknown) => {
  mockState.vault.accounts.HDAccount[0].balances[balanceKey()] = value;
};
const card = () => screen.getByText('components.currentBalance').parentElement!;
const chooseEuro = async () => {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'settings.setYourPreferred' })
  );
  await user.type(
    screen.getByRole('textbox', { name: 'settings.searchCurrencies' }),
    'eur'
  );
  await user.click(screen.getByRole('button', { name: /EUR/ }));
  return user;
};
beforeEach(() => {
  mockEmitter.mockReset();
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: { 0: { balances: { syscoin: -1, ethereum: -1 } } },
      },
      activeNetwork: { chainId: 57, currency: 'tsys' },
      isBitcoinBased: true,
    },
    price: { fiat: { asset: 'usd', price: 1, available: true } },
  };
});
afterEach(cleanup);

describe.each(networks)('$name native availability', (network) => {
  beforeEach(() => {
    mockState.vault.activeNetwork.chainId = network.chainId;
    mockState.vault.isBitcoinBased = network.isBitcoinBased;
  });
  it.each([-1, null, undefined, NaN, Infinity, -Infinity])(
    'does not turn unknown native balance %s into money',
    (value) => {
      setNative(value);
      render(<Currency />);
      const unavailable = within(card()).getAllByText('settings.unavailable', {
        exact: true,
      });
      expect(unavailable).toHaveLength(2);
      expect(unavailable[0]).toHaveClass(
        'text-sm',
        'text-brand-gray200',
        'break-words'
      );
      expect(unavailable[0]).not.toHaveClass('truncate');
      expect(card()).toHaveTextContent('TSYS');
      expect(card()).toHaveTextContent('🇺🇸');
      expect(card()).not.toHaveTextContent('$0');
      expect(card()).not.toHaveTextContent('NaN');
      expect(card()).not.toHaveTextContent('Infinity');
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );
  it.each([
    { native: 0, price: 1, fiat: '$0 USD' },
    { native: 10, price: 1, fiat: '$10 USD' },
    { native: 0, price: 0, fiat: '$0 USD' },
    { native: 10, price: 0, fiat: '$0 USD' },
  ])(
    'preserves known native $native with the existing finite quote $price',
    ({ native, price, fiat }) => {
      setNative(native);
      mockState.price.fiat.price = price;
      render(<Currency />);
      expect(
        within(card()).getByText(formatNumber(native), { exact: true })
      ).toBeVisible();
      expect(within(card()).getByText(fiat, { exact: true })).toBeVisible();
      expect(within(card()).queryByText('settings.unavailable')).toBeNull();
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );
});

it('updates unavailable amounts when a balance arrives without saving or relabelling the unsaved currency', async () => {
  const view = render(<Currency />);
  expect(within(card()).getAllByText('settings.unavailable')).toHaveLength(2);
  await chooseEuro();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  setNative(10);
  view.rerender(<Currency />);
  expect(within(card()).getByText('$10 USD', { exact: true })).toBeVisible();
  expect(card()).toHaveTextContent('🇺🇸');
  expect(card()).not.toHaveTextContent('EUR');
  expect(
    screen.getByRole('button', { name: 'settings.setYourPreferred' })
  ).toHaveTextContent('EUR');
  expect(mockEmitter).not.toHaveBeenCalled();
  mockState.price.fiat.price = 0;
  view.rerender(<Currency />);
  expect(within(card()).getByText('$0 USD', { exact: true })).toBeVisible();
  expect(within(card()).queryByText('settings.unavailable')).toBeNull();
});

it('can save a currency preference while native balance is unavailable without waiting for a quote', async () => {
  let finish!: () => void;
  mockEmitter.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  mockState.price.fiat.price = 0;
  render(<Currency />);
  const user = await chooseEuro();
  const save = screen.getByRole('button', { name: 'buttons.save' });
  expect(save).toBeEnabled();
  await user.click(save);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'saveFiatCurrency'],
    ['eur']
  );
  expect(save).toBeDisabled();
  expect(within(card()).getAllByText('settings.unavailable')).toHaveLength(2);
  await act(async () => finish());
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'settings.fiatCurrencySetSuccessfully'
  );
  expect(within(card()).getAllByText('settings.unavailable')).toHaveLength(2);
  expect(mockState.price.fiat).toEqual({
    asset: 'usd',
    price: 0,
    available: true,
  });
});
