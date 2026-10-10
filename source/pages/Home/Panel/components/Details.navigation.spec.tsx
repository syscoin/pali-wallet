/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import React from 'react';

import { navigateBack } from 'utils/navigationState';

import { DetailsView } from './Details';
import { TransactionDetails } from './TransactionDetails';

let mockState: any;
let mockLocation: any;
const mockNavigate = jest.fn();

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.example/',
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountTransactions: (state: any) => state.transactions,
}));
jest.mock('components/Icon/Icon', () => ({ ExternalLinkSvg: () => null }));
jest.mock('utils/index', () => ({ adjustUrl: (url: string) => url }));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));
jest.mock('./AssetDetails', () => ({ AssetDetails: () => null }));
jest.mock('./Nfts', () => ({ NftsDetails: () => null }));
jest.mock('./TransactionDetails', () => ({
  TransactionDetails: jest.fn(() => null),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: { activeNetwork: { chainId: 1 }, isBitcoinBased: false },
    transactions: { ethereum: {}, syscoin: {} },
  };
  mockLocation = { pathname: '/home/details', state: null };
});

it('returns an incomplete restored details route to its saved origin instead of crashing', () => {
  mockLocation.state = { returnContext: { returnRoute: '/home?tab=assets' } };
  const { container } = render(<DetailsView />);
  expect(container.innerHTML).toBe('');
  expect(navigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
});

it('rejects a restored NFT view without a collection identifier', () => {
  mockLocation.state = {
    nftCollection: true,
    nftData: {},
    returnContext: { returnRoute: '/home?tab=assets' },
  };
  render(<DetailsView />);
  expect(navigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
});

it.each([false, true])(
  'recovers transaction metadata from the current account when popup state has only a hash (UTXO=%s)',
  (bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    const tx = bitcoinBased
      ? { txid: '0xabc', value: 'authoritative' }
      : { hash: '0xabc', value: 'authoritative' };
    mockState.transactions[bitcoinBased ? 'syscoin' : 'ethereum'][1] = [tx];
    mockLocation.state = { hash: '0xABC' };
    render(<DetailsView />);
    expect(TransactionDetails).toHaveBeenCalledWith(
      { hash: '0xABC', tx },
      expect.anything()
    );
    expect(navigateBack).not.toHaveBeenCalled();
  }
);
