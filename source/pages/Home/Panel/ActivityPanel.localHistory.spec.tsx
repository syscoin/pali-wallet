/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { TransactionsPanel } from './ActivityPanel';

// Subject: actual ActivityPanel, actual useEvmActivityHistory, actual contextual
// state and request-owner hooks. All inputs are synthetic public history DTOs.
// No signing/replay storage/provider/controller implementation is imported.
let mockState: any;
const mockEmitter = jest.fn();
let mockScope: { account: string; network: string };
const mockT = (key: string) => key;
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: { error: jest.fn() } }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithTransactions: (s: any) => ({
    account: s.publicAccount,
    transactions: s.publicTransactions,
  }),
  selectVaultCoreData: (s: any) => ({
    activeNetwork: s.vault.activeNetwork,
    isBitcoinBased: false,
    isSwitchingAccount: false,
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
}));
jest.mock('utils/smartAccount/addressIdentity', () => ({
  canPublishAccountAddress: () => true,
}));
jest.mock('utils/strings', () => ({
  selectExplorerUrl: () => null,
  buildExplorerUrl: () => '',
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Icon/Icon', () => ({ ExternalLinkSvg: () => null }));
jest.mock('components/Loader/SkeletonLoader', () => ({
  __esModule: true,
  default: () => <span>Skeleton</span>,
}));
jest.mock('pages/Home/Panel/components/Transactions/EVM/EvmList', () => ({
  EvmTransactionsList: ({ userTransactions, smartSignedOperations }: any) => (
    <div data-testid="rows">
      {userTransactions.map((row: any) => row.hash).join(',')}
      {smartSignedOperations?.map((row: any) => row.operationHash).join(',')}
    </div>
  ),
}));
jest.mock('pages/Home/Panel/components/Transactions/UTXO/UtxoList', () => ({
  UtxoTransactionsList: () => null,
}));

const HASH = `0x${'ab'.repeat(32)}`;
const SAVED = {
  hash: HASH,
  chainId: '57057',
  from: `0x${'11'.repeat(20)}`,
  to: `0x${'22'.repeat(20)}`,
  value: '1',
  createdAt: 1700000000000,
  type: 0,
  gasLimit: '21000',
  feePerGas: '1',
  dataBytes: 0,
  operation: 'send',
  nonce: 1,
};
const localReads = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path[1] === 'getSavedEvmTransactions'
  );
const flush = async () =>
  act(async () => {
    await Promise.resolve();
  });
beforeEach(() => {
  mockEmitter.mockReset();
  mockScope = { account: 'public-account-A', network: 'public-network-A' };
  mockState = {
    publicAccount: { address: SAVED.from },
    publicTransactions: { ethereum: { 57057: [] }, syscoin: {} },
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 57057,
        apiUrl: 'https://explorer.example.invalid/api',
        currency: 'sys',
      },
    },
    vaultGlobal: {
      transactionHistoryStatus: { scope: mockScope, state: 'ready' },
      isPollingUpdate: false,
    },
  };
});
afterEach(cleanup);

const retryButton = () => screen.getByRole('button', { name: 'receive.retry' });
const expectUnavailable = () => {
  expect(screen.getByRole('status')).toHaveTextContent('send.unableToLoad');
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  expect(retryButton()).toBeEnabled();
};

it('shows a failed initial local read in the Activity footer and retries only that source', async () => {
  mockEmitter.mockRejectedValueOnce(
    new Error('Synthetic saved-summary IPC unavailable')
  );
  const view = render(<TransactionsPanel />);
  await flush();
  expectUnavailable();
  expect(localReads()).toHaveLength(1);
  view.rerender(<TransactionsPanel />);
  await flush();
  expect(localReads()).toHaveLength(1);
  mockEmitter.mockResolvedValueOnce({
    transactions: [SAVED],
    nextCursor: null,
  });
  fireEvent.click(retryButton());
  await waitFor(() =>
    expect(screen.getByTestId('rows')).toHaveTextContent(HASH)
  );
  expect(localReads()).toHaveLength(2);
  expect(
    mockEmitter.mock.calls.every(
      ([path]) => path[1] === 'getSavedEvmTransactions'
    )
  ).toBe(true);
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
});

it('keeps a genuinely successful empty local read in the ordinary qualified empty state', async () => {
  mockEmitter.mockResolvedValueOnce({ transactions: [], nextCursor: null });
  render(<TransactionsPanel />);
  await flush();
  expect(screen.getByText('home.noIndexedActivity')).toBeVisible();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
  expect(localReads()).toHaveLength(1);
});

it('shows a signed-only operation in the ordinary list and retires it on Activity reset', async () => {
  mockState.vault.activeAccount.type = 'SmartAccount';
  const instruction = {
    account: SAVED.from,
    chainId: SAVED.chainId,
    createdAt: SAVED.createdAt,
    operationHash: HASH,
    status: 'unresolved',
  };
  mockEmitter.mockResolvedValue({
    transactions: [],
    nextCursor: null,
    signedOperations: [instruction],
  });
  const view = render(<TransactionsPanel />);
  await flush();
  expect(screen.getByTestId('rows')).toHaveTextContent(HASH);
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();

  mockState.publicAccount.evmActivityClearedAtByChainId = {
    57057: instruction.createdAt,
  };
  view.rerender(<TransactionsPanel />);
  await flush();
  expect(screen.queryByTestId('rows')).toBeNull();
  expect(screen.getByText('home.noIndexedActivity')).toBeVisible();
});

it('keeps initial local availability pending until its captured read settles', async () => {
  let resolve!: (value: any) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  render(<TransactionsPanel />);
  await flush();
  expect(
    screen.getByText('networkConnection.loadingTransactions')
  ).toBeVisible();
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  await act(async () => resolve({ transactions: [], nextCursor: null }));
  expect(screen.getByText('home.noIndexedActivity')).toBeVisible();
});

it('retains focus recovery and successful rows after a later local refresh failure', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Synthetic initial failure'));
  render(<TransactionsPanel />);
  await flush();
  expectUnavailable();
  mockEmitter.mockResolvedValueOnce({
    transactions: [SAVED],
    nextCursor: null,
  });
  fireEvent(window, new Event('focus'));
  await waitFor(() =>
    expect(screen.getByTestId('rows')).toHaveTextContent(HASH)
  );
  mockEmitter.mockRejectedValueOnce(new Error('Synthetic later failure'));
  fireEvent(window, new Event('focus'));
  await flush();
  expect(screen.getByTestId('rows')).toHaveTextContent(HASH);
  expect(retryButton()).toBeEnabled();
  expect(localReads()).toHaveLength(3);
});

it('retries both failed sources through one footer and keeps the button when rows arrive', async () => {
  mockState.vaultGlobal.transactionHistoryStatus.state = 'error';
  mockEmitter.mockRejectedValueOnce(new Error('Initial local failure'));
  const view = render(<TransactionsPanel />);
  await flush();
  expectUnavailable();
  const button = retryButton();
  let resolveLocal!: (value: any) => void;
  let resolveRemote!: () => void;
  mockEmitter.mockImplementation(([, method]) =>
    method === 'getSavedEvmTransactions'
      ? new Promise((done) => {
          resolveLocal = done;
        })
      : new Promise<void>((done) => {
          resolveRemote = done;
        })
  );
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'refreshTransactionHistory'],
    [mockScope]
  );
  expect(mockEmitter).toHaveBeenCalledTimes(3);
  await act(async () =>
    resolveLocal({ transactions: [SAVED], nextCursor: null })
  );
  expect(screen.getByTestId('rows')).toHaveTextContent(HASH);
  expect(retryButton()).toBe(button);
  expect(button).toBeDisabled();

  await act(async () => resolveRemote());
  expect(retryButton()).toBe(button);
  expect(button).toBeEnabled();
  mockState.vaultGlobal.transactionHistoryStatus.state = 'ready';
  view.rerender(<TransactionsPanel />);
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
});

it('keeps successful remote rows visible and coalesces user retry while the local read is pending', async () => {
  mockState.publicTransactions.ethereum[57057] = [{ hash: HASH }];
  mockEmitter.mockRejectedValueOnce(new Error('Synthetic local failure'));
  render(<TransactionsPanel />);
  await flush();
  expect(screen.getByTestId('rows')).toHaveTextContent(HASH);
  let resolve!: (value: any) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  fireEvent.click(retryButton());
  fireEvent.click(retryButton());
  expect(retryButton()).toBeDisabled();
  expect(localReads()).toHaveLength(2);
  expect(screen.getByTestId('rows')).toHaveTextContent(HASH);
  await act(async () => resolve({ transactions: [], nextCursor: null }));
  expect(screen.getByTestId('rows')).toHaveTextContent(HASH);
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
});

it('shows indexed Activity for a watch-only import without reading local signed records', async () => {
  mockState.vault.activeAccount.type = 'Imported';
  mockState.publicTransactions.ethereum[57057] = [{ hash: HASH }];
  render(<TransactionsPanel />);
  await flush();
  expect(screen.getByTestId('rows')).toHaveTextContent(HASH);
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
});
