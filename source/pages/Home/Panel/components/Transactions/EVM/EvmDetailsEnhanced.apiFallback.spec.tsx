/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import en from 'assets/locales/en.json';
import EvmTransactionsController from 'scripts/Background/controllers/transactions/evm';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';

const API = 'https://explorer.synthetic.invalid/api';
const RPC = 'https://rpc.synthetic.invalid';
const OWNER = `0x${'11'.repeat(20)}`;
const OTHER_OWNER = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const mockCopy = jest.fn();
const mockAlert = { info: jest.fn(), warning: jest.fn(), error: jest.fn() };
const mockRpc = jest.fn();
let mockState: any;
let sequence = 0;
let requests: { method: string; params: any[] }[];
let apiTransportError: string | undefined;
let replyToFetch: (hash: string) => Promise<any>;
let releases: (() => void)[];
const originalChrome = global.chrome;
const originalFetch = global.fetch;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dictionary = jest.requireActual('assets/locales/en.json');
      return (
        key.split('.').reduce((value, part) => value?.[part], dictionary) ?? key
      );
    },
  }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => mockState.account,
  selectActiveAccountTransactions: () => ({ ethereum: {} }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: mockState.account.address,
    network: JSON.stringify(mockState.vault.activeNetwork),
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: jest.requireActual(
      'scripts/Background/controllers/controllerEmitter'
    ).controllerEmitter,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, mockCopy],
    alert: mockAlert,
  }),
  useTransactionsListConfig: jest.requireActual(
    'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos'
  ).useTransactionsListConfig,
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
  camelCaseToText: (value: string) =>
    value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase()),
}));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: () => null,
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: jest.requireActual(
    'components/TransactionDetails/TransactionHeader'
  ).TransactionHeader,
  TransactionDetailsList: jest.requireActual(
    'components/TransactionDetails/TransactionDetailsList'
  ).TransactionDetailsList,
  TransactionEventLogs: () => null,
  DecodedTransactionParams: () => null,
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
// Only the explorer-detail method is exercised from this controller. Its
// actual retryableFetch path is retained; unrelated polling/signing is inert.
jest.mock('@sidhujag/sysweb3-keyring', () => ({}));
jest.mock('scripts/Background/controllers/transactions/utils', () => ({}));
jest.mock(
  'scripts/Background/controllers/transactions/smartAccountHistory',
  () => ({})
);

const transaction = (hash: string, value = '7000000000000000000') => ({
  hash,
  from: mockState.account.address,
  to: RECIPIENT,
  value,
  chainId: mockState.vault.activeNetwork.chainId,
  blockNumber: 42,
  blockHash: `0x${'ab'.repeat(32)}`,
  confirmations: 3,
  timestamp: 1700000000,
  input: '0x',
  success: true,
  status: 'success',
});
const response = (result: any) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: result ? '1' : '0', result }),
});
const holdFetch = () => {
  const held: { hash: string; resolve: (result: any) => void }[] = [];
  replyToFetch = (hash) =>
    new Promise((resolve) => {
      held.push({ hash, resolve });
      releases.push(() => resolve(response(null)));
    });
  return held;
};
const flush = async (milliseconds = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });
};
const mount = () => {
  const hash = `0x${(++sequence).toString(16).padStart(64, '0')}`;
  // Hash-only input is the real saved-route shape after popup recreation:
  // navigationState intentionally does not persist full transaction bodies.
  const view = render(<EvmTransactionDetailsEnhanced hash={hash} />);
  return { hash, view };
};
const expectDetails = async (hash: string, amount = '7') => {
  await flush();
  expect(screen.getByText(`${amount} SYS`)).toBeVisible();
  expect(
    screen.queryByText(en.transactions.transactionNotFoundOrPending)
  ).toBeNull();
  const copy = screen.getByRole('button', {
    name: `${en.buttons.copy}: ${en.send.transactionId}`,
  });
  fireEvent.click(copy);
  await flush();
  expect(mockCopy).toHaveBeenLastCalledWith(hash);
};
const apiRequests = () =>
  requests.filter(({ method }) => method === 'getEvmTransactionFromAPI');

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  requests = [];
  releases = [];
  apiTransportError = undefined;
  mockState = {
    account: { id: 0, address: OWNER },
    vault: {
      isBitcoinBased: false,
      activeNetwork: { chainId: 5700, currency: 'sys', url: RPC, apiUrl: API },
    },
  };
  mockCopy.mockResolvedValue(undefined);
  mockRpc.mockImplementation(async (hash: string) => transaction(hash));
  replyToFetch = async (hash) => response(transaction(hash));
  const explorer = EvmTransactionsController();
  global.chrome = {
    runtime: {
      id: 'synthetic-explorer-fallback',
      sendMessage: (request: any, callback: (value: any) => void) => {
        const [, method] = request.data.methods;
        const params = request.data.params;
        requests.push({ method, params });
        let result: Promise<any>;
        if (method === 'getEvmTransactionFromAPI') {
          result = apiTransportError
            ? Promise.reject(new Error(apiTransportError))
            : explorer.fetchTransactionDetailsFromAPI(params[0], params[1]);
        } else if (method === 'getEvmTransactionFromProvider') {
          // Public normalized provider data, not a replacement component or
          // injected selected state. No signing method is admitted here.
          result = mockRpc(params[0]);
        } else throw new Error(`Unexpected controller method ${method}`);
        void result.then(callback, (error) =>
          callback({ error: error.message })
        );
      },
    },
  } as any;
  global.fetch = jest.fn(async (input) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(API);
    expect(url.searchParams.get('module')).toBe('transaction');
    expect(url.searchParams.get('action')).toBe('gettxinfo');
    expect(url.searchParams.get('txhash')).toMatch(/^0x[0-9a-f]{64}$/);
    return replyToFetch(url.searchParams.get('txhash')!);
  }) as typeof fetch;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
});

afterEach(async () => {
  releases.forEach((release) => release());
  await flush();
  expect(
    requests.every(({ method }) =>
      ['getEvmTransactionFromAPI', 'getEvmTransactionFromProvider'].includes(
        method
      )
    )
  ).toBe(true);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
  global.fetch = originalFetch;
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

it('keeps fast valid explorer details and exact hash copy without an unnecessary RPC read', async () => {
  const { hash } = mount();
  await expectDetails(hash);
  expect(apiRequests()).toHaveLength(1);
  expect(mockRpc).not.toHaveBeenCalled();
});

it('uses the healthy RPC fallback when the explorer returns no details', async () => {
  replyToFetch = async () => response(null);
  const { hash } = mount();
  await expectDetails(hash);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith(hash);
});

it('uses the same RPC fallback when the explorer controller call rejects', async () => {
  apiTransportError = 'Synthetic explorer transport refusal';
  const { hash } = mount();
  await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith(hash);
  await expectDetails(hash);
});

it('falls back after the real emitter deadline while the genuine explorer HTTP read is still pending', async () => {
  const held = holdFetch();
  const { hash } = mount();
  await flush();
  expect(held).toHaveLength(1);
  expect(apiRequests()).toHaveLength(1);
  expect(mockRpc).not.toHaveBeenCalled();
  await flush(9999);
  expect(mockRpc).not.toHaveBeenCalled();
  expect(
    screen.queryByText(en.transactions.transactionNotFoundOrPending)
  ).toBeNull();
  await flush(1);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith(hash);
  await expectDetails(hash);
  await act(async () =>
    held[0].resolve(response(transaction(hash, '9000000000000000000')))
  );
  await flush();
  expect(screen.getByText('7 SYS')).toBeVisible();
  expect(screen.queryByText('9 SYS')).toBeNull();
  expect(mockRpc).toHaveBeenCalledTimes(1);
});

it('keeps an RPC refusal neutral without fabricating details or triggering writes', async () => {
  replyToFetch = async () => response(null);
  mockRpc.mockRejectedValue(new Error('Synthetic provider unavailable'));
  const { hash } = mount();
  await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith(hash);
  expect(
    screen.getByText(en.transactions.transactionNotFoundOrPending)
  ).toBeVisible();
  expect(
    screen.queryByRole('button', {
      name: `${en.buttons.copy}: ${en.send.transactionId}`,
    })
  ).toBeNull();
  expect(mockCopy).not.toHaveBeenCalled();
});

it('retains the existing direct RPC path on a Routescan network', async () => {
  mockState.vault.activeNetwork = {
    chainId: 1,
    currency: 'sys',
    url: RPC,
    apiUrl: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
  };
  const { hash } = mount();
  await expectDetails(hash);
  expect(apiRequests()).toHaveLength(0);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith(hash);
});

it.each(['account', 'rpc'] as const)(
  'ignores a late old explorer result after the %s scope changes',
  async (kind) => {
    const held = holdFetch();
    const { hash, view } = mount();
    await flush();
    expect(held).toHaveLength(1);
    const oldResult = transaction(hash);
    if (kind === 'account') mockState.account = { id: 1, address: OTHER_OWNER };
    else
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: `${RPC}/replacement`,
      };
    replyToFetch = async () =>
      response(transaction(hash, '9000000000000000000'));
    view.rerender(<EvmTransactionDetailsEnhanced hash={hash} />);
    await expectDetails(hash, '9');
    await act(async () => held[0].resolve(response(oldResult)));
    await flush();
    expect(screen.getByText('9 SYS')).toBeVisible();
    expect(screen.queryByText('7 SYS')).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  }
);

it.each(
  (['account', 'rpc'] as const).flatMap((kind) =>
    [false, true].map((roundTrip) => ({ kind, roundTrip }))
  )
)(
  'does not start stale RPC fallback after an old timeout ($kind, round trip=$roundTrip)',
  async ({ kind, roundTrip }) => {
    const held = holdFetch();
    const { hash, view } = mount();
    await flush();
    expect(held).toHaveLength(1);
    const oldResult = transaction(hash);
    const originalAccount = mockState.account;
    const originalNetwork = mockState.vault.activeNetwork;
    if (kind === 'account') mockState.account = { id: 1, address: OTHER_OWNER };
    else
      mockState.vault.activeNetwork = {
        ...originalNetwork,
        url: `${RPC}/timeout-replacement`,
      };
    replyToFetch = async () =>
      response(transaction(hash, '9000000000000000000'));
    view.rerender(<EvmTransactionDetailsEnhanced hash={hash} />);
    await expectDetails(hash, '9');

    if (roundTrip) {
      mockState.account = originalAccount;
      mockState.vault.activeNetwork = originalNetwork;
      replyToFetch = async () =>
        response(transaction(hash, '11000000000000000000'));
      view.rerender(<EvmTransactionDetailsEnhanced hash={hash} />);
      await expectDetails(hash, '11');
    }

    await flush(9999);
    expect(mockRpc).not.toHaveBeenCalled();
    await flush(1);
    // Even A -> B -> A cannot revive the first A effect's cancelled lifetime.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(apiRequests()).toHaveLength(roundTrip ? 3 : 2);
    expect(screen.getByText(`${roundTrip ? '11' : '9'} SYS`)).toBeVisible();
    expect(
      screen.queryByText(en.transactions.transactionNotFoundOrPending)
    ).toBeNull();
    await act(async () => held[0].resolve(response(oldResult)));
    await flush();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByText(`${roundTrip ? '11' : '9'} SYS`)).toBeVisible();
    expect(screen.queryByText('7 SYS')).toBeNull();
    expect(mockCopy).toHaveBeenLastCalledWith(hash);
  }
);

it.each(['null', 'wrong hash', 'wrong chain', 'partial'] as const)(
  'keeps malformed fallback data neutral (%s)',
  async (kind) => {
    apiTransportError = 'Synthetic explorer unavailable';
    mockRpc.mockImplementation(async (hash: string) => {
      if (kind === 'null') return null;
      if (kind === 'wrong hash') return transaction(`0x${'fe'.repeat(32)}`);
      if (kind === 'wrong chain') return { ...transaction(hash), chainId: 1 };
      return { hash, gasUsed: '21000' };
    });
    const { hash } = mount();
    await flush();
    expect(apiRequests()).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(hash);
    expect(
      screen.getByText(en.transactions.transactionNotFoundOrPending)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: `${en.buttons.copy}: ${en.send.transactionId}`,
      })
    ).toBeNull();
    expect(mockCopy).not.toHaveBeenCalled();
    expect(screen.queryByText('7 SYS')).toBeNull();
  }
);

it.each(['rejection', 'timeout'] as const)(
  'settles a double failure after explorer %s without a retry loop or fabricated details',
  async (kind) => {
    if (kind === 'rejection')
      apiTransportError = 'Synthetic explorer unavailable';
    else holdFetch();
    mockRpc.mockRejectedValue(new Error('Synthetic provider unavailable'));
    const { hash } = mount();
    await flush(kind === 'timeout' ? 10000 : 0);
    expect(apiRequests()).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(hash);
    expect(
      screen.getByText(en.transactions.transactionNotFoundOrPending)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: `${en.buttons.copy}: ${en.send.transactionId}`,
      })
    ).toBeNull();
    expect(mockCopy).not.toHaveBeenCalled();
    await flush(10000);
    expect(apiRequests()).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  }
);
