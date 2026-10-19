/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

import { TransactionDetailsList } from 'components/TransactionDetails';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const mockCopy = jest.fn();
const mockTooltipContents: unknown[] = [];
const mockAlert = { info: jest.fn(), warning: jest.fn(), error: jest.fn() };
let mockState: any;
let mockTransaction: any;
let nextHash = 0;

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: async ([, method]: string[]) => {
      if (method === 'getEvmTransactionFromProvider') return mockTransaction;
      throw new Error(`Unexpected controller call: ${method}`);
    },
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: ACCOUNT, network: 'mainnet' }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert }),
  useTransactionsListConfig: () => ({
    getTxType: () => 'Sent',
    getTxStatusIcons: () => null,
  }),
}));
jest.mock('utils/index', () => {
  const { camelCaseToText, ellipsis } = jest.requireActual('utils/format');
  return { camelCaseToText, ellipsis };
});
jest.mock('utils/transactions', () => {
  const actual = jest.requireActual('utils/transactions');
  return {
    ...actual,
    getTransactionDisplayInfo: async (tx: any) => ({
      formattedValue: tx.value,
      displayValue: tx.value,
      displaySymbol: 'ETH',
      actualRecipient: tx.to,
      isErc20Transfer: false,
      isNft: false,
    }),
  };
});
jest.mock('components/TransactionDetails', () => ({
  TransactionDetailsList: jest.requireActual(
    'components/TransactionDetails/TransactionDetailsList'
  ).TransactionDetailsList,
  TransactionHeader: () => null,
  TransactionEventLogs: () => null,
  DecodedTransactionParams: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => {
    mockTooltipContents.push(content);
    return <>{children}</>;
  },
}));
jest.mock('components/Icon', () => ({ Icon: () => <span>Copy</span> }));

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);

beforeEach(() => {
  jest.clearAllMocks();
  mockTooltipContents.length = 0;
  mockCopy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
  mockTransaction = {
    hash: `0x${(++nextHash).toString(16).padStart(64, '0')}`,
    from: ACCOUNT,
    to: RECIPIENT,
    input: '0x',
    value: '1',
    chainId: 1,
    confirmations: 3,
    blockNumber: 42,
    isError: '0',
    // eslint-disable-next-line camelcase -- Explorer receipt status field.
    txreceipt_status: '1',
  };
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { id: 0, address: ACCOUNT } } },
      accountTransactions: {
        HDAccount: { 0: { ethereum: { 1: [mockTransaction] } } },
      },
      activeNetwork: {
        chainId: 1,
        currency: 'eth',
        url: 'https://rpc.invalid',
      },
    },
    vaultGlobal: { ensCache: {} },
  };
});

afterAll(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

it.each([
  ['From', ACCOUNT],
  ['To', RECIPIENT],
])(
  'copies the full %s address without an ENS alias',
  async (label, address) => {
    render(
      <EvmTransactionDetailsEnhanced
        hash={mockTransaction.hash}
        tx={mockTransaction}
      />
    );
    const row = screen.getByText(label).parentElement!;
    expect(mockTooltipContents).toContain(address);
    fireEvent.click(within(row).getByRole('button'));
    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith(address));
    expect(mockAlert.warning).not.toHaveBeenCalled();
  }
);

it.each([
  ['From', ACCOUNT, 'alice.eth'],
  ['To', RECIPIENT, 'alice.eth'],
  ['From', ACCOUNT, 'abcdefghijklmnop.eth'],
  ['To', RECIPIENT, 'abcdefghijklmnop.eth'],
  ['From', ACCOUNT, 'a-very-long-recipient-alias.eth'],
  ['To', RECIPIENT, 'a-very-long-recipient-alias.eth'],
])(
  'copies the original %s address %s when aliased as %s',
  async (label, address, name) => {
    mockState.vaultGlobal.ensCache = {
      [address.toLowerCase()]: { name, timestamp: Date.now() },
    };
    render(
      <EvmTransactionDetailsEnhanced
        hash={mockTransaction.hash}
        tx={mockTransaction}
      />
    );
    const row = screen.getByText(label).parentElement!;
    fireEvent.click(within(row).getByRole('button'));
    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith(address));
    expect(mockAlert.warning).not.toHaveBeenCalled();
  }
);

it.each(['SHORT', 'a-long-raw-value-that-is-not-an-alias'])(
  'does not treat arbitrary tooltip text as a clipboard value (%s)',
  (value) => {
    render(
      <TransactionDetailsList
        details={[
          {
            label: 'Value',
            value,
            canCopy: true,
            tooltip: 'Hover explanation',
          },
        ]}
        onCopy={mockCopy}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(mockCopy).toHaveBeenCalledWith(value, 'Value');
  }
);

it('keeps address-poisoning checks on the original address behind a long ENS alias', async () => {
  mockTransaction.from = RECIPIENT;
  mockTransaction.to = ACCOUNT;
  mockTransaction.direction = 'received';
  mockState.vaultGlobal.ensCache = {
    [RECIPIENT]: {
      name: 'a-very-long-recipient-alias.eth',
      timestamp: Date.now(),
    },
  };
  await act(async () => {
    render(
      <EvmTransactionDetailsEnhanced
        hash={mockTransaction.hash}
        tx={mockTransaction}
      />
    );
  });
  const row = screen.getByText('From').parentElement!;
  fireEvent.click(within(row).getByRole('button'));
  expect(mockCopy).not.toHaveBeenCalled();
  expect(mockAlert.warning).toHaveBeenCalledWith(
    'send.addressPoisoningHistoryCopyBlocked'
  );
});
