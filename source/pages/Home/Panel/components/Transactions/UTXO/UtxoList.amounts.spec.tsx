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

import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from './history.fixtures';
import { UtxoTransactionsListComponent } from './UtxoList';

const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
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
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountAssets: () => ({ syscoin: [] }),
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
jest.mock('components/Icon/Icon', () => ({
  DetailArrowSvg: ({ onClick }: any) => (
    <button onClick={onClick}>Details</button>
  ),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('utils/index', () => ({
  getTokenLogo: () => undefined,
  ellipsis: (value: string) => value,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockScope = { account: 'account-a', network: `network-${++mockSequence}` };
  mockUrl = 'https://blockbook.example';
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

it('hydrates compact bridge operation value without treating native funding as asset ownership', async () => {
  mockEmitter.mockResolvedValueOnce(fullBridge());
  render(<UtxoTransactionsListComponent tx={compactBridgeNativeOffset} />);

  expect(screen.getByText('Bridge to NEVM')).toBeTruthy();
  expect(screen.queryByText('29.5985 TSYS')).toBeNull();
  expect(screen.getByText('buttons.loading')).toBeTruthy();
  const amount = await screen.findByText('1.0000 SYSX');
  expect(within(amount.parentElement!).queryByText('−')).toBeNull();
  expect(
    screen.queryByText('send.nativeBalanceChange: -29.5985194 TSYS')
  ).toBeNull();
  expect(screen.queryByText(/^send\.fee:/)).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(mockNavigate).toHaveBeenCalledWith('/home/details', {
    state: {
      id: null,
      hash: compactBridgeNativeOffset.txid,
      tx: compactBridgeNativeOffset,
    },
  });
});

it('hydrates the compact bridge burn amount and preserves its precision', async () => {
  mockEmitter.mockResolvedValueOnce({
    ...fullBridge('10000000'),
    txid: compactBridgeWithAccountAsset.txid,
  });
  render(<UtxoTransactionsListComponent tx={compactBridgeWithAccountAsset} />);

  expect(screen.getByText('Bridge to NEVM')).toBeTruthy();
  expect(screen.getByText('buttons.loading')).toBeTruthy();
  const amount = await screen.findByText('0.100000 SYSX');
  expect(within(amount.parentElement!).queryByText('−')).toBeNull();
  expect(
    screen.queryByText('send.nativeBalanceChange: -0.0000187 TSYS')
  ).toBeNull();
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await act(async () => Promise.resolve());
  expect(screen.getByText('0.100000 SYSX')).toBeTruthy();
});

it('does not apply an old network hydration response to the new account scope', async () => {
  let finishOld!: (value: any) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  const view = render(
    <UtxoTransactionsListComponent tx={compactBridgeNativeOffset} />
  );
  await waitFor(() => expect(finishOld).toBeDefined());
  mockScope = { account: 'account-b', network: 'network-b' };
  mockUrl = 'https://other-blockbook.example';
  mockEmitter.mockResolvedValueOnce(fullBridge('200000000'));
  view.rerender(
    <UtxoTransactionsListComponent tx={{ ...compactBridgeNativeOffset }} />
  );
  expect(await screen.findByText('2.0000 SYSX')).toBeTruthy();
  await act(async () => finishOld(fullBridge()));
  expect(screen.queryByText('1.0000 SYSX')).toBeNull();
  expect(screen.getByText('2.0000 SYSX')).toBeTruthy();
});

it('prefers actual full burn amount over a smaller account asset contribution', async () => {
  mockEmitter.mockResolvedValueOnce({
    ...fullBridge('200000000'),
    txid: compactBridgeWithAccountAsset.txid,
  });
  render(<UtxoTransactionsListComponent tx={compactBridgeWithAccountAsset} />);
  expect(screen.queryByText('0.100000 SYSX')).toBeNull();
  expect(screen.getByText('buttons.loading')).toBeTruthy();
  const amount = await screen.findByText('2.0000 SYSX');
  expect(within(amount.parentElement!).queryByText('−')).toBeNull();
  expect(screen.queryByText('0.100000 SYSX')).toBeNull();
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

it('hydrates ordinary SPT metadata while preserving explicit account ownership, not the first asset output', async () => {
  const tx = {
    ...compactBridgeNativeOffset,
    tokenType: 'SPTAssetAllocationSend',
    vin: [{ isOwn: true }],
    vout: [{ isOwn: false }, { isOwn: true }],
  } as any;
  mockEmitter.mockResolvedValueOnce({
    ...tx,
    vin: [{ assetInfo: { assetGuid: 'owned', value: '100000000' } }],
    vout: [
      { assetInfo: { assetGuid: 'unrelated', value: '99900000000' } },
      { assetInfo: { assetGuid: 'owned', value: '60000000' } },
    ],
    tokenTransfers: [{ token: 'owned', decimals: 8, symbol: 'OWNED' }],
  });
  render(<UtxoTransactionsListComponent tx={tx} />);
  const amount = await screen.findByText('0.400000 OWNED');
  expect(within(amount.parentElement!).getByText('−')).toBeTruthy();
  expect(amount.textContent).toBe('−0.400000 OWNED');
  expect(screen.queryByText(/999/)).toBeNull();
});

it('does not invent a value from an unrelated output when the account delta is zero', async () => {
  mockEmitter.mockResolvedValueOnce(null);
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
  await screen.findByText('settings.unavailable');
  expect(screen.queryByText('0.0000 TSYS')).toBeNull();
  expect(screen.queryByText('9.0000 TSYS')).toBeNull();
  expect(screen.queryByText('Bridge to NEVM')).toBeNull();
});

it('hydrates compact native self MAX to its actual output, not its fee', async () => {
  const tx = {
    ...compactBridgeNativeOffset,
    tokenType: undefined,
    addressValueIn: '6547561',
    addressValueOut: '6547335',
    fees: '226',
  };
  mockEmitter.mockResolvedValueOnce({
    ...tx,
    vin: [{ value: '6547561' }],
    vout: [{ value: '6547335' }],
  });
  render(<UtxoTransactionsListComponent tx={tx} />);
  expect(screen.queryByText('0.00000226 TSYS')).toBeNull();
  expect(await screen.findByText('0.065473 TSYS')).toBeTruthy();
  expect(
    screen.queryByText('send.nativeBalanceChange: -0.00000226 TSYS')
  ).toBeNull();
  expect(screen.queryByText('send.fee: 0.00000226 TSYS')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('shows external native recipient total, not fee-inclusive change or the first output', () => {
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
  expect(screen.getByText('0.700000 TSYS')).toBeTruthy();
  expect(
    screen.queryByText('send.nativeBalanceChange: -0.70000226 TSYS')
  ).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('qualifies a multi-output self total inline without another text row', () => {
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
  expect(screen.getByText('1.0000 TSYS')).toBeTruthy();
  expect(screen.queryByText('send.selfTransferOutputTotal')).toBeNull();
  expect(
    screen.getByTitle('send.selfTransferOutputTotal: 1.0000 TSYS')
  ).toBeTruthy();
  expect(
    screen.getByRole('img', { name: 'send.selfTransferOutputTotal' })
  ).toBeTruthy();
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
  expect(screen.getByText('1.0000 TSYS')).toBeTruthy();
  expect(screen.queryByText('send.nativeBalanceChange: +1 TSYS')).toBeNull();
  expect(screen.getByText('send.received')).toBeTruthy();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not reuse native output metadata from a departed account/network', async () => {
  let finishOld!: (value: any) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  const tx = {
    ...compactBridgeNativeOffset,
    tokenType: undefined,
    addressValueIn: '100000226',
    addressValueOut: '100000000',
    fees: '226',
  };
  const view = render(<UtxoTransactionsListComponent tx={tx} />);
  await waitFor(() => expect(finishOld).toBeDefined());
  mockScope = { account: 'another-account', network: 'another-network' };
  mockUrl = 'https://another-blockbook.example';
  const current = {
    ...tx,
    addressValueIn: '200000226',
    addressValueOut: '200000000',
  };
  mockEmitter.mockResolvedValueOnce({
    ...current,
    vin: [{ value: '200000226' }],
    vout: [{ value: '200000000' }],
  });
  view.rerender(<UtxoTransactionsListComponent tx={current} />);
  expect(await screen.findByText('2.0000 TSYS')).toBeTruthy();
  await act(async () =>
    finishOld({
      ...tx,
      vin: [{ value: '100000226' }],
      vout: [{ value: '100000000' }],
    })
  );
  expect(screen.queryByText('1.0000 TSYS')).toBeNull();
  expect(screen.getByText('2.0000 TSYS')).toBeTruthy();
});

it('eventually hydrates more than 32 restored rows without exceeding two active RPCs or dropping overflow values', async () => {
  const outstanding = new Map<string, () => void>();
  let active = 0,
    maximumActive = 0;
  const rows = Array.from({ length: 40 }, (_, index) => ({
    ...compactBridgeNativeOffset,
    txid: (index + 1).toString(16).padStart(64, '0'),
  }));
  mockEmitter.mockImplementation((_path: unknown, [txid]: [string]) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    return new Promise((resolve) =>
      outstanding.set(txid, () => {
        active -= 1;
        resolve({ ...fullBridge(), txid });
      })
    );
  });
  const view = render(
    <>
      {rows.map((tx) => (
        <UtxoTransactionsListComponent key={tx.txid} tx={tx} />
      ))}
    </>
  );
  try {
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('buttons.loading')).toHaveLength(40);
    expect(screen.queryByText('settings.unavailable')).toBeNull();
    for (let completed = 0; completed < rows.length; completed += 1) {
      await waitFor(() => expect(outstanding.size).toBeGreaterThan(0));
      await act(async () => {
        const [txid, finish] = outstanding.entries().next().value!;
        outstanding.delete(txid);
        finish();
        for (let step = 0; step < 12; step += 1) await Promise.resolve();
      });
    }
    await waitFor(() =>
      expect(screen.getAllByText('1.0000 SYSX')).toHaveLength(40)
    );
    expect(screen.queryByText('buttons.loading')).toBeNull();
    expect(screen.queryByText('settings.unavailable')).toBeNull();
    expect(mockEmitter).toHaveBeenCalledTimes(40);
    expect(new Set(mockEmitter.mock.calls.map(([, [txid]]) => txid)).size).toBe(
      40
    );
    expect(maximumActive).toBe(2);
  } finally {
    view.unmount();
    outstanding.forEach((finish) => finish());
    outstanding.clear();
    for (let step = 0; step < 100; step += 1) await Promise.resolve();
  }
});
