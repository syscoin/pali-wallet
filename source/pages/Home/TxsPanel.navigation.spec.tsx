/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { TxsPanel } from './TxsPanel';

jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: { activeNetwork: { chainId: 1 }, isBitcoinBased: false },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('./Panel/index', () => ({
  AssetsPanel: () => <span>Asset list</span>,
  TransactionsPanel: () => <span>Activity list</span>,
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({ search: location.search, state: location.state })}
    </output>
  );
};

it('keeps loaded asset preferences and unrelated query parameters while switching Home tabs', () => {
  const state = {
    homeAssets: {
      scope: 'account:network',
      value: { searchValue: 'USDC', tokensVisibleCount: 150 },
    },
  };
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/home', search: '?tab=assets&keep=1', state },
      ]}
    >
      <TxsPanel />
      <LocationProbe />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByText('buttons.activity'));
  expect(screen.getByText('Activity list')).toBeDefined();
  const activity = JSON.parse(screen.getByTestId('location').textContent!);
  expect(activity.state).toEqual(state);
  expect(new URLSearchParams(activity.search).get('keep')).toBe('1');
  fireEvent.click(screen.getByText('buttons.assets'));
  const assets = JSON.parse(screen.getByTestId('location').textContent!);
  expect(assets.state).toEqual(state);
  expect(new URLSearchParams(assets.search).get('tab')).toBe('assets');
});
