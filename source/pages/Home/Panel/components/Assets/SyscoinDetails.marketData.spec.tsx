/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { SyscoinAssetDetails } from './SyscoinDetails';

let mockState: any;
const mockFetch = jest.fn();
const mockAlert = { info: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home/details', state: null }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: mockAlert,
    navigate: jest.fn(),
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  FiCopy: () => null,
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/tokens'),
  formatCurrency: (value: string) => value,
  truncate: (value: string) => value,
  camelCaseToText: (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1),
  syscoinKeysOfInterest: ['symbol', 'decimals', 'balance'],
  adjustUrl: (value: string) => value,
}));
jest.mock('utils/retryableFetch', () => ({
  retryableFetch: (...args: any[]) => mockFetch(...args),
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));

const asset = {
  assetGuid: '123456',
  symbol: 'SYSX',
  decimals: 8,
  balance: 1,
  totalSent: 0,
  totalReceived: 1,
};
const market = (price: number) => ({
  // eslint-disable-next-line camelcase
  market_data: {
    // eslint-disable-next-line camelcase
    current_price: { usd: price },
    // eslint-disable-next-line camelcase
    price_change_percentage_24h: 0,
  },
});
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: {
        chainId: 57,
        label: 'Syscoin',
        url: 'https://synthetic.example/',
      },
      accountAssets: { HDAccount: { 0: { syscoin: [asset] } } },
    },
    price: { fiat: { asset: 'usd' } },
  };
  mockFetch.mockReset();
});

it('settles a failed market read without starting an unbounded request loop', async () => {
  // Hold a second call pending to make the old retry loop deterministic and bounded.
  mockFetch
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockImplementation(() => new Promise(() => undefined));
  const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = render(<SyscoinAssetDetails id={asset.assetGuid} />);
    await act(async () => undefined);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('.animate-spin')).toBeNull();
    view.rerender(<SyscoinAssetDetails id={asset.assetGuid} />);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

it('loads known-asset prices and permits a fresh attempt after leaving the asset', async () => {
  mockFetch
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValue({ ok: true, json: async () => market(12) });
  const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = render(<SyscoinAssetDetails id={asset.assetGuid} />);
    await act(async () => undefined);
    view.rerender(<SyscoinAssetDetails id="999999" />);
    view.rerender(<SyscoinAssetDetails id={asset.assetGuid} />);
    await act(async () => undefined);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText('$12')).toBeTruthy();
  } finally {
    warn.mockRestore();
  }
});

it('ignores the first visit response after leaving and returning to the same asset', async () => {
  const replies: ((value: any) => void)[] = [];
  mockFetch.mockImplementation(
    () => new Promise((resolve) => replies.push(resolve))
  );
  const view = render(<SyscoinAssetDetails id={asset.assetGuid} />);
  view.rerender(<SyscoinAssetDetails id="999999" />);
  view.rerender(<SyscoinAssetDetails id={asset.assetGuid} />);
  expect(replies).toHaveLength(2);
  await act(async () => replies[1]({ ok: true, json: async () => market(22) }));
  expect(screen.getByText('$22')).toBeTruthy();
  await act(async () => replies[0]({ ok: true, json: async () => market(11) }));
  expect(screen.queryByText('$11')).toBeNull();
  expect(screen.getByText('$22')).toBeTruthy();
});

it('does not fetch market data for an unknown asset or ordinary balance refresh', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => market(12) });
  const view = render(<SyscoinAssetDetails id="999999" />);
  expect(mockFetch).not.toHaveBeenCalled();
  view.rerender(<SyscoinAssetDetails id={asset.assetGuid} />);
  await act(async () => undefined);
  mockState.vault.accountAssets.HDAccount[0].syscoin = [
    { ...asset, balance: 2 },
  ];
  view.rerender(<SyscoinAssetDetails id={asset.assetGuid} />);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText('$12')).toBeTruthy();
});

it.each([undefined, null, NaN, Infinity])(
  'keeps a valid price readable with unavailable daily change %s',
  async (change) => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        // eslint-disable-next-line camelcase
        market_data: {
          // eslint-disable-next-line camelcase
          current_price: { usd: 55 },
          // eslint-disable-next-line camelcase
          price_change_percentage_24h: change,
        },
      }),
    });
    const warn = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      render(<SyscoinAssetDetails id={asset.assetGuid} />);
      await act(async () => undefined);
      expect(screen.getByText('$55')).toBeTruthy();
      expect(screen.queryByText(/\(24h\)/)).toBeNull();
    } finally {
      warn.mockRestore();
    }
  }
);

it.each([
  [0, '+0.00% (24h)'],
  [2.34, '+2.34% (24h)'],
  [-2.34, '-2.34% (24h)'],
])('retains the finite daily change %s', async (change, display) => {
  const data = market(55);
  // eslint-disable-next-line camelcase
  data.market_data.price_change_percentage_24h = change as number;
  mockFetch.mockResolvedValue({ ok: true, json: async () => data });
  render(<SyscoinAssetDetails id={asset.assetGuid} />);
  await act(async () => undefined);
  expect(screen.getByText(display as string)).toBeTruthy();
});
