/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { SyscoinAssetDetails } from './SyscoinDetails';

let mockState: any;
const mockFetch = jest.fn();
const mockAlert = { info: jest.fn() };
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
);
beforeAll(() => {
  // JSDOM has no layout or native scrolling; viewport behavior is covered in e2e.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  });
});
afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView
    );
  } else {
    delete (HTMLElement.prototype as any).scrollIntoView;
  }
});
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
  chainId: 57,
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

it('preserves keyboard focus and the details pane when its pending market read finishes', async () => {
  let finish!: (response: any) => void;
  mockFetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = render(<SyscoinAssetDetails id={asset.assetGuid} />);
  const pane = view.container.querySelector(
    '[data-navigation-scroll="asset-details"]'
  );
  const close = screen.getByRole('button', { name: 'buttons.close' });
  close.focus();
  expect(document.activeElement).toBe(close);
  await act(async () => finish({ ok: true, json: async () => market(12) }));
  expect(screen.getByText('$12')).toBeTruthy();
  expect(document.activeElement).toBe(close);
  expect(
    view.container.querySelector('[data-navigation-scroll="asset-details"]')
  ).toBe(pane);
});

it('keeps the focused close action usable when the market read fails', async () => {
  let rejectRead!: (error: Error) => void;
  mockFetch.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectRead = reject;
      })
  );
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    render(<SyscoinAssetDetails id={asset.assetGuid} />);
    const close = screen.getByRole('button', { name: 'buttons.close' });
    close.focus();
    await act(async () =>
      rejectRead(new Error('Synthetic market read unavailable'))
    );
    expect(document.activeElement).toBe(close);
    expect(close.isConnected).toBe(true);
  } finally {
    error.mockRestore();
  }
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

describe('focused Close visibility after asynchronous market changes', () => {
  const observeScroll = () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    );
    const scroll = jest.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    return {
      scroll,
      restore: () => {
        if (descriptor) {
          Object.defineProperty(
            HTMLElement.prototype,
            'scrollIntoView',
            descriptor
          );
        } else {
          delete (HTMLElement.prototype as any).scrollIntoView;
        }
      },
    };
  };

  it('keeps an already-focused Close in view after the market response', async () => {
    let finish!: (response: any) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const witness = observeScroll();
    try {
      render(<SyscoinAssetDetails id={asset.assetGuid} />);
      const close = screen.getByRole('button', { name: 'buttons.close' });
      close.focus();
      witness.scroll.mockClear();
      await act(async () => finish({ ok: true, json: async () => market(12) }));
      expect(screen.getByText('$12')).toBeTruthy();
      expect(document.activeElement).toBe(close);
      expect(witness.scroll).toHaveBeenCalledWith({
        block: 'nearest',
        inline: 'nearest',
      });
      expect(
        witness.scroll.mock.instances.every(
          (instance) => instance === close.parentElement
        )
      ).toBe(true);
    } finally {
      witness.restore();
    }
  });

  it('does not move focus or request scrolling when a different control is focused', async () => {
    let finish!: (response: any) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const witness = observeScroll();
    const other = document.createElement('button');
    other.textContent = 'Unrelated action';
    document.body.appendChild(other);
    try {
      render(<SyscoinAssetDetails id={asset.assetGuid} />);
      other.focus();
      witness.scroll.mockClear();
      await act(async () => finish({ ok: true, json: async () => market(12) }));
      expect(document.activeElement).toBe(other);
      expect(witness.scroll).not.toHaveBeenCalled();
    } finally {
      other.remove();
      witness.restore();
    }
  });

  it('also preserves the focused action when the pending read fails', async () => {
    let rejectRead!: (error: Error) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRead = reject;
        })
    );
    const witness = observeScroll();
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      render(<SyscoinAssetDetails id={asset.assetGuid} />);
      const close = screen.getByRole('button', { name: 'buttons.close' });
      close.focus();
      witness.scroll.mockClear();
      await act(async () =>
        rejectRead(new TypeError('Synthetic market failure'))
      );
      expect(document.activeElement).toBe(close);
      expect(witness.scroll).toHaveBeenCalledWith({
        block: 'nearest',
        inline: 'nearest',
      });
      expect(
        witness.scroll.mock.instances.every(
          (instance) => instance === close.parentElement
        )
      ).toBe(true);
    } finally {
      log.mockRestore();
      witness.restore();
    }
  });

  it('ignores a stale response after the focused asset is left', async () => {
    let finish!: (response: any) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const witness = observeScroll();
    try {
      const view = render(<SyscoinAssetDetails id={asset.assetGuid} />);
      const close = screen.getByRole('button', { name: 'buttons.close' });
      close.focus();
      view.rerender(<SyscoinAssetDetails id="unknown-asset" />);
      expect(close.isConnected).toBe(false);
      witness.scroll.mockClear();
      await act(async () => finish({ ok: true, json: async () => market(12) }));
      expect(screen.queryByText('$12')).toBeNull();
      expect(witness.scroll).not.toHaveBeenCalled();
    } finally {
      witness.restore();
    }
  });
});
