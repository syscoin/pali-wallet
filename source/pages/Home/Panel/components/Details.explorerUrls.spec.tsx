/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { clearRpcCaches, getSysRpc } from '@sidhujag/sysweb3-network';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { DetailsView } from './Details';
import { UtxoTransactionsListComponent } from './Transactions/UTXO/UtxoList';

let mockNetwork: any;
let mockIsBitcoinBased = true;
let mockLocation: any;
let mockTransaction: any;
const mockNavigate = jest.fn((pathname, options) => {
  mockLocation = {
    pathname,
    state: options.state,
    key: 'actual-row-navigation',
  };
});
jest.mock('react-redux', () => ({
  shallowEqual: jest.fn(),
  useSelector: (selector: any) =>
    selector({
      vault: { activeNetwork: mockNetwork, isBitcoinBased: mockIsBitcoinBased },
    }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    useCopyClipboard: () => [false, jest.fn(), () => true],
    alert: { success: jest.fn() },
  }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountAssets: () => ({ syscoin: [], ethereum: [] }),
  selectActiveAccountTransactions: () => ({
    syscoin: { [mockNetwork.chainId]: [mockTransaction] },
    ethereum: {},
  }),
}));
jest.mock('utils/index', () => ({
  adjustUrl: jest.requireActual('utils/strings').adjustUrl,
  ellipsis: jest.requireActual('utils/format').ellipsis,
  getTokenLogo: () => undefined,
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'fixture-account',
    network: mockNetwork.url,
  }),
  navigateBack: jest.fn(),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DetailArrowSvg: ({ onClick, ariaLabel }: any) => (
    <button aria-label={ariaLabel} onClick={onClick} />
  ),
  ExternalLinkSvg: () => null,
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('pages/Home/Panel/components/AssetDetails', () => ({
  AssetDetails: () => null,
}));
jest.mock('pages/Home/Panel/components/Nfts', () => ({
  NftsDetails: () => null,
}));
jest.mock('pages/Home/Panel/components/TransactionDetails', () => ({
  TransactionDetails: () => null,
}));

const TXID = 'ab'.repeat(32);
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  clearRpcCaches();
  mockIsBitcoinBased = true;
  mockLocation = { pathname: '/home', state: {}, key: 'home' };
  mockTransaction = {
    txid: TXID,
    blockHeight: 42,
    confirmations: 1,
    blockTime: 1700000000,
    fees: '1000',
    valueIn: '100000',
    value: '99000',
    addressValueIn: '100000',
    addressValueOut: '0',
    direction: 'sent',
    vin: [{ addresses: ['sys1sender'], value: '100000', isOwn: true }],
    vout: [{ addresses: ['sys1recipient'], value: '99000', isOwn: false }],
  };
  global.fetch = jest.fn(async (url) => {
    expect(String(url)).toBe('https://blockbook.synthetic.invalid/api/v2');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        blockbook: { coin: 'Syscoin' },
        backend: { chain: 'main' },
      }),
    } as Response;
  });
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const admit = async (explorer: string) => {
  const result = await getSysRpc({
    url: 'https://blockbook.synthetic.invalid',
    explorer,
    label: 'Synthetic public explorer',
    symbol: 'SYS',
    isSyscoinRpc: true,
  } as any);
  mockNetwork = result.rpc.formattedNetwork;
  expect(mockNetwork.explorer).toBe(explorer);
  return mockNetwork;
};
const navigateThroughRow = () => {
  const row = render(<UtxoTransactionsListComponent tx={mockTransaction} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'notifications.clickToView' })
  );
  expect(mockNavigate).toHaveBeenCalledWith('/home/details', {
    state: { id: null, hash: TXID, tx: mockTransaction },
  });
  row.unmount();
  render(<DetailsView />);
};

const base = 'https://explorer.synthetic.invalid';
const cases = [
  [base, base + '/tx/' + TXID],
  [base + '/public/', base + '/public/tx/' + TXID],
  [base + '/public//', base + '/public//tx/' + TXID],
  [
    base + '/public/?view=compact',
    base + '/public/tx/' + TXID + '?view=compact',
  ],
  [
    base + '/public/?next=%2Faccount%3Fx%3D1',
    base + '/public/tx/' + TXID + '?next=%2Faccount%3Fx%3D1',
  ],
  [base + '/#/', base + '/#/tx/' + TXID],
  [
    base + '/app/#/route?view=compact',
    base + '/app/#/route/tx/' + TXID + '?view=compact',
  ],
  [
    base + '/app/?outer=1#/route?inner=2',
    base + '/app/?outer=1#/route/tx/' + TXID + '?inner=2',
  ],
  [base + '/public/#section', base + '/public/tx/' + TXID + '#section'],
] as const;

describe.each([true, false])(
  'public transaction explorer links (UTXO=%s)',
  (isUtxo) => {
    it.each(cases)(
      'opens the expected resource for %s',
      async (explorer, expected) => {
        // Registration is the actual SDK UTXO producer. EVM controls then exercise
        // the same accepted URL field through its ordinary DetailsView branch.
        await admit(explorer);
        mockIsBitcoinBased = isUtxo;
        const apiUrl =
          'https://data.synthetic.invalid/api?chainid=5700&apikey=public-fixture';
        mockNetwork = { ...mockNetwork, apiUrl };
        const open = jest.spyOn(window, 'open').mockReturnValue(null);
        if (isUtxo) navigateThroughRow();
        else {
          mockLocation = {
            pathname: '/home/details',
            state: { hash: TXID },
            key: 'evm-details',
          };
          render(<DetailsView />);
        }
        fireEvent.click(
          screen.getByRole('button', { name: 'View on Explorer' })
        );
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(expected, '_blank');
        expect(mockNetwork.apiUrl).toBe(apiUrl);
        expect(mockNetwork.explorer).toBe(explorer);
      }
    );

    it('keeps the existing RPC URL fallback when no public explorer is present', async () => {
      await admit(base);
      mockIsBitcoinBased = isUtxo;
      mockNetwork = { ...mockNetwork, explorer: undefined };
      mockLocation = {
        pathname: '/home/details',
        state: { hash: TXID },
        key: 'fallback-details',
      };
      const open = jest.spyOn(window, 'open').mockReturnValue(null);
      render(<DetailsView />);
      fireEvent.click(screen.getByRole('button', { name: 'View on Explorer' }));
      expect(open).toHaveBeenCalledWith(
        'https://blockbook.synthetic.invalid/tx/' + TXID,
        '_blank'
      );
    });
  }
);
