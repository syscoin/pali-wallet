/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import Currency from './Currency';

const mockState = {
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { balances: { syscoin: 10, ethereum: 0 } } } },
    activeNetwork: { chainId: 5700, currency: 'tsys' },
    isBitcoinBased: true,
  },
  price: { fiat: { asset: 'usd', price: 1, available: true } },
};
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

beforeEach(() => {
  mockEmitter.mockReset();
  mockState.price.fiat = { asset: 'usd', price: 1, available: true };
  mockState.vault.accounts.HDAccount[0].balances.syscoin = 10;
});

const selectEuro = async () => {
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

it('keeps the quoted amount and flag in their actual currency until a matching saved quote arrives', async () => {
  let finish!: () => void;
  mockEmitter.mockReturnValue(
    new Promise<void>((resolve) => (finish = resolve))
  );
  const view = render(<Currency />);
  const card = screen.getByText('components.currentBalance').parentElement!;
  expect(card).toHaveTextContent('$10 USD');
  const user = await selectEuro();
  expect(
    screen.getByRole('button', { name: 'settings.setYourPreferred' })
  ).toHaveTextContent('EUR');
  expect(card).toHaveTextContent('🇺🇸');
  expect(card).toHaveTextContent('$10 USD');
  expect(card).not.toHaveTextContent('€10 EUR');
  expect(card).toHaveTextContent('settings.saveToUpdateRate');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(card).toHaveTextContent('$10 USD');
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'saveFiatCurrency'],
    ['eur']
  );
  mockState.price.fiat = { asset: 'eur', price: 2, available: true };
  view.rerender(<Currency />);
  const updatedCard = screen.getByText('components.currentBalance')
    .parentElement!;
  expect(updatedCard).toHaveTextContent('🇪🇺');
  expect(updatedCard).toHaveTextContent('€20 EUR');
  await act(async () => finish());
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('retains the saved quote currency when saving the new selection fails', async () => {
  mockEmitter.mockRejectedValue(new Error('Synthetic save failure'));
  render(<Currency />);
  const card = screen.getByText('components.currentBalance').parentElement!;
  const user = await selectEuro();
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(card).toHaveTextContent('🇺🇸');
  expect(card).toHaveTextContent('$10 USD');
  expect(card).not.toHaveTextContent('€10 EUR');
});

it.each([
  [false, 0, 'settings.unavailable'],
  [true, 0, '$0 USD'],
  [true, 2, '$20 USD'],
  [true, -2, '$-20 USD'],
] as const)(
  'keeps native funds distinct from quote availability %s with value %s',
  (available, price, expected) => {
    mockState.price.fiat = { asset: 'usd', price, available };
    render(<Currency />);
    const card = screen.getByText('components.currentBalance').parentElement!;
    expect(card.querySelector('p.font-poppins')?.textContent).toBe('10');
    expect(card).toHaveTextContent(expected);
    if (!available) expect(card).not.toHaveTextContent('$0 USD');
  }
);

it('updates only quote display when a missing quote recovers in the current currency draft', async () => {
  mockState.price.fiat = { asset: 'usd', price: 0, available: false };
  const view = render(<Currency />);
  await selectEuro();
  expect(
    screen.getByText('components.currentBalance').parentElement
  ).toHaveTextContent('settings.unavailable');
  mockState.price.fiat = { asset: 'usd', price: 2, available: true };
  view.rerender(<Currency />);
  const card = screen.getByText('components.currentBalance').parentElement!;
  expect(card).toHaveTextContent('$20 USD');
  expect(card).toHaveTextContent('🇺🇸');
  expect(
    screen.getByRole('button', { name: 'settings.setYourPreferred' })
  ).toHaveTextContent('EUR');
  expect(mockEmitter).not.toHaveBeenCalled();
});
