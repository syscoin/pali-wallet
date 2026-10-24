/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { EvmAssetDetails } from './EvmDetails';

let mockState: any;
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home/details', state: null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: mockAlert,
    navigate: jest.fn(),
  }),
  useAdjustedExplorer: () => 'https://synthetic.example/',
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
  Icon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  formatCurrency: (value: string) => value,
  formatFullPrecisionBalance: (value: string) => value,
}));
jest.mock('utils/tokens', () => ({ getTokenTypeBadgeColor: () => '' }));
jest.mock('utils/navigationState', () => ({
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  navigateBack: jest.fn(),
}));

const tokens = ['11', '22'].map((byte) => ({
  id: `0x${byte.repeat(20)}-57057`,
  contractAddress: `0x${byte.repeat(20)}`,
  chainId: 57057,
  tokenSymbol: `TOKEN${byte}`,
  name: `Token ${byte}`,
  balance: 4,
  decimals: 18,
  tokenStandard: 'ERC-20',
}));
const pending = new Map<string, (value: any) => void>();
const market = (price: number) => ({
  // eslint-disable-next-line camelcase
  market_data: {
    // eslint-disable-next-line camelcase
    current_price: { usd: price },
    // eslint-disable-next-line camelcase
    price_change_percentage_24h: 0,
  },
});
const finish = async (index: number, price: number) => {
  expect(pending.has(tokens[index].contractAddress)).toBe(true);
  await act(async () =>
    pending.get(tokens[index].contractAddress)!(market(price))
  );
};
beforeEach(() => {
  jest.clearAllMocks();
  pending.clear();
  mockState = {
    vault: {
      activeNetwork: { chainId: 57057, explorer: 'https://synthetic.example/' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'33'.repeat(20)}` } } },
      accountAssets: { HDAccount: { 0: { ethereum: tokens } } },
    },
    price: { fiat: { asset: 'usd' } },
  };
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'getOnlyMarketData')
      return new Promise((resolve) => pending.set(args[0], resolve));
    throw new Error(`Unexpected ${method}`);
  });
});

it('loads the next asset after the previous asset already completed its market read', async () => {
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await finish(0, 111);
  expect(screen.getByText('$111')).toBeTruthy();
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  await finish(1, 222);
  expect(screen.queryByText('$111')).toBeNull();
  expect(screen.getByText('$222')).toBeTruthy();
});

it('preserves keyboard focus and the details pane when its pending market read finishes', async () => {
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  const pane = view.container.querySelector(
    '[data-navigation-scroll="asset-details"]'
  );
  const copy = screen.getByRole('button', { name: 'send.copyContractAddress' });
  copy.focus();
  expect(document.activeElement).toBe(copy);
  await finish(0, 111);
  expect(screen.getByText('$111')).toBeTruthy();
  expect(document.activeElement).toBe(copy);
  expect(
    view.container.querySelector('[data-navigation-scroll="asset-details"]')
  ).toBe(pane);
});

it('keeps the focused control usable when the market read fails', async () => {
  let rejectRead!: (error: Error) => void;
  mockEmitter.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectRead = reject;
      })
  );
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    render(<EvmAssetDetails id={tokens[0].id} />);
    const copy = screen.getByRole('button', {
      name: 'send.copyContractAddress',
    });
    copy.focus();
    await act(async () =>
      rejectRead(new Error('Synthetic market read unavailable'))
    );
    expect(document.activeElement).toBe(copy);
    expect(copy.isConnected).toBe(true);
  } finally {
    error.mockRestore();
  }
});

it('does not put an earlier asset market reply on a later asset', async () => {
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  await finish(1, 222);
  await finish(0, 111);
  expect(screen.queryByText('$111')).toBeNull();
  expect(screen.getByText('$222')).toBeTruthy();
});

it('keeps the price readable when optional 24-hour change data is absent', async () => {
  render(<EvmAssetDetails id={tokens[0].id} />);
  await act(async () =>
    pending.get(tokens[0].contractAddress)!({
      // eslint-disable-next-line camelcase
      market_data: { current_price: { usd: 55 } },
    })
  );
  expect(screen.getByText('$55')).toBeTruthy();
  expect(screen.queryByText(/\(24h\)/)).toBeNull();
});

it('copies the public contract from the keyboard and reports clipboard refusal without success', async () => {
  const user = userEvent.setup();
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new Error('denied'));
  render(<EvmAssetDetails id={tokens[0].id} />);
  const copy = screen.getByRole('button', { name: 'send.copyContractAddress' });
  copy.focus();
  await user.keyboard('{Enter}');
  expect(write).toHaveBeenCalledWith(tokens[0].contractAddress);
  expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockAlert.info).not.toHaveBeenCalled();
  write.mockRestore();
});

it('does not announce a delayed contract copy after navigating to another asset', async () => {
  const user = userEvent.setup();
  let finishCopy!: () => void;
  const write = jest.spyOn(navigator.clipboard, 'writeText').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishCopy = resolve;
      })
  );
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await user.click(
    screen.getByRole('button', { name: 'send.copyContractAddress' })
  );
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  await act(async () => finishCopy());
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  write.mockRestore();
});

it.each(['market_cap', 'total_volume', 'circulating_supply'])(
  'keeps the details usable when optional %s is null',
  async (field) => {
    const data: any = market(55);
    data.market_data[field] =
      field === 'circulating_supply' ? null : { usd: null };
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      render(<EvmAssetDetails id={tokens[0].id} />);
      await act(async () => pending.get(tokens[0].contractAddress)!(data));
      expect(screen.getByText('$55')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'send.copyContractAddress' })
      ).toBeTruthy();
    } finally {
      error.mockRestore();
    }
  }
);

it('does not present an unavailable rank as an empty rank', async () => {
  const data: any = market(55);
  data['market_cap_rank'] = null;
  render(<EvmAssetDetails id={tokens[0].id} />);
  await act(async () => pending.get(tokens[0].contractAddress)!(data));
  expect(screen.getByText('$55')).toBeTruthy();
  expect(screen.queryByText('tokens.rank')).toBeNull();
});

it('displays a reported zero price instead of hiding available market data', async () => {
  render(<EvmAssetDetails id={tokens[0].id} />);
  await finish(0, 0);
  expect(screen.getByText('tokens.currentPrice')).toBeTruthy();
  expect(screen.getByText('$0')).toBeTruthy();
});

it.each([undefined, null, NaN, Infinity])(
  'omits unavailable optional market values without hiding the price (%s)',
  async (value) => {
    const data: any = market(55);
    data['market_cap_rank'] = value;
    data.market_data['market_cap'] = { usd: value };
    data.market_data['total_volume'] = { usd: value };
    data.market_data['circulating_supply'] = value;
    render(<EvmAssetDetails id={tokens[0].id} />);
    await act(async () => pending.get(tokens[0].contractAddress)!(data));
    expect(screen.getByText('$55')).toBeTruthy();
    for (const label of ['rank', 'marketCap', 'volume24h', 'circulatingSupply'])
      expect(screen.queryByText(`tokens.${label}`)).toBeNull();
  }
);

it('preserves reported zero market cap, volume and circulating supply', async () => {
  const data: any = market(55);
  data.market_data['market_cap'] = { usd: 0 };
  data.market_data['total_volume'] = { usd: 0 };
  data.market_data['circulating_supply'] = 0;
  render(<EvmAssetDetails id={tokens[0].id} />);
  await act(async () => pending.get(tokens[0].contractAddress)!(data));
  expect(screen.getByText('$55')).toBeTruthy();
  expect(screen.getAllByText('$0')).toHaveLength(2);
  expect(screen.getByText('0')).toBeTruthy();
  for (const label of ['marketCap', 'volume24h', 'circulatingSupply'])
    expect(screen.getByText(`tokens.${label}`)).toBeTruthy();
});

it.each([
  ['both metrics', 123456789012, 123456789012345],
  ['volume only', 123456789012, null],
  ['supply only', null, 123456789012345],
  ['neither metric', null, null],
])(
  'retains full numeric text and optional-field behavior with %s',
  async (_label, volume, supply) => {
    const data: any = market(55);
    data.market_data['total_volume'] = { usd: volume };
    data.market_data['circulating_supply'] = supply;
    render(<EvmAssetDetails id={tokens[0].id} />);
    await act(async () => pending.get(tokens[0].contractAddress)!(data));

    expect(screen.getByText('$55')).toBeTruthy();
    const volumeLabel = screen.queryByText('tokens.volume24h');
    const supplyLabel = screen.queryByText('tokens.circulatingSupply');
    expect(Boolean(volumeLabel)).toBe(volume !== null);
    expect(Boolean(supplyLabel)).toBe(supply !== null);
    if (volume !== null) expect(screen.getByText(`$${volume}`)).toBeTruthy();
    if (supply !== null) expect(screen.getByText(String(supply))).toBeTruthy();

    for (const label of [volumeLabel, supplyLabel].filter(Boolean)) {
      const cell = label!.parentElement!;
      const row = cell.parentElement!;
      // These are source contracts only; the fenced browser regression proves
      // actual glyph clipping, whole-field reflow and healthy rendered layouts.
      expect(row.classList.contains('flex-wrap')).toBe(true);
      expect(row.classList.contains('min-[400px]:grid')).toBe(true);
      expect(row.classList.contains('min-[400px]:grid-cols-2')).toBe(true);
      expect(cell.classList.contains('flex-1')).toBe(true);
      expect(cell.classList.contains('max-w-full')).toBe(true);
      expect(cell.lastElementChild!.classList.contains('break-words')).toBe(
        true
      );
    }
    expect(
      screen.getByRole('button', { name: 'send.copyContractAddress' })
    ).toBeTruthy();
  }
);

it.each(['BALS', 'B'.repeat(32), 'C'.repeat(64)])(
  'keeps the complete Balance text in a shrinkable, wrapping row for symbol %s',
  (symbol) => {
    mockState.vault.accountAssets.HDAccount[0].ethereum = [
      { ...tokens[0], tokenSymbol: symbol, balance: 12 },
      tokens[1],
    ];
    render(<EvmAssetDetails id={tokens[0].id} />);
    const label = screen.getByText('send.balance');
    const row = label.parentElement!;
    const value = row.querySelectorAll(':scope > p')[1];
    const text = value.querySelector('span')!;
    // Native DOM tests protect the local layout contract, not actual glyph
    // painting. The fenced production browser journey verifies both widths.
    expect(value.textContent).toBe('12 ' + symbol);
    expect(row.classList.contains('gap-x-3')).toBe(true);
    expect(label.classList.contains('flex-shrink-0')).toBe(true);
    expect(value.classList.contains('min-w-0')).toBe(true);
    expect(value.classList.contains('text-right')).toBe(true);
    expect(text.classList.contains('min-w-0')).toBe(true);
    expect(text.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
    expect(text.getAttribute('title')).toBeNull();
    const copy = screen.getByRole('button', {
      name: 'send.copyContractAddress',
    });
    expect(copy.classList.contains('h-11')).toBe(true);
    expect(copy.classList.contains('w-11')).toBe(true);
  }
);
