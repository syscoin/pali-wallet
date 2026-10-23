/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { DetailsView } from './Details';

let mockIsBitcoinBased = false;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-redux', () => ({
  shallowEqual: jest.fn(),
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: {
          chainId: 5700,
          explorer: 'https://explorer.example/',
          url: 'https://rpc.example/',
        },
        isBitcoinBased: mockIsBitcoinBased,
      },
    }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/home/details',
    state: { hash: 'fixture-hash' },
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.example/',
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountTransactions: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({ ExternalLinkSvg: () => null }));
jest.mock('utils/index', () => ({ adjustUrl: (url: string) => url }));
jest.mock('utils/navigationState', () => ({
  navigateBack: jest.fn(),
  getWalletNavigationScope: () => ({ account: 'fixture', network: 'fixture' }),
}));
jest.mock('./AssetDetails', () => ({ AssetDetails: () => null }));
jest.mock('./Nfts', () => ({ NftsDetails: () => null }));
jest.mock('./TransactionDetails', () => ({ TransactionDetails: () => null }));

afterEach(() => jest.restoreAllMocks());

it.each([
  [false, '{Enter}'],
  [false, ' '],
  [true, '{Enter}'],
  [true, ' '],
])(
  'opens the existing explorer once by keyboard without submitting (UTXO=%s, key=%s)',
  async (bitcoinBased, activation) => {
    mockIsBitcoinBased = bitcoinBased as boolean;
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    const submit = jest.fn((event) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={submit}>
        <DetailsView />
      </form>
    );
    const explorer = screen.getByRole('button', {
      name: 'home.viewOnExplorer',
    });
    await user.tab();
    expect(document.activeElement).toBe(explorer);
    await user.keyboard(activation as string);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      'https://explorer.example/tx/fixture-hash',
      '_blank'
    );
    expect(submit).not.toHaveBeenCalled();
  }
);
