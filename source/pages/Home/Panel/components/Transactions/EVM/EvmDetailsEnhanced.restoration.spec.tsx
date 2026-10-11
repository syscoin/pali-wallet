/** @jest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { defaultAbiCoder, hexConcat, id } from 'utils/ethersV6Compat';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from 'utils/smartAccount/contracts';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';

let mockState: any;
let mockHistory: any[];
const mockEmitter = jest.fn();
const mockDisplay = jest.fn();
const mockStatusIcons = jest.fn<null, [string, boolean]>(() => null);
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TARGET = '0x3333333333333333333333333333333333333333';
const ZERO = '0x' + '00'.repeat(32);

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ((
        {
          'send.confirmed': 'Confirmed',
          'send.pending': 'Pending',
          'send.failed': 'Failed',
          'transactions.replaced': 'Replaced',
          'transactions.replacementPending': 'Replacement pending',
          'transactions.cancellation': 'Cancellation',
        } as Record<string, string>
      )[key] || key),
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: JSON.stringify([
      mockState.refType,
      mockState.account.id,
      mockState.account.address,
    ]),
    network: JSON.stringify(mockState.vault.activeNetwork),
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.account,
  selectActiveAccountTransactions: () => ({
    ethereum: { [mockState.vault.activeNetwork.chainId]: mockHistory },
  }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: { info: jest.fn(), warning: jest.fn() },
  }),
  useTransactionsListConfig: () => ({
    getTxType: (_tx: any, sent: boolean) => (sent ? 'Sent' : 'Received'),
    getTxStatusIcons: (label: string, detail: boolean) =>
      mockStatusIcons(label, detail),
    getTxStatus: (_canceled: boolean, confirmed: boolean) =>
      confirmed ? 'Confirmed' : 'Pending',
  }),
}));
jest.mock('utils/index', () => ({
  camelCaseToText: (value: string) =>
    value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase()),
}));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: () => null,
}));
jest.mock('utils/transactions', () => {
  const actual = jest.requireActual('utils/transactions');
  return {
    getSmartAccountDisplayTransaction: actual.getSmartAccountDisplayTransaction,
    getSmartAccountExecutionTransactions:
      actual.getSmartAccountExecutionTransactions,
    getTransactionDisplayInfo: (...args: any[]) => mockDisplay(...args),
  };
});
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: ({ txType, displayInfo, txStatus }: any) => (
    <div data-testid="header">
      {txType}|{displayInfo?.formattedValue || '-'}|{txStatus}
    </div>
  ),
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
  DecodedTransactionParams: ({ decodedData }: any) => (
    <div data-testid="decoded">{decodedData?.method || '-'}</div>
  ),
}));

const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fullTx = (hash: string, fields: any = {}) => ({
  hash,
  from: ACCOUNT,
  to: TARGET,
  value: '7',
  input: '0x',
  blockNumber: 42,
  confirmations: 3,
  ...fields,
});
const encodeBundle = (
  operations: { callData?: string; sender: string; value?: string }[]
) => {
  const encoded = operations.map(({ sender, callData }) => [
    sender,
    0,
    '0x',
    callData ||
      paliEntryPointInterface.encodeFunctionData('handleOps', [[], OTHER]),
    ZERO,
    50000,
    ZERO,
    '0x',
    '0x1234',
  ]);
  for (let i = 0; i < encoded.length; i += 1) {
    if (!operations[i].callData) {
      const execution = hexConcat([
        TARGET,
        defaultAbiCoder.encode(['uint256'], [operations[i].value || '7']),
        '0x',
      ]);
      const selector = id('execute(bytes32,bytes)').slice(0, 10);
      encoded[i][3] =
        selector +
        defaultAbiCoder
          .encode(['bytes32', 'bytes'], [ZERO, execution])
          .slice(2);
    }
  }
  return paliEntryPointInterface.encodeFunctionData('handleOps', [
    encoded,
    OTHER,
  ]);
};
const operationLog = (
  hash: string,
  sender: string,
  success: boolean,
  address = getPaliEntryPointAddress(1)
) => ({
  ...paliEntryPointInterface.encodeEventLog(
    paliEntryPointInterface.getEvent('UserOperationEvent'),
    [ZERO, sender, OTHER, 0, success, 1, 1]
  ),
  address,
  transactionHash: hash,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockHistory = [];
  mockState = {
    refType: 'HDAccount',
    account: { id: 0, address: ACCOUNT },
    vault: {
      activeNetwork: {
        chainId: 1,
        currency: 'eth',
        url: 'https://rpc-a.example',
      },
    },
  };
  mockDisplay.mockImplementation(async (tx: any) => ({
    formattedValue: String(tx.value),
    displayValue: tx.value,
    displaySymbol: 'ETH',
    actualRecipient: tx.to,
    isErc20Transfer: false,
    isNft: false,
  }));
});
afterEach(() => jest.restoreAllMocks());

it('restores a transaction absent from Redux by matching provider hash', async () => {
  const hash = 'evm-hash-only-success';
  mockEmitter.mockResolvedValue(fullTx(hash));
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Confirmed')
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getEvmTransactionFromProvider'],
    [hash]
  );
});

it.each(['null', 'error', 'wrong-hash', 'partial'])(
  'keeps missing-summary %s lookup neutral and usable',
  async (mode) => {
    const hash = 'evm-failed-' + mode;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    if (mode === 'error') mockEmitter.mockRejectedValue(new Error('offline'));
    else
      mockEmitter.mockResolvedValue(
        mode === 'null'
          ? null
          : mode === 'wrong-hash'
          ? fullTx('unrelated')
          : { hash, gasUsed: '21000' }
      );
    render(<EvmTransactionDetailsEnhanced hash={hash} />);
    await screen.findByText('transactions.transactionNotFoundOrPending');
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Received/)).toBeNull();
    expect(mockDisplay).not.toHaveBeenCalled();
  }
);

it('does not infer incoming direction for a valid transaction between other accounts', async () => {
  const hash = 'evm-third-parties';
  mockEmitter.mockResolvedValue(fullTx(hash, { from: OTHER }));
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Transaction|7|Confirmed'
    )
  );
});

it('keeps fresher summary confirmation status over cached pending enhancement', async () => {
  const hash = 'evm-fresher-summary';
  const pending = fullTx(hash, {
    blockNumber: null,
    confirmations: 0,
    success: null,
    gasUsed: '21000',
  });
  mockEmitter.mockResolvedValue(pending);
  const view = render(
    <EvmTransactionDetailsEnhanced hash={hash} tx={pending as any} />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Pending')
  );
  view.rerender(
    <EvmTransactionDetailsEnhanced
      hash={hash}
      tx={
        fullTx(hash, {
          blockNumber: 123,
          confirmations: 8,
          success: true,
        }) as any
      }
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Confirmed')
  );
  expect(screen.getByText(/Block Number:123/)).toBeTruthy();
  expect(screen.getByText(/Gas Used:21,000/)).toBeTruthy();
});

it.each(['network', 'account-type'])(
  'drops late lookup and avoids caching after %s changes',
  async (change) => {
    const hash = 'evm-late-' + change;
    const old = deferred();
    mockEmitter
      .mockResolvedValue(fullTx(hash, { value: '9' }))
      .mockImplementationOnce(() => old.promise);
    const view = render(<EvmTransactionDetailsEnhanced hash={hash} />);
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://rpc-b.example';
    else mockState.refType = 'HardwareAccount';
    view.rerender(<EvmTransactionDetailsEnhanced hash={hash} />);
    await waitFor(() =>
      expect(screen.getByTestId('header').textContent).toBe('Sent|9|Confirmed')
    );
    await act(async () => {
      old.resolve(fullTx(hash, { value: '999' }));
      await old.promise;
    });
    expect(screen.getByTestId('header').textContent).toBe('Sent|9|Confirmed');
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://rpc-a.example';
    else mockState.refType = 'HDAccount';
    view.rerender(<EvmTransactionDetailsEnhanced hash={hash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(3));
  }
);

it('drops late decode and display enrichment after changing endpoint', async () => {
  const hash = 'evm-late-enrichment';
  const oldDecode = deferred();
  const oldDisplay = deferred();
  mockEmitter.mockImplementation((methods: string[]) =>
    methods.includes('decodeEvmTransactionData')
      ? oldDecode.promise
      : Promise.resolve(fullTx(hash, { input: '0xabcdef', value: '1' }))
  );
  mockDisplay.mockImplementationOnce(() => oldDisplay.promise);
  const view = render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() => expect(mockDisplay).toHaveBeenCalledTimes(1));
  mockState.vault.activeNetwork.url = 'https://rpc-c.example';
  mockEmitter.mockImplementation((methods: string[]) =>
    Promise.resolve(
      methods.includes('decodeEvmTransactionData')
        ? { method: 'new decode' }
        : fullTx(hash, { input: '0xfedcba', value: '8' })
    )
  );
  view.rerender(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|8|Confirmed')
  );
  await act(async () => {
    oldDecode.resolve({ method: 'old decode' });
    oldDisplay.resolve({ formattedValue: '999' });
    await Promise.all([oldDecode.promise, oldDisplay.promise]);
  });
  expect(screen.getByTestId('header').textContent).toBe('Sent|8|Confirmed');
  expect(screen.getByTestId('decoded').textContent).toBe('new decode');
});

it('selects the current account operation from a bundle, retaining outer hash details', async () => {
  const hash = 'aa-current-operation';
  mockEmitter.mockResolvedValue(
    fullTx(hash, {
      from: OTHER,
      to: getPaliEntryPointAddress(1),
      input: encodeBundle([
        { sender: OTHER, value: '999' },
        { sender: ACCOUNT, value: '7' },
      ]),
      success: true,
      logs: [operationLog(hash, ACCOUNT, true)],
    })
  );
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Confirmed')
  );
  expect(mockDisplay).toHaveBeenCalledWith(
    expect.objectContaining({ from: ACCOUNT, value: '7', to: TARGET }),
    'eth'
  );
  expect(screen.getByText(/Hash:aa-current-operation/)).toBeTruthy();
});

it.each([
  'other-sender',
  'no-event',
  'wrong-event-contract',
  'unsupported-target',
])('keeps bundle %s account impact unknown', async (mode) => {
  const hash = 'aa-unknown-' + mode;
  const sender = mode === 'other-sender' ? OTHER : ACCOUNT;
  mockEmitter.mockResolvedValue(
    fullTx(hash, {
      from: OTHER,
      to: mode === 'unsupported-target' ? TARGET : getPaliEntryPointAddress(1),
      input: encodeBundle([{ sender, value: '999' }]),
      success: true,
      logs:
        mode === 'no-event'
          ? []
          : [
              operationLog(
                hash,
                sender,
                true,
                mode === 'wrong-event-contract'
                  ? TARGET
                  : getPaliEntryPointAddress(1)
              ),
            ],
    })
  );
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Transaction|-|Confirmed'
    )
  );
  expect(mockDisplay).not.toHaveBeenCalled();
  expect(screen.queryByText(/Success:Success/)).toBeNull();
});

it.each(['supported', 'unsupported'])(
  'shows failed current userOp in successful outer %s bundle without claiming its intended amount',
  async (mode) => {
    const hash = 'aa-failed-' + mode;
    mockEmitter.mockResolvedValue(
      fullTx(hash, {
        from: OTHER,
        to: getPaliEntryPointAddress(1),
        input: encodeBundle([
          {
            sender: ACCOUNT,
            value: '999',
            callData: mode === 'unsupported' ? '0xabcdef' : undefined,
          },
        ]),
        success: true,
        logs: [operationLog(hash, ACCOUNT, false)],
      })
    );
    render(<EvmTransactionDetailsEnhanced hash={hash} />);
    await waitFor(() =>
      expect(screen.getByText(/Success:Failed/)).toBeTruthy()
    );
    expect(screen.getByTestId('header').textContent).toBe(
      'Transaction|-|Failed'
    );
    expect(mockDisplay).not.toHaveBeenCalled();
  }
);

it('retains a confirmed current-account failed operation summary over outer success when receipt logs are absent', async () => {
  const hash = 'aa-summary-failed';
  const summary = fullTx(hash, {
    from: OTHER,
    to: getPaliEntryPointAddress(1),
    input: encodeBundle([{ sender: ACCOUNT }]),
    smartAccountExecutionFrom: ACCOUNT,
    // eslint-disable-next-line camelcase
    txreceipt_status: '0',
  });
  mockEmitter.mockResolvedValue({
    ...summary,
    smartAccountExecutionFrom: undefined,
    // eslint-disable-next-line camelcase
    txreceipt_status: '1',
    success: true,
    logs: [],
  });
  render(<EvmTransactionDetailsEnhanced hash={hash} tx={summary as any} />);
  await waitFor(() => expect(screen.getByText(/Success:Failed/)).toBeTruthy());
  expect(mockDisplay).not.toHaveBeenCalled();
});

it('falls back from a partial hash-only explorer lookup to the full provider record', async () => {
  const hash = 'evm-partial-explorer';
  mockState.vault.activeNetwork.apiUrl = 'https://explorer.example/api';
  mockEmitter
    .mockResolvedValueOnce({ hash, gasUsed: '21000' })
    .mockResolvedValueOnce(fullTx(hash));
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Confirmed')
  );
  expect(mockEmitter.mock.calls).toEqual([
    [
      ['wallet', 'getEvmTransactionFromAPI'],
      [hash, 'https://explorer.example/api'],
    ],
    [['wallet', 'getEvmTransactionFromProvider'], [hash]],
  ]);
});

it('selects a supported current operation after another sender with unsupported call data', async () => {
  const hash = 'aa-second-supported';
  mockEmitter.mockResolvedValue(
    fullTx(hash, {
      from: OTHER,
      to: getPaliEntryPointAddress(1),
      input: encodeBundle([
        { sender: OTHER, callData: '0xabcdef' },
        { sender: ACCOUNT, value: '11' },
      ]),
      success: true,
      logs: [operationLog(hash, ACCOUNT, true)],
    })
  );
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|11|Confirmed')
  );
});

it('keeps malformed receipt logs neutral without crashing or showing unproven bundle success', async () => {
  const hash = 'aa-malformed-logs';
  mockEmitter.mockResolvedValue(
    fullTx(hash, {
      from: OTHER,
      to: getPaliEntryPointAddress(1),
      input: encodeBundle([{ sender: ACCOUNT }]),
      success: true,
      logs: {},
    })
  );
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Transaction|-|Confirmed'
    )
  );
  expect(mockDisplay).not.toHaveBeenCalled();
  expect(screen.queryByText(/Success:Success/)).toBeNull();
});

it('immediately hides previously displayed operation amount when current summary reports failure', async () => {
  const hash = 'aa-summary-update';
  const summary = fullTx(hash, {
    from: OTHER,
    to: getPaliEntryPointAddress(1),
    input: encodeBundle([{ sender: ACCOUNT }]),
    smartAccountExecutionFrom: ACCOUNT,
    // eslint-disable-next-line camelcase
    txreceipt_status: '1',
  });
  mockEmitter.mockResolvedValue({ ...summary, success: true, logs: [] });
  const view = render(
    <EvmTransactionDetailsEnhanced hash={hash} tx={summary as any} />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Confirmed')
  );
  view.rerender(
    <EvmTransactionDetailsEnhanced
      hash={hash}
      // eslint-disable-next-line camelcase
      tx={{ ...summary, txreceipt_status: '0' } as any}
    />
  );
  expect(screen.getByTestId('header').textContent).toBe('Transaction|-|Failed');
  expect(screen.getByText(/Success:Failed/)).toBeTruthy();
});

const replacementHash = (digit: string) => `0x${digit.repeat(64)}`;
const replacementTx = (digit: string, fields: any = {}) =>
  fullTx(replacementHash(digit), {
    chainId: 1,
    type: 2,
    nonce: 8,
    blockNumber: null,
    confirmations: 0,
    ...fields,
  });

it('shows a replaced original even when its RPC lookup remains pending', async () => {
  const original = replacementTx('a', { isReplaced: true });
  mockHistory = [
    original,
    replacementTx('b', { blockNumber: 42, confirmations: 3 }),
  ];
  mockEmitter.mockResolvedValue({ ...original, isReplaced: undefined });
  render(
    <EvmTransactionDetailsEnhanced hash={original.hash} tx={original as any} />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Replaced')
  );
});

it('updates the open original from replacement pending to replaced when the winner arrives', async () => {
  const original = replacementTx('c', { isReplaced: true });
  mockHistory = [original];
  mockEmitter.mockResolvedValue(null);
  const view = render(
    <EvmTransactionDetailsEnhanced hash={original.hash} tx={original as any} />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Sent|7|Replacement pending'
    )
  );
  mockHistory = [
    original,
    replacementTx('d', { blockNumber: 42, confirmations: 3 }),
  ];
  view.rerender(
    <EvmTransactionDetailsEnhanced hash={original.hash} tx={original as any} />
  );
  expect(screen.getByTestId('header').textContent).toBe('Sent|7|Replaced');
});

it.each(['1', '0'])(
  'uses an original own receipt %s despite a stale replacement marker',
  async (receipt) => {
    const original = replacementTx(receipt, {
      blockNumber: 43,
      confirmations: 4,
      isReplaced: true,
      // eslint-disable-next-line camelcase
      txreceipt_status: receipt,
    });
    mockHistory = [original, replacementTx('e', { blockNumber: 42 })];
    mockEmitter.mockResolvedValue(replacementTx(receipt));
    render(
      <EvmTransactionDetailsEnhanced
        hash={original.hash}
        tx={original as any}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('header').textContent).toBe(
        `Sent|7|${receipt === '1' ? 'Confirmed' : 'Failed'}`
      )
    );
  }
);

it('keeps cancellation purpose, confirmed settlement and outgoing icon after acceleration', async () => {
  const cancellation = replacementTx('f', {
    to: ACCOUNT,
    value: '0',
    blockNumber: 42,
    isCancel: true,
    isSpeedUp: true,
    replacesHash: replacementHash('9'),
  });
  mockHistory = [cancellation];
  mockEmitter.mockResolvedValue({ ...cancellation, isCancel: undefined });
  render(
    <EvmTransactionDetailsEnhanced
      hash={cancellation.hash}
      tx={cancellation as any}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Cancellation|0|Confirmed'
    )
  );
  expect(mockStatusIcons).toHaveBeenLastCalledWith('Sent', true);
});

it('recovers known legacy cancellation ancestry without guessing from a self-transfer', async () => {
  const cancellation = replacementTx('8', { isCancel: true, to: ACCOUNT });
  const speedup = replacementTx('7', {
    to: ACCOUNT,
    value: '0',
    blockNumber: 42,
    isSpeedUp: true,
    replacesHash: cancellation.hash,
  });
  mockHistory = [cancellation, speedup];
  mockEmitter.mockResolvedValue(null);
  render(
    <EvmTransactionDetailsEnhanced hash={speedup.hash} tx={speedup as any} />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Cancellation|0|Confirmed'
    )
  );
});

it.each([false, true])(
  'ignores provider-supplied cancellation intent (hash-only restoration=%s)',
  async (hashOnly) => {
    const tx = replacementTx(hashOnly ? '6' : '5', {
      to: ACCOUNT,
      value: '0',
      blockNumber: 42,
    });
    mockEmitter.mockResolvedValue({ ...tx, isCancel: true, isSpeedUp: true });
    render(
      <EvmTransactionDetailsEnhanced
        hash={tx.hash}
        tx={hashOnly ? undefined : (tx as any)}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('header').textContent).toBe('Sent|0|Confirmed')
    );
  }
);

it('keeps an original neutral when a token-event placeholder has the same nonce', async () => {
  const original = replacementTx('4', { isReplaced: true });
  mockHistory = [
    original,
    replacementTx('3', {
      blockNumber: 42,
      historySource: 'explorer-tokentx',
    }),
  ];
  mockEmitter.mockResolvedValue(null);
  render(
    <EvmTransactionDetailsEnhanced hash={original.hash} tx={original as any} />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Sent|7|Replacement pending'
    )
  );
});

it('rejects a matching provider hash explicitly belonging to another chain', async () => {
  const hash = replacementHash('2');
  mockEmitter.mockResolvedValue(fullTx(hash, { chainId: 57 }));
  render(<EvmTransactionDetailsEnhanced hash={hash} />);
  await screen.findByText('transactions.transactionNotFoundOrPending');
  expect(mockDisplay).not.toHaveBeenCalled();
});

let nextPaginatedHash = 100;
const paginatedTx = (fields: any = {}) =>
  replacementTx('a', {
    hash: `0x${(nextPaginatedHash++).toString(16).padStart(64, '0')}`,
    ...fields,
  });
const lookupPaginated = (original: any, winner: any) =>
  mockEmitter.mockImplementation(async (method: string[], args: any[]) =>
    method[1] === 'getEvmTransactionFromProvider'
      ? args[0] === original.hash
        ? original
        : winner
      : null
  );

it('restores a paginated winner by its saved hash without receiving a transaction payload', async () => {
  const original = paginatedTx({ isReplaced: true });
  const winner = paginatedTx({
    blockNumber: 42,
    to: ACCOUNT,
    value: '0',
    isCancel: true,
  });
  mockHistory = [original];
  lookupPaginated(original, winner);
  render(
    <EvmTransactionDetailsEnhanced
      hash={original.hash}
      tx={original as any}
      replacementWinnerHash={winner.hash}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Replaced')
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getEvmTransactionFromProvider'],
    [winner.hash]
  );
  expect(mockHistory).toEqual([original]);
  expect(screen.queryByText(/Cancellation/)).toBeNull();
  expect(
    mockDisplay.mock.calls.every(([tx]) => tx.hash === original.hash)
  ).toBe(true);
});

it('uses the ephemeral paginated proof only while fresh revalidation is pending', async () => {
  const original = paginatedTx({ isReplaced: true });
  const winner = paginatedTx({ blockNumber: 42 });
  const pending = deferred();
  mockHistory = [original];
  mockEmitter.mockImplementation((method: string[], args: any[]) =>
    method[1] === 'getEvmTransactionFromProvider' && args[0] === winner.hash
      ? pending.promise
      : Promise.resolve(null)
  );
  render(
    <EvmTransactionDetailsEnhanced
      hash={original.hash}
      tx={original as any}
      replacementWinnerHash={winner.hash}
      replacementWinner={winner as any}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe('Sent|7|Replaced')
  );
  await act(async () => pending.resolve(null));
  expect(screen.getByTestId('header').textContent).toBe(
    'Sent|7|Replacement pending'
  );
});

it.each([
  { blockNumber: null, confirmations: 1, blockHash: ZERO },
  { from: OTHER },
  { nonce: 9 },
  { chainId: 57 },
  { hash: replacementHash('f') },
  { historySource: 'explorer-tokentx' },
  { type: '0x7f' },
  { type: undefined },
  { r: '0x0', s: '0x0', v: '0x0' },
])(
  'revokes a paginated snapshot after fresh invalid winner data %j',
  async (fields) => {
    const original = paginatedTx({ isReplaced: true });
    const winner = paginatedTx({ blockNumber: 42 });
    mockHistory = [original];
    lookupPaginated(original, { ...winner, ...fields });
    render(
      <EvmTransactionDetailsEnhanced
        hash={original.hash}
        tx={original as any}
        replacementWinnerHash={winner.hash}
        replacementWinner={winner as any}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('header').textContent).toBe(
        'Sent|7|Replacement pending'
      )
    );
  }
);

it('revokes a paginated snapshot when fresh winner lookup rejects', async () => {
  const original = paginatedTx({ isReplaced: true });
  const winner = paginatedTx({ blockNumber: 42 });
  mockHistory = [original];
  mockEmitter.mockImplementation((method: string[], args: any[]) =>
    method[1] === 'getEvmTransactionFromProvider' && args[0] === winner.hash
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(null)
  );
  render(
    <EvmTransactionDetailsEnhanced
      hash={original.hash}
      tx={original as any}
      replacementWinnerHash={winner.hash}
      replacementWinner={winner as any}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Sent|7|Replacement pending'
    )
  );
});

it('keeps conflicting current mined winners ambiguous instead of choosing a paginated snapshot', async () => {
  const original = paginatedTx({ isReplaced: true });
  const winner = paginatedTx({ blockNumber: 42 });
  mockHistory = [original, paginatedTx({ blockNumber: 43 })];
  lookupPaginated(original, winner);
  render(
    <EvmTransactionDetailsEnhanced
      hash={original.hash}
      tx={original as any}
      replacementWinnerHash={winner.hash}
      replacementWinner={winner as any}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('header').textContent).toBe(
      'Sent|7|Replacement pending'
    )
  );
  expect(screen.queryByText(/\|Replaced$/)).toBeNull();
});

it.each([null, 42])(
  'prefers a live same-hash winner row at block %p and skips its redundant lookup',
  async (blockNumber) => {
    const original = paginatedTx({ isReplaced: true });
    const winner = paginatedTx({ blockNumber: 42 });
    mockHistory = [original, { ...winner, blockNumber }];
    lookupPaginated(original, winner);
    render(
      <EvmTransactionDetailsEnhanced
        hash={original.hash}
        tx={original as any}
        replacementWinnerHash={winner.hash}
        replacementWinner={winner as any}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('header').textContent).toBe(
        `Sent|7|${blockNumber ? 'Replaced' : 'Replacement pending'}`
      )
    );
    expect(mockEmitter).not.toHaveBeenCalledWith(
      ['wallet', 'getEvmTransactionFromProvider'],
      [winner.hash]
    );
  }
);

it.each(['1', '0'])(
  'uses the original own receipt %s after a paginated winner lookup settles',
  async (receipt) => {
    const original = paginatedTx({ isReplaced: true });
    const winner = paginatedTx({ blockNumber: 42 });
    const pending = deferred();
    mockHistory = [original];
    mockEmitter.mockImplementation((method: string[], args: any[]) =>
      method[1] === 'getEvmTransactionFromProvider' && args[0] === winner.hash
        ? pending.promise
        : Promise.resolve(null)
    );
    const view = render(
      <EvmTransactionDetailsEnhanced
        hash={original.hash}
        tx={original as any}
        replacementWinnerHash={winner.hash}
        replacementWinner={winner as any}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('header').textContent).toBe('Sent|7|Replaced')
    );
    // eslint-disable-next-line camelcase
    const mined = { ...original, blockNumber: 43, txreceipt_status: receipt };
    mockHistory = [mined];
    view.rerender(
      <EvmTransactionDetailsEnhanced
        hash={original.hash}
        tx={mined as any}
        replacementWinnerHash={winner.hash}
        replacementWinner={winner as any}
      />
    );
    await act(async () => pending.resolve(winner));
    expect(screen.getByTestId('header').textContent).toBe(
      `Sent|7|${receipt === '1' ? 'Confirmed' : 'Failed'}`
    );
  }
);

it('does not reconstruct a missing original tuple from a restored winner hash', async () => {
  const original = paginatedTx();
  const winner = paginatedTx({ blockNumber: 42 });
  mockEmitter.mockImplementation(async (_method: string[], args: any[]) =>
    args[0] === winner.hash ? winner : null
  );
  render(
    <EvmTransactionDetailsEnhanced
      hash={original.hash}
      replacementWinnerHash={winner.hash}
    />
  );
  await screen.findByText('transactions.transactionNotFoundOrPending');
  expect(mockDisplay).not.toHaveBeenCalled();
});

it.each(['account', 'endpoint', 'hash', 'unmount'])(
  'drops a late winner reply after changing %s',
  async (change) => {
    const original = paginatedTx({ isReplaced: true });
    const winner = paginatedTx({ blockNumber: 42 });
    const nextOriginal = paginatedTx({ isReplaced: true });
    const pending = deferred();
    mockHistory = [original];
    mockEmitter.mockImplementation((method: string[], args: any[]) =>
      method[1] === 'getEvmTransactionFromProvider' && args[0] === winner.hash
        ? pending.promise
        : Promise.resolve(null)
    );
    const view = render(
      <EvmTransactionDetailsEnhanced
        hash={original.hash}
        tx={original as any}
        replacementWinnerHash={winner.hash}
      />
    );
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'getEvmTransactionFromProvider'],
        [winner.hash]
      )
    );
    if (change === 'unmount') view.unmount();
    else {
      if (change === 'account') mockState.account = { id: 1, address: OTHER };
      if (change === 'endpoint')
        mockState.vault.activeNetwork.url = 'https://rpc-b.example';
      view.rerender(
        <EvmTransactionDetailsEnhanced
          hash={change === 'hash' ? nextOriginal.hash : original.hash}
          tx={(change === 'hash' ? nextOriginal : original) as any}
        />
      );
    }
    await act(async () => pending.resolve(winner));
    if (change === 'unmount') expect(screen.queryByTestId('header')).toBeNull();
    else
      expect(screen.getByTestId('header').textContent).toBe(
        `${change === 'account' ? 'Received' : 'Sent'}|7|Replacement pending`
      );
  }
);
