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

import { EvmTransactionDetailsEnhanced } from 'pages/Home/Panel/components/Transactions/EVM/EvmDetailsEnhanced';
import MainController from 'scripts/Background/controllers/MainController';
import { Interface } from 'utils/ethersV6Compat';
import { ellipsis } from 'utils/format';
import { paliSmartAccountInterface } from 'utils/smartAccount/contracts';

const mockHttp = jest.fn<any, any[]>(() => {
  throw new Error('Public HTTP forbidden');
});
// Decorative icon only; retain the actual native IconButton and real Tippy.
jest.mock('components/Icon', () => ({
  Icon: () => <span aria-hidden="true" />,
}));
jest.mock('utils/retryableFetch', () => ({
  retryableFetch: (...args: any[]) => mockHttp(...args),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key
        .split('.')
        .reduce(
          (value: any, part: string) => value?.[part],
          jest.requireActual('assets/locales/en.json')
        ) || key,
  }),
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
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: { info: jest.fn(), error: jest.fn(), warning: jest.fn() },
  }),
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
  TransactionDetailsList: jest.requireActual(
    'components/TransactionDetails/TransactionDetailsList'
  ).TransactionDetailsList,
  TransactionEventLogs: () => null,
  DecodedTransactionParams: jest.requireActual(
    'components/TransactionDetails/DecodedTransactionParams'
  ).DecodedTransactionParams,
}));

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
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
  const isBytes = method === 'bytes' || method === 'bytes32';
  const tx = {
    hash: `0x${(++sequence).toString(16).padStart(64, '0')}`,
    from: ACCOUNT,
    to: TARGET,
    input: isBytes
      ? paliSmartAccountInterface.encodeFunctionData('execute', [
          method === 'bytes32' ? amount : `0xfe${'00'.repeat(31)}`,
          method === 'bytes' ? amount : '0x1234',
        ])
      : token.encodeFunctionData(method, [RECIPIENT, amount]),
    value: '0',
    chainId: 5700,
    blockNumber: 42,
    confirmations: 3,
    timestamp: 1792559353,
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
  wallet.getErc20Abi = jest.fn(async () => ABI);
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
  const value = isBytes
    ? (
        await screen.findByText(
          method === 'bytes32' ? 'mode' : 'executionCalldata',
          {
            exact: false,
            selector: 'span.text-brand-gray200',
          }
        )
      ).parentElement!.querySelector<HTMLElement>('span.font-mono')!
    : await screen.findByText(visible, { exact: true });
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'decodeEvmTransactionData'],
    [expect.objectContaining({ input: tx.input })]
  );
  const decoded = await wallet.decodeEvmTransactionData(tx);
  expect(decoded.inputs[method === 'bytes32' ? 0 : 1]).toBe(amount);
  if (isBytes) {
    expect(decoded.types).toEqual(['bytes32', 'bytes']);
    expect(decoded.method).toBe('execute');
  }
  expect(value.parentElement!.tagName).toBe('DIV');
  return { value, reference: value.parentElement!, user: userEvent.setup() };
}

const en = jest.requireActual('assets/locales/en.json');
const timestamp = new Date(1792559353 * 1000).toLocaleString();
function metadataRow(label: string, full: string) {
  const row = screen.getByText(label, { exact: true }).parentElement!;
  const value = within(row).getByText(ellipsis(full, 2, 4), { exact: true });
  return { row, value, reference: value.parentElement!, full };
}
async function metadata() {
  const { user } = await details('0x1234', 'bytes');
  await screen.findByText(ellipsis(en.transactions.methodNames.execute, 2, 4), {
    exact: true,
  });
  return {
    user,
    method: metadataRow('Method', en.transactions.methodNames.execute),
  };
}
it.each(['method'] as const)(
  'retains hover access to full top-level %s metadata',
  async (field) => {
    const data = await metadata();
    const item = data[field];
    expect(within(item.row).queryByRole('button')).toBeNull();
    await data.user.hover(item.reference);
    expect(
      within(await screen.findByRole('tooltip')).getByText(item.full, {
        exact: true,
      })
    ).toBeVisible();
  }
);
it.each(['method'] as const)(
  'exposes and dismisses full top-level %s metadata using Tab and Escape',
  async (field) => {
    const data = await metadata();
    const item = data[field];
    expect(item.reference).toHaveAttribute('tabindex', '0');
    expect(item.reference.classList.contains('focus-visible:outline')).toBe(
      true
    );
    for (
      let index = 0;
      index < 30 && document.activeElement !== item.reference;
      index++
    )
      await data.user.tab();
    expect(item.reference).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText(item.full, { exact: true })).toBeVisible();
    const descriptionId = item.reference.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toContainElement(tooltip);
    await data.user.keyboard('{Escape}');
    await waitFor(() => expect(tooltip).not.toBeVisible());
    expect(item.reference).toHaveFocus();
    expect(item.reference).not.toHaveAttribute('aria-describedby');
  }
);
it('shows the complete timestamp without adding a tooltip or Tab stop', async () => {
  const { user } = await metadata();
  const row = screen.getByText('Timestamp', { exact: true }).parentElement!;
  const value = within(row).getByText(timestamp, { exact: true });
  expect(value).toBeVisible();
  await user.hover(value);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(row.querySelector('button, [tabindex]')).toBeNull();
  for (let index = 0; index < 30; index++) {
    await user.tab();
    expect(row).not.toContainElement(document.activeElement as HTMLElement);
    if (
      document.activeElement ===
      screen.getByRole('button', { name: 'After details' })
    )
      break;
  }
  expect(screen.getByRole('button', { name: 'After details' })).toHaveFocus();
});
it('keeps short top-level metadata visible without an extra Tab stop', async () => {
  const { user } = await metadata();
  const row = screen.getByText('Block Number', { exact: true }).parentElement!;
  const value = within(row).getByText('42', { exact: true });
  expect(value).toBeVisible();
  expect(row.querySelector('button, [tabindex]')).toBeNull();
  for (let index = 0; index < 30; index++) {
    await user.tab();
    expect(row).not.toContainElement(document.activeElement as HTMLElement);
    if (
      document.activeElement ===
      screen.getByRole('button', { name: 'After details' })
    )
      break;
  }
  expect(screen.getByRole('button', { name: 'After details' })).toHaveFocus();
});
it('retains native keyboard access to the separate exact-address copy action', async () => {
  const { user } = await metadata();
  const row = screen.getByText('From', { exact: true }).parentElement!;
  const button = within(row).getByRole('button');
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue(undefined);
  for (let index = 0; index < 30 && document.activeElement !== button; index++)
    await user.tab();
  expect(button).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(write).toHaveBeenCalledWith(ACCOUNT));
});
