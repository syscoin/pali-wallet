/** @jest-environment jsdom */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';

import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from './history.fixtures';
import { SyscoinTransactionDetails } from './SyscoinDetails';

let mockState: any;
let mockHash: string;
let mockSequence = 0;
const mockEmitter = jest.fn();

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
// Decorative icons do not affect transaction rendering and pull in browser-only antd ESM.
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
}));
jest.mock('hooks/index', () => ({
  useTransactionsListConfig: jest.requireActual(
    'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos'
  ).useTransactionsListConfig,
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: { info: jest.fn() },
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockState.scope,
}));
jest.mock('utils/index', () => {
  const format = jest.requireActual('utils/format');
  return { camelCaseToText: format.camelCaseToText, ellipsis: format.ellipsis };
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const rawTransaction = (changes: Partial<ISysTransaction> = {}) =>
  ({
    txid: mockHash,
    blockHash: '',
    blockHeight: 0,
    blockTime: 0,
    confirmations: 0,
    fees: '1000',
    hex: '00',
    value: '900000000',
    valueIn: '900001000',
    version: 2,
    vin: [{ addresses: ['raw-from'], value: '900001000' }],
    vout: [{ addresses: ['raw-to'], value: '900000000' }],
    ...changes,
  } as ISysTransaction);
const confirmationValue = () =>
  within(screen.getByText('Confirmations').parentElement!).getByText(/^\d+$/);
const detailValue = (label: string, value: string) =>
  within(screen.getByText(label).parentElement!).getByText(value);

beforeEach(() => {
  jest.clearAllMocks();
  mockHash = 'abc' + (++mockSequence).toString(16).padStart(61, '0');
  mockState = {
    scope: { account: 'account-a', network: 'network-a' },
    vault: {
      isBitcoinBased: true,
      activeNetwork: {
        currency: 'sys',
        chainId: 57,
        url: 'https://blockbook.example',
      },
    },
  };
});

it('restores hash-only details from a full Blockbook read without inventing an account amount', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  render(<SyscoinTransactionDetails hash={mockHash} tx={undefined} />);

  expect(await screen.findByText('raw-from')).toBeTruthy();
  expect(screen.getByText('raw-to')).toBeTruthy();
  expect(screen.getAllByText('send.pending')).toHaveLength(3);
  expect(confirmationValue().textContent).toBe('0');
  expect(screen.queryByText('9 SYS')).toBeNull();
  expect(
    screen.queryByText('transactions.transactionNotFoundOrPending')
  ).toBeNull();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getSysTransactionFromBlockbook'],
    [mockHash, 'https://blockbook.example']
  );
});

it('restores the same hash-only detail from raw cache without another controller read', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  const first = render(<SyscoinTransactionDetails hash={mockHash} />);
  await screen.findByText('raw-from');
  first.unmount();

  render(<SyscoinTransactionDetails hash={mockHash.toUpperCase()} />);
  expect(await screen.findByText('raw-to')).toBeTruthy();
  expect(screen.getAllByText('send.pending')).toHaveLength(3);
  expect(screen.queryByText('9 SYS')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each(['null', 'rejected', 'wrong-hash'])(
  'keeps a hash-only %s read graceful without rendering unrelated transaction data',
  async (result) => {
    const errorLog = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      if (result === 'rejected')
        mockEmitter.mockRejectedValue(
          new Error('Public Blockbook read failed')
        );
      else
        mockEmitter.mockResolvedValue(
          result === 'null' ? null : rawTransaction({ txid: 'f'.repeat(64) })
        );
      render(<SyscoinTransactionDetails hash={mockHash} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.getByText('transactions.transactionNotFoundOrPending')
      ).toBeTruthy();
      expect(
        screen.getByText('transactions.transactionMayNotExistYet')
      ).toBeTruthy();
      expect(screen.queryByText('raw-from')).toBeNull();
      expect(screen.queryByText('send.pending')).toBeNull();
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(result === 'rejected' ? 1 : 0);
    } finally {
      errorLog.mockRestore();
    }
  }
);

it('uses current summary confirmation and separate native change over pending raw cached metadata', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  const first = render(<SyscoinTransactionDetails hash={mockHash} />);
  await screen.findByText('raw-from');
  first.unmount();

  const summary = rawTransaction({
    confirmations: 7,
    blockHeight: 123,
    blockHash: 'current-block',
    blockTime: 123456,
    direction: 'sent',
    addressValueIn: '1000000000',
    addressValueOut: '800000000',
  });
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={summary} />
  );
  expect(
    await screen.findByText('send.nativeBalanceChange: -2 SYS')
  ).toBeTruthy();
  expect(screen.queryByText('2 SYS')).toBeNull();
  expect(screen.getByText('send.confirmed')).toBeTruthy();
  expect(screen.queryByText('send.pending')).toBeNull();
  expect(confirmationValue().textContent).toBe('7');
  expect(screen.getByText('current-block')).toBeTruthy();
  expect(mockEmitter).toHaveBeenCalledTimes(1);

  view.rerender(
    <SyscoinTransactionDetails
      hash={mockHash}
      tx={{
        ...summary,
        confirmations: 8,
        addressValueOut: '700000000',
      }}
    />
  );
  expect(screen.getByText('send.nativeBalanceChange: -3 SYS')).toBeTruthy();
  expect(screen.queryByText('2 SYS')).toBeNull();
  expect(confirmationValue().textContent).toBe('8');
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'formats fee units and pending block fields, omitted REST fields: %s',
  async (omitted) => {
    mockState.vault.activeNetwork.currency = 'tsys';
    const pendingRow = rawTransaction({
      fees: '226',
      blockHash: undefined,
      blockTime: omitted ? undefined : 1791600000,
      addressValueIn: '100000226',
      addressValueOut: '100000000',
    });
    const pending = omitted
      ? JSON.parse(JSON.stringify(pendingRow))
      : pendingRow;
    mockEmitter.mockResolvedValue(pending);
    render(<SyscoinTransactionDetails hash={mockHash} tx={pending} />);

    await screen.findByText('raw-from');
    expect(detailValue('Fees', '0.00000226 TSYS')).toBeTruthy();
    expect(screen.getByText('send.transactionValue')).toBeTruthy();
    expect(detailValue('Block Hash', 'send.pending')).toBeTruthy();
    expect(detailValue('Block Time', 'send.pending')).toBeTruthy();
    expect(screen.queryByText('undefined')).toBeNull();
    expect(screen.queryByText('1791600000')).toBeNull();
  }
);

it('formats a confirmed block time using the selected language', async () => {
  const blockTime = 1791600000;
  const confirmed = rawTransaction({
    blockHeight: 1,
    confirmations: 1,
    blockHash: 'confirmed-block',
    blockTime,
  });
  mockEmitter.mockResolvedValue(confirmed);
  render(<SyscoinTransactionDetails hash={mockHash} tx={confirmed} />);
  await screen.findByText('raw-from');
  expect(detailValue('Block Hash', 'confirmed-block')).toBeTruthy();
  expect(
    detailValue('Block Time', new Date(blockTime * 1000).toLocaleString('en'))
  ).toBeTruthy();
  expect(screen.queryByText(String(blockTime))).toBeNull();
});

it('hydrates a native self-send output value while keeping its small native change secondary', async () => {
  const full = deferred<ISysTransaction>();
  mockEmitter.mockReturnValue(full.promise);
  const summary = rawTransaction({
    addressValueIn: '100000226',
    addressValueOut: '100000000',
    vin: [],
    vout: [],
    fees: '226',
  });
  render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
  expect(
    screen.getByText('send.nativeBalanceChange: -0.00000226 SYS')
  ).toBeTruthy();
  expect(
    within(
      screen.getByText('send.transactionValue').parentElement!
    ).queryByText('0.00000226 SYS')
  ).toBeNull();
  await act(async () =>
    full.resolve(
      rawTransaction({
        fees: '226',
        vin: [{ addresses: ['raw-from'], value: '100000226' }] as any,
        vout: [{ addresses: ['raw-to'], value: '100000000' }] as any,
      })
    )
  );
  expect(await screen.findByText('raw-from')).toBeTruthy();
  expect(screen.getByText('1 SYS')).toBeTruthy();
  expect(
    screen.getByText('send.nativeBalanceChange: -0.00000226 SYS')
  ).toBeTruthy();
  expect(screen.queryByText('9 SYS')).toBeNull();
});

it('waits for account totals instead of inferring an amount from a full output', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  const minimal = rawTransaction({ vin: [], vout: [] });
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={minimal} />
  );
  expect(screen.getByText('settings.unavailable')).toBeTruthy();
  await screen.findByText('raw-from');
  expect(screen.getByText('settings.unavailable')).toBeTruthy();
  expect(screen.queryByText('9 SYS')).toBeNull();

  view.rerender(
    <SyscoinTransactionDetails
      hash={mockHash}
      tx={{
        ...minimal,
        addressValueIn: '100000000',
        addressValueOut: '100000000',
      }}
    />
  );
  expect(screen.getByText('send.nativeBalanceChange: 0 SYS')).toBeTruthy();
  expect(screen.getByText('settings.unavailable')).toBeTruthy();
  expect(screen.queryByText('0 SYS')).toBeNull();
});

it('labels multiple all-self native outputs as a total in Details', async () => {
  const tx = rawTransaction({
    fees: '226',
    addressValueIn: '100000226',
    addressValueOut: '100000000',
    vin: [{ addresses: ['raw-from'], value: '100000226' }] as any,
    vout: [
      { addresses: ['raw-to'], value: '20000000' },
      { addresses: ['raw-change'], value: '80000000' },
    ] as any,
  });
  mockEmitter.mockResolvedValueOnce(tx);
  render(<SyscoinTransactionDetails hash={mockHash} tx={tx} />);
  expect(screen.getByText('send.selfTransferOutputTotal')).toBeTruthy();
  expect(screen.getByText('1 SYS')).toBeTruthy();
  expect(
    screen.getByText('send.nativeBalanceChange: -0.00000226 SYS')
  ).toBeTruthy();
  await screen.findByText('raw-from');
});

it.each([
  [compactBridgeNativeOffset, '1.0000 SYSX'],
  [compactBridgeWithAccountAsset, '0.100000 SYSX'],
])(
  'shows actual compact bridge operation value after full transaction hydration',
  async (compact, amount) => {
    const summary = rawTransaction({
      ...compact,
      txid: mockHash,
      vin: [],
      vout: [],
    });
    const full = deferred<ISysTransaction>();
    mockEmitter.mockReturnValue(full.promise);
    render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
    expect(screen.getAllByText('settings.unavailable').length).toBeGreaterThan(
      0
    );
    await act(async () =>
      full.resolve(
        rawTransaction({
          blockHeight: 1,
          confirmations: 1,
          tokenType: 'SPTAssetAllocationBurnToNEVM',
          vout: [
            {
              addresses: ['OP_RETURN'],
              value: '0',
              assetInfo: {
                assetGuid: '123456',
                value:
                  compact === compactBridgeNativeOffset
                    ? '100000000'
                    : '10000000',
              },
            },
          ] as any,
          tokenTransfers: [
            { token: '123456', symbol: 'SYSX', decimals: 8 },
          ] as any,
        })
      )
    );
    expect(await screen.findByText('raw-from')).toBeTruthy();
    expect(screen.getByText(amount)).toBeTruthy();
    expect(screen.getByText('send.transactionValue')).toBeTruthy();
    expect(
      screen.getByText(new RegExp('send.nativeBalanceChange'))
    ).toBeTruthy();
    expect(screen.getAllByText('Bridge to NEVM').length).toBeGreaterThan(0);
  }
);

it.each(
  ['account', 'network'].flatMap((scope) =>
    ['old-first', 'current-first'].map((order) => ({ scope, order }))
  )
)(
  'rejects an old $scope reply with $order completion order',
  async ({ scope, order }) => {
    const old = deferred<ISysTransaction>();
    const current = deferred<ISysTransaction>();
    mockEmitter
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const view = render(<SyscoinTransactionDetails hash={mockHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
    mockState = {
      ...mockState,
      scope: { ...mockState.scope, [scope]: `${scope}-b` },
      vault: {
        ...mockState.vault,
        activeNetwork: {
          ...mockState.vault.activeNetwork,
          ...(scope === 'network'
            ? { url: 'https://other-blockbook.example' }
            : {}),
        },
      },
    };
    view.rerender(<SyscoinTransactionDetails hash={mockHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
    const finishOld = async () => {
      await act(async () => {
        old.resolve(
          rawTransaction({
            vin: [{ addresses: ['stale-from'], value: '1' }] as any,
          })
        );
      });
      expect(screen.queryByText('stale-from')).toBeNull();
    };
    const finishCurrent = async () => {
      await act(async () => {
        current.resolve(
          rawTransaction({
            vin: [{ addresses: ['current-from'], value: '1' }] as any,
          })
        );
      });
      expect(await screen.findByText('current-from')).toBeTruthy();
    };
    if (order === 'old-first') {
      await finishOld();
      await finishCurrent();
    } else {
      await finishCurrent();
      await finishOld();
    }
    expect(screen.getByText('current-from')).toBeTruthy();
    expect(screen.queryByText('stale-from')).toBeNull();
  }
);
