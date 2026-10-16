/** @jest-environment jsdom */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { clearTokenIconCache } from 'components/TokenIcon';
import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import { getKnownTokenLogo, getTokenLogo } from 'utils/tokens';

import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from './history.fixtures';
import { SyscoinTransactionDetails } from './SyscoinDetails';

let mockState: any;
let mockHash: string;
let mockSequence = 0;
const mockEmitter = jest.fn();
const mockIconFetch = jest.fn();
const originalFetch = global.fetch;

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
  NftFallbackSvg: () => null,
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
  return {
    camelCaseToText: format.camelCaseToText,
    ellipsis: format.ellipsis,
    getTokenLogo: jest.requireActual('utils/tokens').getTokenLogo,
  };
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
const tokenTransaction = (
  assetGuid: string | undefined = '123456',
  symbol = 'SYSX'
) =>
  rawTransaction({
    direction: 'sent',
    addressValueIn: '1000',
    addressValueOut: '0',
    tokenType: 'SPTAssetAllocationSend',
    accountAssetTransfers: [
      { assetGuid, symbol, decimals: 8, value: '100000000' },
    ] as any,
    tokenTransfers: [{ token: assetGuid, symbol, decimals: 8 }] as any,
  });
const setAccountAssets = (syscoin: any[], id = 0) => {
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      accountAssets: {
        ...mockState.vault.accountAssets,
        HDAccount: {
          ...mockState.vault.accountAssets.HDAccount,
          [id]: { ethereum: [], syscoin },
        },
      },
    },
  };
};
const expectAmountIcon = async (amount: string, logo: string) => {
  const icon = await screen.findByAltText(/./);
  await waitFor(() => expect(icon.getAttribute('src')).toBe(logo));
  expect(screen.getByText(amount).parentElement!.contains(icon)).toBe(true);
  return icon;
};

beforeEach(() => {
  jest.clearAllMocks();
  clearTokenIconCache();
  // Exercise the real icon/cache component without making any image request.
  // A synthetic oversized blob keeps the requested URL as the rendered src.
  mockIconFetch.mockResolvedValue({
    ok: true,
    blob: async () => ({ size: 256 * 1024 + 1 }),
  });
  global.fetch = mockIconFetch as any;
  mockHash = 'abc' + (++mockSequence).toString(16).padStart(61, '0');
  mockState = {
    scope: { account: 'account-a', network: 'network-a' },
    vault: {
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
      activeNetwork: {
        currency: 'sys',
        chainId: 57,
        url: 'https://blockbook.example',
      },
    },
  };
});

afterEach(() => {
  clearTokenIconCache();
  global.fetch = originalFetch;
});

it('shows the canonical SYSX icon beside its amount without importing the token', async () => {
  const transaction = tokenTransaction();
  const officialLogo = getKnownTokenLogo(undefined, undefined, '123456')!;
  mockEmitter.mockResolvedValue(transaction);
  expect(selectActiveAccountAssets(mockState).syscoin).toEqual([]);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await expectAmountIcon('1.0000 SYSX', officialLogo);
  expect(mockIconFetch).toHaveBeenCalledWith(officialLogo);
});

it('uses a custom logo only from the active account and exact GUID on the active chain', async () => {
  const logo = 'https://icons.example/exact-active-token.png';
  setAccountAssets([
    { assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: logo },
    {
      assetGuid: '900002',
      chainId: 57,
      symbol: 'CUSTOM',
      image: 'https://icons.example/same-symbol-other-guid.png',
    },
  ]);
  setAccountAssets(
    [
      {
        assetGuid: '900001',
        chainId: 57,
        symbol: 'CUSTOM',
        image: 'https://icons.example/other-account.png',
      },
    ],
    1
  );
  const transaction = tokenTransaction('900001', 'CUSTOM');
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await expectAmountIcon('1.0000 CUSTOM', logo);
  expect(mockIconFetch.mock.calls.map(([url]) => url)).toEqual([logo]);
});

it('does not let an earlier unscoped or wrong-chain entry shadow the exact-chain logo', async () => {
  const logo = 'https://icons.example/exact-chain-after-legacy.png';
  setAccountAssets([
    {
      assetGuid: '900001',
      symbol: 'CUSTOM',
      image: 'https://icons.example/unscoped-legacy.png',
    },
    {
      assetGuid: '900001',
      chainId: 5700,
      symbol: 'CUSTOM',
      image: 'https://icons.example/wrong-chain-before-exact.png',
    },
    { assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: logo },
  ]);
  const transaction = tokenTransaction('900001', 'CUSTOM');
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await expectAmountIcon('1.0000 CUSTOM', logo);
  expect(mockIconFetch.mock.calls.map(([url]) => url)).toEqual([logo]);
});

it.each([undefined, 5700])(
  'keeps the normal unknown-token fallback when a custom logo has chainId %s',
  async (chainId) => {
    const logo = 'https://icons.example/not-exact-chain.png';
    setAccountAssets([
      { assetGuid: '900001', chainId, symbol: 'CUSTOM', image: logo },
    ]);
    const transaction = tokenTransaction('900001', 'CUSTOM');
    mockEmitter.mockResolvedValue(transaction);

    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    await waitFor(() => {
      const icon = screen.getByAltText('CUSTOM');
      expect(icon.getAttribute('src')).toBe(
        getTokenLogo('CUSTOM', true, '900001')
      );
      expect(
        screen.getByText('1.0000 CUSTOM').parentElement!.contains(icon)
      ).toBe(true);
    });
    expect(mockIconFetch).not.toHaveBeenCalled();
  }
);

it.each(['wrong-chain', 'other-account', 'same-symbol-other-guid'])(
  'does not borrow a custom logo from a %s imported asset',
  async (mismatch) => {
    const logo = `https://icons.example/rejected-${mismatch}.png`;
    setAccountAssets(
      [
        {
          assetGuid:
            mismatch === 'same-symbol-other-guid' ? '900002' : '900001',
          chainId: mismatch === 'wrong-chain' ? 5700 : 57,
          symbol: 'CUSTOM',
          image: logo,
        },
      ],
      mismatch === 'other-account' ? 1 : 0
    );
    const transaction = tokenTransaction('900001', 'CUSTOM');
    mockEmitter.mockResolvedValue(transaction);

    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    await screen.findByText('1.0000 CUSTOM');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockIconFetch).not.toHaveBeenCalledWith(logo);
    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === logo)
    ).toBe(false);
  }
);

it.each([false, true])(
  'never awards an official SYSX logo to a symbol-only impostor (wrong-chain import: %s)',
  async (wrongChain) => {
    const officialLogo = getKnownTokenLogo(undefined, undefined, '123456')!;
    setAccountAssets([
      {
        assetGuid: '900003',
        chainId: wrongChain ? 5700 : 57,
        symbol: 'SYSX',
        image: officialLogo,
      },
    ]);
    const transaction = tokenTransaction('900003');
    mockEmitter.mockResolvedValue(transaction);

    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    await screen.findByText('1.0000 SYSX');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockIconFetch).not.toHaveBeenCalledWith(officialLogo);
    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === officialLogo)
    ).toBe(false);
  }
);

it('does not infer the canonical GUID from a SYSX symbol or matching imported symbol', async () => {
  const officialLogo = getKnownTokenLogo(undefined, undefined, '123456')!;
  setAccountAssets([
    { assetGuid: '123456', chainId: 57, symbol: 'SYSX', image: officialLogo },
  ]);
  const transaction = tokenTransaction('');
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await screen.findByText('1.0000 SYSX');
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockIconFetch).not.toHaveBeenCalledWith(officialLogo);
  expect(
    screen
      .queryAllByRole('img', { hidden: true })
      .some((img) => img.getAttribute('src') === officialLogo)
  ).toBe(false);
});

it('keeps native transaction amounts free of a token icon', async () => {
  const transaction = rawTransaction({
    addressValueIn: '900001000',
    addressValueOut: '0',
    direction: 'sent',
  });
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await screen.findByText('raw-from');
  expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  expect(mockIconFetch).not.toHaveBeenCalled();
});

it('adds the canonical icon only after a compact transaction hydrates its GUID', async () => {
  const full = deferred<ISysTransaction>();
  mockEmitter.mockReturnValue(full.promise);
  const summary = rawTransaction({
    ...compactBridgeNativeOffset,
    txid: mockHash,
    vin: [],
    vout: [],
  });
  render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
  expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  expect(mockIconFetch).not.toHaveBeenCalled();

  await act(async () => {
    full.resolve(
      rawTransaction({
        tokenType: 'SPTAssetAllocationBurnToNEVM',
        tokenTransfers: [
          { token: '123456', symbol: 'SYSX', decimals: 8 },
        ] as any,
        vout: [
          {
            addresses: ['OP_RETURN'],
            value: '0',
            assetInfo: { assetGuid: '123456', value: '100000000' },
          },
        ] as any,
      })
    );
  });

  await expectAmountIcon(
    '1.0000 SYSX',
    getKnownTokenLogo(undefined, undefined, '123456')!
  );
});

it.each(['account', 'network', 'asset-guid', 'hash'])(
  'drops the previous token icon immediately when the %s identity changes',
  async (identity) => {
    const oldLogo = `https://icons.example/${identity}-old.png`;
    const nextLogo = `https://icons.example/${identity}-current.png`;
    const currentImage = deferred<any>();
    setAccountAssets([
      { assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: oldLogo },
      { assetGuid: '900002', chainId: 57, symbol: 'CUSTOM', image: nextLogo },
      { assetGuid: '900001', chainId: 5700, symbol: 'CUSTOM', image: nextLogo },
    ]);
    setAccountAssets(
      [{ assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: nextLogo }],
      1
    );
    const oldTransaction = tokenTransaction('900001', 'CUSTOM');
    mockEmitter.mockResolvedValue(oldTransaction);
    const view = render(
      <SyscoinTransactionDetails hash={mockHash} tx={oldTransaction} />
    );
    await expectAmountIcon('1.0000 CUSTOM', oldLogo);
    mockIconFetch.mockImplementation((url) => {
      if (url === nextLogo) return currentImage.promise;
      throw new Error(`Unexpected icon fixture: ${url}`);
    });
    const nextHash = identity === 'hash' ? 'd'.repeat(64) : mockHash;
    const nextGuid = ['asset-guid', 'hash'].includes(identity)
      ? '900002'
      : '900001';
    const nextTransaction = {
      ...tokenTransaction(nextGuid, 'CUSTOM'),
      txid: nextHash,
    };
    mockState = {
      ...mockState,
      scope: {
        ...mockState.scope,
        ...(identity === 'account' ? { account: 'account-b' } : {}),
        ...(identity === 'network' ? { network: 'network-b' } : {}),
      },
      vault: {
        ...mockState.vault,
        activeAccount: {
          type: 'HDAccount',
          id: identity === 'account' ? 1 : 0,
        },
        activeNetwork: {
          ...mockState.vault.activeNetwork,
          ...(identity === 'network'
            ? { chainId: 5700, url: 'https://other-blockbook.example' }
            : {}),
        },
      },
    };
    mockEmitter.mockResolvedValue(nextTransaction);
    view.rerender(
      <SyscoinTransactionDetails hash={nextHash} tx={nextTransaction} />
    );

    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === oldLogo)
    ).toBe(false);
    await waitFor(() => expect(mockIconFetch).toHaveBeenCalledWith(nextLogo));
    await act(async () => {
      currentImage.resolve({
        ok: true,
        blob: async () => ({ size: 256 * 1024 + 1 }),
      });
    });
    await expectAmountIcon('1.0000 CUSTOM', nextLogo);
    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === oldLogo)
    ).toBe(false);
  }
);

it.each(['account', 'network', 'hash'])(
  'does not restore a stale icon from an old full-read reply after a %s switch',
  async (identity) => {
    const old = deferred<ISysTransaction>();
    const current = deferred<ISysTransaction>();
    mockEmitter
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const view = render(<SyscoinTransactionDetails hash={mockHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
    const nextHash = identity === 'hash' ? 'e'.repeat(64) : mockHash;
    mockState = {
      ...mockState,
      scope: {
        ...mockState.scope,
        ...(identity === 'account' ? { account: 'account-b' } : {}),
        ...(identity === 'network' ? { network: 'network-b' } : {}),
      },
      vault: {
        ...mockState.vault,
        activeAccount: {
          type: 'HDAccount',
          id: identity === 'account' ? 1 : 0,
        },
        activeNetwork: {
          ...mockState.vault.activeNetwork,
          ...(identity === 'network'
            ? { chainId: 5700, url: 'https://other-blockbook.example' }
            : {}),
        },
      },
    };
    view.rerender(<SyscoinTransactionDetails hash={nextHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
    await act(async () => {
      current.resolve({ ...rawTransaction(), txid: nextHash });
    });
    await screen.findByText('raw-from');
    await act(async () => {
      old.resolve(tokenTransaction());
    });

    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
    expect(mockIconFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('1.0000 SYSX')).toBeNull();
  }
);

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
