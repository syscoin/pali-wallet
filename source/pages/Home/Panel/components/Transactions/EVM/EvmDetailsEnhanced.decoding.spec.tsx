/** @jest-environment jsdom */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { Interface } from 'utils/ethersV6Compat';
import { decodeTransactionData } from 'utils/ethUtil';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const OTHER = `0x${'44'.repeat(20)}`;
const ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];
const INPUT = new Interface(ABI).encodeFunctionData('transfer', [RECIPIENT, 7]);
const OTHER_INPUT = new Interface(ABI).encodeFunctionData('transfer', [
  OTHER,
  8,
]);
let mockHistory: any[];
const mockEmitter = jest.fn();
const mockDecode = jest.fn();
const mockState = {
  account: { id: 0, address: ACCOUNT },
  vault: {
    activeNetwork: { chainId: 1, currency: 'eth', url: 'https://rpc.invalid' },
  },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'buttons.send' ? 'Send' : key),
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: ACCOUNT, network: 'mainnet' }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => mockState.account,
  selectActiveAccountTransactions: () => ({ ethereum: { 1: mockHistory } }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ useCopyClipboard: () => [false, jest.fn()], alert: {} }),
  useTransactionsListConfig: () => ({
    getTxType: () => 'Sent',
    getTxStatusIcons: () => null,
    getTxStatus: () => 'Confirmed',
  }),
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  camelCaseToText: (value: string) =>
    value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase()),
}));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: () => null,
}));
jest.mock('utils/transactions', () => ({
  getSmartAccountDisplayTransaction: (tx: any) => tx,
  getSmartAccountExecutionTransactions: () => [],
  getTransactionDisplayInfo: async (tx: any) => ({
    formattedValue: String(tx.value),
    displayValue: tx.value,
    displaySymbol: 'TOKEN',
    actualRecipient: RECIPIENT,
    isErc20Transfer: true,
    isNft: false,
  }),
}));
jest.mock('components/TransactionDetails', () => {
  const { DecodedTransactionParams } = jest.requireActual(
    'components/TransactionDetails/DecodedTransactionParams'
  );
  return {
    TransactionHeader: () => <div data-testid="header" />,
    TransactionDetailsList: ({ details }: any) => (
      <div>
        {details.map((item: any, index: number) => (
          <span key={index}>
            {item.label}:{String(item.value)}|
          </span>
        ))}
      </div>
    ),
    TransactionEventLogs: () => null,
    DecodedTransactionParams: (props: any) => (
      <section data-testid="decoded-output">
        <DecodedTransactionParams {...props} />
      </section>
    ),
  };
});
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const summary = (hash: string, input?: string, fields: any = {}) => ({
  hash,
  from: ACCOUNT,
  to: TOKEN,
  value: '7',
  blockNumber: 42,
  confirmations: 3,
  chainId: 1,
  input,
  ...fields,
});
const decode = (transaction: any) =>
  decodeTransactionData(
    { ...transaction, data: transaction.data || transaction.input },
    { call: async () => `0x${'0'.repeat(64)}` },
    {
      getErc20Abi: async () => ABI,
      getErc721Abi: async () => [
        'function supportsInterface(bytes4) view returns (bool)',
      ],
      getErc1155Abi: async () => [
        'function supportsInterface(bytes4) view returns (bool)',
      ],
    }
  );
let nextHash = 0;
const mountWithDelayedBody = (input?: string, fields: any = {}) => {
  const hash = `0x${(++nextHash).toString(16).padStart(64, '0')}`;
  const body = deferred();
  const tx = summary(hash, input, fields);
  mockHistory = [tx];
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'getEvmTransactionFromProvider') return body.promise;
    if (method === 'decodeEvmTransactionData') return mockDecode(args[0]);
    throw new Error(`Unexpected controller call: ${method}`);
  });
  const view = render(
    <EvmTransactionDetailsEnhanced hash={hash} tx={tx as any} />
  );
  return { body, hash, view };
};
const expectRecipient = async (recipient = RECIPIENT) => {
  await waitFor(() =>
    expect(
      within(screen.getByTestId('decoded-output')).getByText(recipient)
    ).toBeTruthy()
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockHistory = [];
  mockDecode.mockImplementation(decode);
});

it('keeps the healthy complete-calldata transfer and its real decoded parameters', async () => {
  const { body, hash } = mountWithDelayedBody(INPUT);
  await act(async () => body.resolve(summary(hash, INPUT)));
  await expectRecipient();
  expect(screen.getByText(/Method:Transfer/)).toBeTruthy();
});

it.each([undefined, '0x'])(
  'decodes the full body after an explorer summary with input %s',
  async (input) => {
    const { body, hash } = mountWithDelayedBody(input);
    await screen.findByText(/Method:Send/);
    await act(async () => body.resolve(summary(hash, INPUT)));
    await expectRecipient();
    expect(screen.getByText(/Method:Transfer/)).toBeTruthy();
  }
);

it('retains a genuine native Send without requesting a contract decoder', async () => {
  const { body, hash } = mountWithDelayedBody('0x');
  await act(async () => body.resolve(summary(hash, '0x')));
  expect(screen.getByText(/Method:Send/)).toBeTruthy();
  expect(screen.getByTestId('decoded-output').textContent).toBe('');
  expect(mockDecode).not.toHaveBeenCalled();
});

it('reuses decoding for an unchanged payload and destination on a refreshed summary', async () => {
  const { body, hash, view } = mountWithDelayedBody(INPUT);
  await act(async () => body.resolve(summary(hash, INPUT)));
  await expectRecipient();
  const calls = mockDecode.mock.calls.length;
  const updated = summary(hash, INPUT, { confirmations: 4 });
  mockHistory = [updated];
  view.rerender(
    <EvmTransactionDetailsEnhanced hash={hash} tx={updated as any} />
  );
  await expectRecipient();
  expect(mockDecode).toHaveBeenCalledTimes(calls);
});

it('clears previously decoded parameters while a replacement payload is decoding', async () => {
  const { body, hash } = mountWithDelayedBody(INPUT);
  await expectRecipient();
  const pending = deferred();
  mockDecode.mockImplementation((tx) =>
    tx.input === OTHER_INPUT ? pending.promise : decode(tx)
  );
  await act(async () => body.resolve(summary(hash, OTHER_INPUT)));
  await waitFor(() =>
    expect(mockDecode).toHaveBeenCalledWith(
      expect.objectContaining({ input: OTHER_INPUT })
    )
  );
  expect(screen.getByTestId('decoded-output').textContent).toBe('');
  const decoded = await decode(summary(hash, OTHER_INPUT));
  await act(async () => pending.resolve(decoded));
  await expectRecipient(OTHER);
});

it('ignores a late decode for the summary after the full body has changed its payload', async () => {
  const pending = deferred();
  mockDecode.mockImplementation((tx) =>
    tx.input === INPUT ? pending.promise : decode(tx)
  );
  const { body, hash } = mountWithDelayedBody(INPUT);
  await waitFor(() => expect(mockDecode).toHaveBeenCalled());
  await act(async () => body.resolve(summary(hash, OTHER_INPUT)));
  await expectRecipient(OTHER);
  const oldDecoded = await decode(summary(hash, INPUT));
  await act(async () => pending.resolve(oldDecoded));
  await expectRecipient(OTHER);
  expect(
    within(screen.getByTestId('decoded-output')).queryByText(RECIPIENT)
  ).toBeNull();
});

it('decodes again when a full transaction changes the summary destination', async () => {
  const { body, hash } = mountWithDelayedBody(INPUT);
  await expectRecipient();
  await act(async () => body.resolve(summary(hash, INPUT, { to: OTHER })));
  await waitFor(() =>
    expect(mockDecode).toHaveBeenCalledWith(
      expect.objectContaining({ to: OTHER })
    )
  );
  await expectRecipient();
});

it('matches the backend data-before-input precedence when decoding', async () => {
  const { body, hash } = mountWithDelayedBody('0x', { data: INPUT });
  await act(async () => body.resolve(summary(hash, '0x', { data: INPUT })));
  await expectRecipient();
  expect(screen.getByText(/Method:Transfer/)).toBeTruthy();
});
