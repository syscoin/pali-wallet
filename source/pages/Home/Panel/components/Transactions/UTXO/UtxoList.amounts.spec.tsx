/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from './history.fixtures';
import { UtxoTransactionsListComponent } from './UtxoList';
import { readUtxoTransactionDetails } from './utxoTransactionDetails';

const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
const mockTokenIcon = jest.fn();
let mockActiveAssets: { syscoin: any[] };
let mockScope: { account: string; network: string };
let mockUrl: string;
let mockSequence = 0;
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: { currency: 'tsys', chainId: 5700, url: mockUrl },
      },
    }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'notifications.clickToView' ? 'Details' : key),
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountAssets: () => mockActiveAssets,
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    useCopyClipboard: () => [false, jest.fn()],
    alert: { success: jest.fn() },
  }),
}));
jest.mock('../utils/useTransactionsInfos', () => ({
  useTransactionsListConfig: () => ({
    getTxStatus: () => null,
    formatTimeStampUtxo: () => null,
    blocktime: 'blockTime',
  }),
}));
jest.mock('../../../../useHomeBrowsingState', () => ({}));
jest.mock('../useHistoryBrowsingState', () => ({}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('@ant-design/icons', () => ({}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({
  TokenIcon: (props: unknown) => {
    mockTokenIcon(props);
    return null;
  },
}));
jest.mock('utils/index', () => ({
  getTokenLogo: () => undefined,
  ellipsis: (value: string) => value,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockScope = { account: 'account-a', network: `network-${++mockSequence}` };
  mockUrl = 'https://blockbook.example';
  mockActiveAssets = { syscoin: [] };
});

const fullBridge = (amount = '100000000') => ({
  ...compactBridgeNativeOffset,
  vout: [
    {
      addresses: ['OP_RETURN'],
      value: '0',
      assetInfo: { assetGuid: '123456', value: amount },
    },
  ],
  tokenTransfers: [{ token: '123456', symbol: 'SYSX', decimals: 8 }],
});

const cacheScope = (tx: { txid: string }) =>
  `${mockScope.account}:${mockScope.network}:${tx.txid.toLowerCase()}`;
const visitDetails = async (full: any, key = cacheScope(full)) => {
  const read = jest.fn().mockResolvedValue(full);
  await act(async () => {
    await readUtxoTransactionDetails(key, full.txid, read, () => true);
  });
  expect(read).toHaveBeenCalledTimes(1);
};
const expectNoUnknownAmountLabel = () => {
  expect(screen.queryByText('buttons.loading')).toBeNull();
  expect(screen.queryByText('settings.unavailable')).toBeNull();
};

it('leaves an incomplete bridge amount absent and navigates to Details without a list RPC', async () => {
  render(<UtxoTransactionsListComponent tx={compactBridgeNativeOffset} />);

  expect(screen.getByText('Bridge to NEVM')).toBeTruthy();
  expect(screen.queryByText('29.5985 TSYS')).toBeNull();
  expect(screen.queryByText('1.0000 SYSX')).toBeNull();
  expectNoUnknownAmountLabel();
  expect(
    screen.queryByText('send.nativeBalanceChange: -29.5985194 TSYS')
  ).toBeNull();
  expect(screen.queryByText(/^send\.fee:/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(mockNavigate).toHaveBeenCalledWith('/home/details', {
    state: {
      id: null,
      hash: compactBridgeNativeOffset.txid,
      tx: compactBridgeNativeOffset,
    },
  });
  await act(async () => Promise.resolve());
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each(['{Enter}', ' '])(
  'opens UTXO details with the real keyboard action %s without fetching a list row',
  async (key) => {
    const user = userEvent.setup();
    render(<UtxoTransactionsListComponent tx={compactBridgeNativeOffset} />);
    const action = screen.getByRole('button', { name: 'Details' });
    // The row's existing copy action precedes Details in normal tab order.
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(action);
    await user.keyboard(key);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/home/details',
      expect.anything()
    );
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('shows a compact account asset quantity until Details supplies the full bridge amount', async () => {
  const view = render(
    <UtxoTransactionsListComponent tx={compactBridgeWithAccountAsset} />
  );
  const compactAmount = screen.getByText('0.100000 SYSX');
  expect(within(compactAmount.parentElement!).queryByText('+')).toBeNull();
  expect(within(compactAmount.parentElement!).queryByText('−')).toBeNull();
  expectNoUnknownAmountLabel();
  expect(mockEmitter).not.toHaveBeenCalled();
  await visitDetails({
    ...fullBridge('200000000'),
    txid: compactBridgeWithAccountAsset.txid,
  });

  expect(screen.getByText('Bridge to NEVM')).toBeTruthy();
  const amount = screen.getByText('2.0000 SYSX');
  expect(screen.queryByText('0.100000 SYSX')).toBeNull();
  expect(within(amount.parentElement!).queryByText('−')).toBeNull();
  expect(
    screen.queryByText('send.nativeBalanceChange: -0.0000187 TSYS')
  ).toBeNull();
  view.unmount();
  render(<UtxoTransactionsListComponent tx={compactBridgeWithAccountAsset} />);
  expect(screen.getByText('2.0000 SYSX')).toBeTruthy();
  expectNoUnknownAmountLabel();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('uses only the explicit asset direction for a compact bridge quantity sign', () => {
  render(
    <UtxoTransactionsListComponent
      tx={{
        ...compactBridgeWithAccountAsset,
        direction: 'received',
        accountAssetTransfers: [
          {
            ...compactBridgeWithAccountAsset.accountAssetTransfers[0],
            direction: 'sent',
          },
        ],
      }}
    />
  );
  const amount = screen.getByText('0.100000 SYSX');
  expect(amount.textContent).toBe('−0.100000 SYSX');
  expect(screen.getByText('send.sent')).toBeTruthy();
  expectNoUnknownAmountLabel();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each(['account', 'network'] as const)(
  'ignores an old Details response after the list changes %s scope',
  async (changedScope) => {
    let finishOld!: (value: any) => void;
    const oldRead = readUtxoTransactionDetails(
      cacheScope(compactBridgeNativeOffset),
      compactBridgeNativeOffset.txid,
      () => new Promise((resolve) => (finishOld = resolve)),
      () => true
    );
    const view = render(
      <UtxoTransactionsListComponent tx={compactBridgeNativeOffset} />
    );
    await waitFor(() => expect(finishOld).toBeDefined());
    mockScope = { ...mockScope, [changedScope]: `${changedScope}-b` };
    view.rerender(
      <UtxoTransactionsListComponent tx={{ ...compactBridgeNativeOffset }} />
    );
    await act(async () => {
      finishOld(fullBridge());
      await oldRead;
    });
    expect(screen.queryByText('1.0000 SYSX')).toBeNull();
    expectNoUnknownAmountLabel();
    await visitDetails(fullBridge('200000000'));
    expect(screen.getByText('2.0000 SYSX')).toBeTruthy();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('prefers actual full burn amount over a smaller account asset contribution', async () => {
  await visitDetails({
    ...fullBridge('200000000'),
    txid: compactBridgeWithAccountAsset.txid,
  });
  render(<UtxoTransactionsListComponent tx={compactBridgeWithAccountAsset} />);
  expect(screen.queryByText('0.100000 SYSX')).toBeNull();
  const amount = screen.getByText('2.0000 SYSX');
  expect(within(amount.parentElement!).queryByText('−')).toBeNull();
  expect(screen.queryByText('0.100000 SYSX')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps ordinary compact SPT transfer value without hydration', () => {
  render(
    <UtxoTransactionsListComponent
      tx={{
        ...compactBridgeWithAccountAsset,
        tokenType: 'SPTAssetAllocationSend',
      }}
    />
  );
  const amount = screen.getByText('0.100000 SYSX');
  expect(within(amount.parentElement!).queryByText('+')).toBeNull();
  expect(within(amount.parentElement!).queryByText('−')).toBeNull();
  expect(screen.getByText('send.confirmed')).toBeTruthy();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each(['unscoped-only', 'wrong-chain-only', 'exact-chain-after-legacy'])(
  'selects only exact-chain Activity icon metadata: %s',
  (scenario) => {
    const legacy = {
      assetGuid: '900001',
      symbol: 'CUSTOM',
      image: 'https://icons.example/activity-unscoped.png',
    };
    const wrongChain = {
      ...legacy,
      chainId: 57,
      image: 'https://icons.example/activity-wrong-chain.png',
    };
    const exact = {
      ...legacy,
      chainId: 5700,
      image: 'https://icons.example/activity-exact-chain.png',
    };
    mockActiveAssets.syscoin =
      scenario === 'unscoped-only'
        ? [legacy]
        : scenario === 'wrong-chain-only'
        ? [wrongChain]
        : [legacy, wrongChain, exact];

    render(
      <UtxoTransactionsListComponent
        tx={{
          ...compactBridgeWithAccountAsset,
          tokenType: 'SPTAssetAllocationSend',
          accountAssetTransfers: [
            {
              assetGuid: '900001',
              value: '10000000',
              decimals: 8,
              symbol: 'CUSTOM',
            },
          ],
        }}
      />
    );

    expect(screen.getByText('0.100000 CUSTOM')).toBeTruthy();
    if (scenario === 'exact-chain-after-legacy') {
      expect(mockTokenIcon).toHaveBeenCalledWith(
        expect.objectContaining({ assetGuid: '900001', logo: exact.image })
      );
    } else {
      // Unimported/unknown Activity tokens retain their existing no-icon fallback.
      expect(mockTokenIcon).not.toHaveBeenCalled();
    }
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('keeps an SPT receipt compact without the native funding breakdown', () => {
  render(
    <UtxoTransactionsListComponent
      tx={{
        ...compactBridgeWithAccountAsset,
        tokenType: 'SPTAssetAllocationSend',
        direction: 'sent',
        accountAssetTransfers: [
          {
            assetGuid: '123456',
            value: '10000000',
            decimals: 8,
            symbol: 'SYSX',
          },
        ],
        vout: [
          {
            isOwn: true,
            assetInfo: { assetGuid: '123456', value: '10000000' },
          },
        ] as any,
      }}
    />
  );
  const amount = screen.getByText('0.100000 SYSX');
  expect(within(amount.parentElement!).getByText('+')).toBeTruthy();
  expect(amount.textContent).toBe('+0.100000 SYSX');
  expect(screen.getByText('send.received')).toBeTruthy();
  expect(
    screen.queryByText('send.nativeBalanceChange: -0.0000187 TSYS')
  ).toBeNull();
  expect(screen.queryByText(/^send\.fee:/)).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('uses Details-cached SPT metadata while preserving account ownership, not the first asset output', async () => {
  const tx = {
    ...compactBridgeNativeOffset,
    tokenType: 'SPTAssetAllocationSend',
    vin: [{ isOwn: true }],
    vout: [{ isOwn: false }, { isOwn: true }],
  } as any;
  render(<UtxoTransactionsListComponent tx={tx} />);
  expectNoUnknownAmountLabel();
  await visitDetails({
    ...tx,
    vin: [{ assetInfo: { assetGuid: 'owned', value: '100000000' } }],
    vout: [
      { assetInfo: { assetGuid: 'unrelated', value: '99900000000' } },
      { assetInfo: { assetGuid: 'owned', value: '60000000' } },
    ],
    tokenTransfers: [{ token: 'owned', decimals: 8, symbol: 'OWNED' }],
  });
  const amount = screen.getByText('0.400000 OWNED');
  expect(within(amount.parentElement!).getByText('−')).toBeTruthy();
  expect(amount.textContent).toBe('−0.400000 OWNED');
  expect(screen.queryByText(/999/)).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('shows zero account movement instead of an unrelated transaction output', async () => {
  render(
    <UtxoTransactionsListComponent
      tx={{
        ...compactBridgeNativeOffset,
        addressValueIn: '100000000',
        addressValueOut: '100000000',
        tokenType: undefined,
        vout: [{ value: '900000000', isOwn: true }] as any,
      }}
    />
  );
  expect(screen.queryByText('send.nativeBalanceChange: 0 TSYS')).toBeNull();
  await act(async () => Promise.resolve());
  expectNoUnknownAmountLabel();
  expect(screen.getByText('0.0000 TSYS').textContent).toBe('0.0000 TSYS');
  expect(screen.queryByText('9.0000 TSYS')).toBeNull();
  expect(screen.queryByText('Bridge to NEVM')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('shows a native self-send fee loss from account totals and keeps it after contradictory Details data', async () => {
  const tx = {
    ...compactBridgeNativeOffset,
    tokenType: undefined,
    addressValueIn: '6547561',
    addressValueOut: '6547335',
    fees: '226',
  };
  render(<UtxoTransactionsListComponent tx={tx} />);
  expect(screen.getByText('0.00000226 TSYS').textContent).toBe(
    '−0.00000226 TSYS'
  );
  expect(screen.queryByText('0.065473 TSYS')).toBeNull();
  expectNoUnknownAmountLabel();
  expect(mockEmitter).not.toHaveBeenCalled();
  await visitDetails({
    txid: tx.txid,
    fees: '226',
    vin: [{ value: '1000000226' }],
    vout: [{ value: '1000000000' }],
  });
  expect(screen.getByText('0.00000226 TSYS').textContent).toBe(
    '−0.00000226 TSYS'
  );
  expect(screen.queryByText('10.0000 TSYS')).toBeNull();
  expect(screen.queryByText('0.065473 TSYS')).toBeNull();
  expect(
    screen.queryByRole('img', { name: 'send.selfTransferOutputTotal' })
  ).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each(['sent', 'received'] as const)(
  'keeps a compact native %s status when its amount is unknown',
  (direction) => {
    render(
      <UtxoTransactionsListComponent
        tx={{
          ...compactBridgeNativeOffset,
          tokenType: undefined,
          direction,
          addressValueIn: undefined,
          addressValueOut: undefined,
        }}
      />
    );
    expect(screen.getByText(`send.${direction}`)).toBeTruthy();
    expect(screen.queryByText(/TSYS/)).toBeNull();
    expectNoUnknownAmountLabel();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('shows the signed native wallet loss including fees, independent of transaction outputs', () => {
  render(
    <UtxoTransactionsListComponent
      tx={
        {
          ...compactBridgeNativeOffset,
          tokenType: undefined,
          addressValueIn: '100000226',
          addressValueOut: '30000000',
          fees: '226',
          vin: [{ value: '100000226' }],
          vout: [
            { value: '20000000' },
            { value: '30000000' },
            { value: '50000000' },
          ],
        } as any
      }
    />
  );
  expect(screen.getByText('0.700002 TSYS').textContent).toBe('−0.700002 TSYS');
  expect(screen.queryByText('0.700000 TSYS')).toBeNull();
  expect(
    screen.queryByText('send.nativeBalanceChange: -0.70000226 TSYS')
  ).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('shows only the fee loss for a multi-output native self-send', () => {
  render(
    <UtxoTransactionsListComponent
      tx={
        {
          ...compactBridgeNativeOffset,
          tokenType: undefined,
          addressValueIn: '100000226',
          addressValueOut: '100000000',
          fees: '226',
          vin: [{ value: '100000226' }],
          vout: [{ value: '20000000' }, { value: '80000000' }],
        } as any
      }
    />
  );
  expect(screen.getByText('0.00000226 TSYS').textContent).toBe(
    '−0.00000226 TSYS'
  );
  expect(screen.queryByText('1.0000 TSYS')).toBeNull();
  expect(screen.queryByText('send.selfTransferOutputTotal')).toBeNull();
  expect(
    screen.queryByRole('img', { name: 'send.selfTransferOutputTotal' })
  ).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('shows a known compact native receipt without a full read', () => {
  render(
    <UtxoTransactionsListComponent
      tx={{
        ...compactBridgeNativeOffset,
        tokenType: undefined,
        addressValueIn: '0',
        addressValueOut: '100000000',
        fees: '226',
      }}
    />
  );
  expect(screen.getByText('1.0000 TSYS').textContent).toBe('+1.0000 TSYS');
  expect(screen.queryByText('send.nativeBalanceChange: +1 TSYS')).toBeNull();
  expect(screen.getByText('send.received')).toBeTruthy();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps the native amount blank after raw Details when queried account totals are missing', async () => {
  const tx = {
    ...compactBridgeNativeOffset,
    tokenType: undefined,
    addressValueIn: undefined,
    addressValueOut: undefined,
    fees: '226',
  };
  render(<UtxoTransactionsListComponent tx={tx} />);
  expect(screen.queryByText(/TSYS/)).toBeNull();
  expectNoUnknownAmountLabel();
  await visitDetails({
    txid: tx.txid,
    fees: '226',
    addressValueIn: '200000226',
    addressValueOut: '200000000',
    vin: [{ value: '200000226' }],
    vout: [{ value: '200000000' }],
  });
  expect(screen.queryByText(/TSYS/)).toBeNull();
  expectNoUnknownAmountLabel();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('renders 40 incomplete restored rows without any list RPCs or placeholder amounts', async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    ...compactBridgeNativeOffset,
    txid: (index + 1).toString(16).padStart(64, '0'),
  }));
  render(
    <>
      {rows.map((tx) => (
        <UtxoTransactionsListComponent key={tx.txid} tx={tx} />
      ))}
    </>
  );
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
  expect(screen.getAllByText('Bridge to NEVM')).toHaveLength(40);
  expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(40);
  expectNoUnknownAmountLabel();
  expect(screen.queryByText('1.0000 SYSX')).toBeNull();
  expect(screen.queryByText('29.5985 TSYS')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not reuse cached details for a different transaction hash', async () => {
  await visitDetails(fullBridge());
  render(
    <UtxoTransactionsListComponent
      tx={{ ...compactBridgeNativeOffset, txid: 'ef'.repeat(32) }}
    />
  );
  await act(async () => Promise.resolve());
  expect(screen.queryByText('1.0000 SYSX')).toBeNull();
  expectNoUnknownAmountLabel();
  expect(mockEmitter).not.toHaveBeenCalled();
});
