/** @jest-environment jsdom */
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { navigateBack } from 'utils/navigationState';

import { DetailsView } from './Details';
import { TransactionDetails } from './TransactionDetails';
import { openUtxoReplacementTab } from './Transactions/UTXO/utxoReplacementNavigation';

let mockState: any;
let mockLocation: any;
const mockNavigate = jest.fn();
const mockEmitter = jest.fn();

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
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: unknown[]) => mockEmitter(...args),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountTransactions: (state: any) => state.transactions,
}));
jest.mock('components/Icon/Icon', () => ({ ExternalLinkSvg: () => null }));
jest.mock('utils/index', () => ({ adjustUrl: (url: string) => url }));
jest.mock('utils/navigationState', () => ({
  navigateBack: jest.fn(),
  getWalletNavigationScope: () => ({
    account: mockState.scopeAccount || 'account1',
    network: mockState.scopeNetwork || 'network1',
  }),
}));
jest.mock('./AssetDetails', () => ({ AssetDetails: () => null }));
jest.mock('./Nfts', () => ({ NftsDetails: () => null }));
jest.mock('./TransactionDetails', () => ({
  TransactionDetails: jest.fn(() => null),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue({ cancel: false, speedUp: false });
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

it.each(['account', 'network'])(
  'drops an old route summary after the %s scope changes',
  (field) => {
    const oldTx = { hash: '0xabc', txid: '0xabc', value: 'old-account' };
    mockLocation.state = {
      hash: '0xabc',
      tx: oldTx,
      walletScope: { account: 'account1', network: 'network1' },
    };
    mockState[field === 'account' ? 'scopeAccount' : 'scopeNetwork'] =
      'changed';
    render(<DetailsView />);
    expect(TransactionDetails).toHaveBeenCalledWith(
      { hash: '0xabc', tx: undefined },
      expect.anything()
    );
  }
);

it('retains the same-document summary only in its exact wallet scope', () => {
  const tx = { hash: '0xabc', value: 'current-account' };
  mockLocation.state = {
    hash: '0xabc',
    tx,
    walletScope: { account: 'account1', network: 'network1' },
  };
  render(<DetailsView />);
  expect(TransactionDetails).toHaveBeenCalledWith(
    { hash: '0xabc', tx },
    expect.anything()
  );
});

it.each(['1', '0'])(
  'passes the current own receipt %s after history changes with an unchanged pending route summary',
  (receipt) => {
    const pending = {
      hash: `0x${'ab'.repeat(32)}`,
      value: '7',
      blockNumber: null,
      confirmations: 0,
      isReplaced: true,
    };
    mockLocation.state = {
      hash: pending.hash,
      tx: pending,
      walletScope: { account: 'account1', network: 'network1' },
    };
    const location = mockLocation;
    mockState.transactions.ethereum[1] = [pending];
    const view = render(<DetailsView />);
    expect(TransactionDetails).toHaveBeenLastCalledWith(
      { hash: pending.hash, tx: pending },
      expect.anything()
    );

    const mined = {
      ...pending,
      blockNumber: 42,
      confirmations: 1,
      // eslint-disable-next-line camelcase
      txreceipt_status: receipt,
    };
    mockState = {
      ...mockState,
      transactions: {
        ...mockState.transactions,
        ethereum: { ...mockState.transactions.ethereum, 1: [mined] },
      },
    };
    view.rerender(<DetailsView />);

    expect(TransactionDetails).toHaveBeenLastCalledWith(
      { hash: pending.hash, tx: mined },
      expect.anything()
    );
    expect(mockLocation).toBe(location);
    expect(mockLocation.state.tx).toBe(pending);
    expect(mockLocation.state.tx.blockNumber).toBeNull();
    expect(navigateBack).not.toHaveBeenCalled();
  }
);

it.each([123, false, {}, ''])(
  'rejects malformed direct transaction hash %p safely',
  (hash) => {
    mockLocation.state = {
      hash,
      returnContext: { returnRoute: '/home?tab=activity' },
    };
    const { container } = render(<DetailsView />);
    expect(container.innerHTML).toBe('');
    expect(navigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
  }
);

it('forwards scoped paginated evidence beside the live original receipt', () => {
  const hash = `0x${'ab'.repeat(32)}`;
  const winnerHash = `0x${'cd'.repeat(32)}`;
  const tx = { hash, blockNumber: 42, value: 'live' };
  const proof = { hash: winnerHash, from: 'outer-payer', nonce: 8 };
  mockState.transactions.ethereum[1] = [tx];
  mockLocation.state = {
    hash,
    tx: { hash, blockNumber: null },
    replacementWinnerHash: winnerHash.toUpperCase().replace('0X', '0x'),
    replacementWinner: proof,
    walletScope: { account: 'account1', network: 'network1' },
  };
  render(<DetailsView />);
  expect(TransactionDetails).toHaveBeenCalledWith(
    { hash, tx, replacementWinnerHash: winnerHash, replacementWinner: proof },
    expect.anything()
  );
});

it.each(['account', 'network', 'unscoped', 'utxo', 'malformed', 'same-hash'])(
  'drops replacement evidence for %s routes',
  (mode) => {
    const hash = `0x${'ab'.repeat(32)}`;
    mockLocation.state = {
      hash,
      replacementWinnerHash:
        mode === 'same-hash'
          ? hash
          : mode === 'malformed'
          ? '0xabc'
          : `0x${'cd'.repeat(32)}`,
      replacementWinner: { input: 'untrusted route payload' },
      walletScope:
        mode === 'unscoped'
          ? undefined
          : { account: 'account1', network: 'network1' },
    };
    if (mode === 'account') mockState.scopeAccount = 'account2';
    if (mode === 'network') mockState.scopeNetwork = 'rpc2';
    if (mode === 'utxo') mockState.vault.isBitcoinBased = true;
    render(<DetailsView />);
    expect(TransactionDetails).toHaveBeenCalledWith(
      { hash, tx: undefined },
      expect.anything()
    );
  }
);

it('reopens hardware activity in a wallet tab from the currently selected account only', async () => {
  const txid = 'ab'.repeat(32);
  const tx = { txid, value: 'current-account' };
  mockState.vault.isBitcoinBased = true;
  mockState.transactions.syscoin[1] = [tx];
  mockLocation.search = `?utxoTxid=${txid}`;
  const view = render(<DetailsView />);
  expect(TransactionDetails).toHaveBeenLastCalledWith(
    { hash: txid, tx },
    expect.anything()
  );

  jest.mocked(TransactionDetails).mockClear();
  mockState.transactions.syscoin[1] = [];
  view.rerender(<DetailsView />);
  expect(TransactionDetails).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(navigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation)
  );
});

it('opens a paged hardware predecessor in its wallet tab through the ownership lookup', async () => {
  const txid = 'ab'.repeat(32);
  const tx = { txid, direction: 'sent' };
  const walletScope = { account: 'account1', network: 'network1' };
  mockState.vault.isBitcoinBased = true;
  mockState.transactions.syscoin[1] = [{ txid: 'cd'.repeat(32) }];
  mockLocation = {
    ...mockLocation,
    key: 'popup',
    state: { hash: txid, tx, walletScope },
  };
  const view = render(<DetailsView />);
  expect(TransactionDetails).toHaveBeenLastCalledWith(
    expect.objectContaining({ hash: txid, tx }),
    expect.anything()
  );
  expect(mockEmitter).not.toHaveBeenCalled();

  let openedURL: string;
  const previous = globalThis.chrome;
  globalThis.chrome = {
    ...previous,
    runtime: {
      ...previous.runtime,
      getURL: (path) => `chrome-extension://pali-extension/${path}`,
    },
    tabs: {
      ...previous.tabs,
      create: (options, callback) => {
        openedURL = options.url;
        callback({ id: 7 } as chrome.tabs.Tab);
      },
    },
  } as typeof chrome;
  try {
    await openUtxoReplacementTab(txid);
  } finally {
    globalThis.chrome = previous;
  }
  mockEmitter.mockResolvedValueOnce({
    hardware: true,
    speedUp: true,
    cancel: true,
  });
  mockLocation = {
    ...mockLocation,
    key: 'wallet-tab',
    state: null,
    search: openedURL.slice(openedURL.indexOf('?')),
  };
  view.rerender(<DetailsView />);
  await waitFor(() =>
    expect(TransactionDetails).toHaveBeenLastCalledWith(
      { hash: txid, tx: undefined, ownedUtxoReplacementTarget: true },
      expect.anything()
    )
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getUtxoReplacementActions'],
    [txid, walletScope],
    15_000,
    false
  );
  expect(navigateBack).not.toHaveBeenCalled();
});

it.each(['scopeAccount', 'scopeNetwork'])(
  'drops a pending hardware lookup when %s changes',
  async (field) => {
    let resolveLookup: (value: unknown) => void;
    mockEmitter.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLookup = resolve;
      })
    );
    mockState.vault.isBitcoinBased = true;
    mockLocation.search = `?utxoTxid=${'ab'.repeat(32)}`;
    const view = render(<DetailsView />);
    mockState[field] = 'new';
    view.rerender(<DetailsView />);
    await act(async () =>
      resolveLookup({ cancel: true, speedUp: true, hardware: true })
    );
    expect(TransactionDetails).not.toHaveBeenCalled();
    expect(navigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
  }
);
