/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { Tooltip } from 'components/Tooltip';
import { EvmTransactionDetailsEnhanced } from 'pages/Home/Panel/components/Transactions/EVM/EvmDetailsEnhanced';
import MainController from 'scripts/Background/controllers/MainController';
import { Interface } from 'utils/ethersV6Compat';
import { ellipsis } from 'utils/format';

const mockHttp = jest.fn<any, any[]>(() => {
  throw new Error('Public HTTP forbidden');
});
jest.mock('utils/retryableFetch', () => ({
  retryableFetch: (...args: any[]) => mockHttp(...args),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// Deliberately retain real Tooltip, Tippy, DecodedTransactionParams and decoder.
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
  camelCaseToText: (value: string) =>
    value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase()),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ useCopyClipboard: () => [false, jest.fn()], alert: {} }),
  useTransactionsListConfig: () => ({
    getTxType: () => 'Sent',
    getTxStatusIcons: () => null,
    getTxStatus: () => 'Confirmed',
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: ACCOUNT,
    network: 'keyboard-tooltip-native',
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ id: 0, address: ACCOUNT }),
  selectActiveAccountTransactions: () => ({ ethereum: { 5700: mockHistory } }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: () => null,
}));
jest.mock('utils/transactions', () => ({
  getSmartAccountDisplayTransaction: (tx: any) => tx,
  getSmartAccountExecutionTransactions: () => [],
  getTransactionDisplayInfo: async () => ({
    formattedValue: '0',
    displayValue: '0',
    displaySymbol: 'ETH',
    actualRecipient: TARGET,
    isErc20Transfer: false,
    isNft: false,
  }),
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: () => <div data-testid="header" />,
  TransactionDetailsList: ({ details: items }: any) => (
    <div>
      {items.map((item: any, index: number) => (
        <span key={index}>
          {item.label}:{String(item.value)}|
        </span>
      ))}
    </div>
  ),
  TransactionEventLogs: () => null,
  DecodedTransactionParams: jest.requireActual(
    'components/TransactionDetails/DecodedTransactionParams'
  ).DecodedTransactionParams,
}));

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const LONG = '123456789012345678901';
const ABI = [
  'function transfer(address to,uint256 value)',
  'function approve(address spender,uint256 amount)',
];
const token = new Interface(ABI);
const mockState: any = {
  vaultGlobal: { activeSlip44: 60 },
  vault: {
    activeNetwork: {
      chainId: 5700,
      kind: 'ethereum',
      currency: 'ETH',
      url: 'https://synthetic.invalid',
    },
  },
};
let mockHistory: any[] = [];
const mockEmitter = jest.fn();
let sequence = 0;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: mockHttp,
  });
});
afterEach(() => {
  cleanup();
  expect(mockHttp).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.every(([[, method]]) =>
      ['getEvmTransactionFromProvider', 'decodeEvmTransactionData'].includes(
        method
      )
    )
  ).toBe(true);
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  jest.restoreAllMocks();
});

async function details(amount: string, method = 'transfer') {
  const tx = {
    hash: `0x${(++sequence).toString(16).padStart(64, '0')}`,
    from: ACCOUNT,
    to: TARGET,
    input: token.encodeFunctionData(method, [RECIPIENT, amount]),
    value: '0',
    chainId: 5700,
    blockNumber: 42,
    confirmations: 3,
  };
  mockHistory = [tx];
  const wallet: any = Object.create(MainController.prototype);
  wallet.keyrings = new Map([
    [
      60,
      {
        ethereumTransaction: {
          web3Provider: { call: async () => `0x${'0'.repeat(64)}` },
        },
      },
    ],
  ]);
  wallet.getErc20Abi = async () => ABI;
  mockEmitter.mockImplementation(([, requestMethod], args) => {
    if (requestMethod === 'getEvmTransactionFromProvider')
      return Promise.resolve(tx);
    if (requestMethod === 'decodeEvmTransactionData')
      return wallet.decodeEvmTransactionData(args[0]);
    throw new Error(`Unexpected controller method: ${requestMethod}`);
  });
  render(
    <>
      <button type="button">Before details</button>
      <EvmTransactionDetailsEnhanced hash={tx.hash} tx={tx as any} />
      <button type="button">After details</button>
    </>
  );
  const visible =
    method === 'transfer' && amount.length > 20
      ? ellipsis(amount, 10, 4)
      : amount;
  const value = await screen.findByText(visible, { exact: true });
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'decodeEvmTransactionData'],
    [expect.objectContaining({ input: tx.input })]
  );
  const decoded = await wallet.decodeEvmTransactionData(tx);
  expect(decoded.inputs[1]).toBe(amount);
  expect(value.parentElement!.tagName).toBe('DIV');
  return { value, reference: value.parentElement!, user: userEvent.setup() };
}

it('retains hover access to the exact decoded long integer', async () => {
  const { reference, user } = await details(LONG);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  await user.hover(reference);
  const tooltip = await screen.findByRole('tooltip');
  expect(within(tooltip).getByText(LONG, { exact: true })).toBeVisible();
});

it('exposes and dismisses the exact decoded integer through native Tab focus and Escape', async () => {
  const { reference, user } = await details(LONG);
  expect(reference).toHaveAttribute('tabindex', '0');
  expect(reference.classList.contains('focus-visible:outline')).toBe(true);
  expect(reference.classList.contains('focus-visible:outline-2')).toBe(true);
  for (let step = 0; step < 6 && document.activeElement !== reference; step++)
    await user.tab();
  expect(reference).toHaveFocus();
  const tooltip = await screen.findByRole('tooltip');
  expect(tooltip).toHaveTextContent(LONG);
  const descriptionId = reference.getAttribute('aria-describedby');
  expect(descriptionId).toBeTruthy();
  expect(document.getElementById(descriptionId!)).toContainElement(tooltip);
  expect(reference).not.toHaveAttribute('aria-expanded');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(tooltip).not.toBeVisible());
  expect(reference).toHaveFocus();
  expect(reference).not.toHaveAttribute('aria-describedby');
});

it('adds keyboard access to a shortened actual approval address', async () => {
  await details('17', 'approve');
  const visible = '0x' + ellipsis(RECIPIENT.slice(2), 4, 4);
  const value = screen.getByText(visible, { exact: true });
  const reference = value.parentElement!;
  const user = userEvent.setup();
  expect(reference).toHaveAttribute('tabindex', '0');
  for (let step = 0; step < 6 && document.activeElement !== reference; step++)
    await user.tab();
  expect(reference).toHaveFocus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent(RECIPIENT);
  expect(screen.getByText('17', { exact: true })).toBeVisible();
});

it('keeps a short integer fully visible without an additional Tab stop', async () => {
  const { value, reference, user } = await details('17');
  expect(value).toHaveTextContent(/^17$/);
  expect(reference).not.toHaveAttribute('tabindex');
  const visited: Element[] = [];
  for (let step = 0; step < 8; step++) {
    await user.tab();
    visited.push(document.activeElement!);
    if (
      document.activeElement ===
      screen.getByRole('button', { name: 'After details' })
    )
      break;
  }
  expect(visited).not.toContain(reference);
  expect(screen.getByRole('button', { name: 'After details' })).toHaveFocus();
  expect(value).toBeVisible();
});

it('keeps unrelated Tooltip callers non-focusable by default', async () => {
  render(
    <>
      <button>Before default</button>
      <Tooltip content={LONG}>
        <span>Default label</span>
      </Tooltip>
      <button>After default</button>
    </>
  );
  const reference = screen.getByText('Default label').parentElement!;
  expect(reference).not.toHaveAttribute('tabindex');
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Before default' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After default' })).toHaveFocus();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
