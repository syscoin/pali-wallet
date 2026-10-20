/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen, within } from '@testing-library/react';
import React from 'react';
import { Provider, useSelector } from 'react-redux';

import price, { setPrices } from 'state/price';
import vault, {
  setAccountBalanceForNetwork,
  setNetworkChange,
} from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import { LazyAccountBalance } from './LazyAccountBalance';

const mockController = jest.fn(() => {
  throw new Error('A fresh native balance must not request RPC data');
});
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockController }),
}));

const network = {
  chainId: 5700,
  currency: 'ETH',
  kind: INetworkType.Ethereum,
  label: 'Synthetic balance network',
  slip44: 60,
  url: 'https://balance.synthetic.invalid',
};

function prepare(
  balance: string,
  currency: string,
  quote: number,
  showFiat = true
) {
  const store = configureStore({ reducer: { vault, price } });
  store.dispatch(setNetworkChange({ activeNetwork: network }));
  store.dispatch(
    setAccountBalanceForNetwork({
      balance,
      id: 0,
      network,
      type: KeyringAccountType.HDAccount,
      updatedAt: Date.now(),
    })
  );
  store.dispatch(setPrices({ asset: currency, price: quote }));
  const AccountRow = () => {
    const account = useSelector(
      (state: ReturnType<typeof store.getState>) =>
        state.vault.accounts.HDAccount[0]
    );
    return (
      <section data-testid="account-row">
        <LazyAccountBalance
          account={account}
          accountType={KeyringAccountType.HDAccount}
          showFiat={showFiat}
        />
      </section>
    );
  };
  render(
    <Provider store={store}>
      <AccountRow />
    </Provider>
  );
  return store;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => expect(mockController).not.toHaveBeenCalled());

it.each([
  ['eur', 2, '0 EUR'],
  ['jpy', 150, '0 JPY'],
  ['usd', 3, '0 USD'],
])(
  'labels a genuine zero balance in the selected %s currency',
  async (currency, quote, expected) => {
    prepare('0', currency, quote);
    await screen.findByText('0 ETH');
    expect(screen.getByText(expected)).toBeVisible();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  }
);

it.each([
  ['eur', 2, '5 EUR'],
  ['jpy', 150, '375 JPY'],
  ['usd', 3, '7.5 USD'],
])(
  'retains the real fiat conversion for a nonzero %s balance',
  async (currency, quote, expected) => {
    prepare('2.5', currency, quote);
    await screen.findByText('2.5 ETH');
    expect(screen.getByText(expected)).toBeVisible();
  }
);

it('updates the fiat unit on the same mounted zero-balance row', async () => {
  const store = prepare('0', 'usd', 3);
  const row = await screen.findByTestId('account-row');
  await screen.findByText('0 ETH');
  act(() => store.dispatch(setPrices({ asset: 'eur', price: 2 })));
  expect(screen.getByTestId('account-row')).toBe(row);
  expect(within(row).getByText('0 EUR')).toBeVisible();
  act(() => store.dispatch(setPrices({ asset: 'jpy', price: 150 })));
  expect(within(row).getByText('0 JPY')).toBeVisible();
});

it('keeps fiat hidden when the caller requests only native balance', async () => {
  prepare('0', 'eur', 2, false);
  await screen.findByText('0 ETH');
  expect(screen.getByTestId('account-row').querySelectorAll('p')).toHaveLength(
    1
  );
});
