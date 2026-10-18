/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ExternalWatchAsset from './ExternalWatchAsset';

let mockScope: { account: string; network: string };
let mockNetwork: any;
let mockStatus: any;
let mockAdd: () => void;
const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
const mockRequest = {
  host: 'synthetic.test',
  eventName: 'wallet_watchAsset',
  asset: { type: 'ERC20', options: { address: `0x${'11'.repeat(20)}` } },
};
const preview = {
  contractAddress: mockRequest.asset.options.address,
  chainId: 1,
  decimals: 6,
  symbol: 'FIRST',
  name: 'First-chain token',
  balance: 12,
};
const mockTranslate = (key: string) => key;

jest.mock('hooks/index', () => ({
  useQueryData: () => mockRequest,
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      price: { fiat: { asset: 'usd' } },
      vault: { activeNetwork: mockNetwork },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: (url: string) => url,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('components/index', () => ({
  LoadingComponent: () => <div role="status">Loading token</div>,
  Button: ({ children, disabled, loading, onClick, type }: any) => {
    if (children === 'buttons.addToken') mockAdd = onClick;
    return (
      <button disabled={disabled || loading} onClick={onClick} type={type}>
        {children}
      </button>
    );
  },
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (...args: any[]) => mockDispatch(...args),
}));
jest.mock('utils/index', () => ({ formatCurrency: (value: string) => value }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockScope = { account: 'first-account', network: 'first-network' };
  mockNetwork = { chainId: 1, explorer: 'https://first.invalid/' };
  mockStatus = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getAssetInfo') return preview;
    if (method === 'handleWatchAsset') return true;
    throw new Error(`Unexpected method ${method}`);
  });
  jest.spyOn(window, 'close').mockImplementation();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const loadPreview = async () => {
  const view = render(<ExternalWatchAsset />);
  await act(async () => undefined);
  expect(screen.getByText(preview.name)).toBeVisible();
  return view;
};

const loadMarketPreview = async (change?: number | null) => {
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getAssetInfo')
      return {
        ...preview,
        // eslint-disable-next-line camelcase
        market_data: {
          // eslint-disable-next-line camelcase
          current_price: { usd: 55 },
          ...(change === undefined
            ? {}
            : // eslint-disable-next-line camelcase
              { price_change_percentage_24h: change }),
        },
      };
    if (method === 'handleWatchAsset') return true;
    throw new Error(`Unexpected method ${method}`);
  });
  return loadPreview();
};

it.each([undefined, null, NaN, Infinity, -Infinity])(
  'keeps token approval usable when the price exists with unavailable 24-hour change %s',
  async (change) => {
    await loadMarketPreview(change);
    expect(screen.getByText('$55')).toBeVisible();
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'buttons.addToken' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'buttons.cancel' })
    ).toBeEnabled();
  }
);

it.each([
  [0, '+0.00%'],
  [1.235, '+1.24%'],
  [-1.235, '-1.24%'],
])(
  'preserves the finite 24-hour change %s as %s',
  async (change, formatted) => {
    await loadMarketPreview(change as number);
    expect(screen.getByText('$55')).toBeVisible();
    expect(screen.getByText(formatted as string)).toBeVisible();
  }
);

it('allows ordinary Add from a price-only token review', async () => {
  await loadMarketPreview();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.addToken' }));
  await act(async () => undefined);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'handleWatchAsset'],
    [expect.objectContaining({ ...preview }), mockScope]
  );
  expect(mockDispatch).toHaveBeenCalledWith(
    'wallet_watchAsset.synthetic.test',
    true
  );
  expect(window.close).toHaveBeenCalledTimes(1);
});

it('allows ordinary Cancel from a price-only token review without adding the token', async () => {
  await loadMarketPreview();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'handleWatchAsset')
  ).toBe(false);
  expect(mockDispatch).not.toHaveBeenCalled();
});

it.each(['account', 'network'])(
  'discards the previous token approval after a completed %s change',
  async (change) => {
    const view = await loadPreview();
    const oldAdd = mockAdd;
    mockScope = { ...mockScope, [change]: `changed-${change}` };
    if (change === 'network')
      mockNetwork = { chainId: 2, explorer: 'https://second.invalid/' };
    view.rerender(<ExternalWatchAsset />);
    expect(screen.queryByText(preview.name)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'buttons.addToken' })
    ).toBeNull();
    expect(
      screen.getByText('transactions.psbtSigningContextChanged')
    ).toBeVisible();
    await act(async () => oldAdd());
    expect(
      mockEmitter.mock.calls.some(
        ([[, method]]) => method === 'handleWatchAsset'
      )
    ).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

it('rejects a retained Add handler if the live scope changes before rerender', async () => {
  await loadPreview();
  mockScope = { ...mockScope, account: 'changed-without-a-render' };
  await act(async () => mockAdd());
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'handleWatchAsset')
  ).toBe(false);
});

it('does not display delayed metadata fetched before an account/network change', async () => {
  let finish!: (value: unknown) => void;
  mockEmitter.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const view = render(<ExternalWatchAsset />);
  mockScope = { ...mockScope, account: 'changed-while-loading' };
  view.rerender(<ExternalWatchAsset />);
  await act(async () => finish(preview));
  expect(screen.queryByText(preview.name)).toBeNull();
  expect(screen.queryByRole('button', { name: 'buttons.addToken' })).toBeNull();
});

it('does not add a token while the controller is unavailable or locked', async () => {
  await loadPreview();
  mockStatus.connectionUnavailable = true;
  await act(async () => mockAdd());
  mockStatus.connectionUnavailable = false;
  mockStatus.isUnlocked = false;
  await act(async () => mockAdd());
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'handleWatchAsset')
  ).toBe(false);
});

it('preserves ordinary Add completion for the reviewed account and network', async () => {
  await loadPreview();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.addToken' }));
  await act(async () => undefined);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'handleWatchAsset'],
    [preview, mockScope]
  );
  expect(mockDispatch).toHaveBeenCalledWith(
    'wallet_watchAsset.synthetic.test',
    true
  );
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
});

it('reports an already successful Add even if the controller becomes unavailable afterward', async () => {
  await loadPreview();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.addToken' }));
  await act(async () => undefined);
  mockStatus.connectionUnavailable = true;
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(mockDispatch).toHaveBeenCalledWith(
    'wallet_watchAsset.synthetic.test',
    true
  );
  expect(window.close).toHaveBeenCalledTimes(1);
});

it.each(['scope change', 'unmount'])(
  'settles an already committed Add without stale feedback after %s during persistence',
  async (departure) => {
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => (finish = resolve));
    const view = await loadPreview();
    mockEmitter.mockReturnValueOnce(saved);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.addToken' }));
    expect(mockDispatch).not.toHaveBeenCalled();
    if (departure === 'unmount') view.unmount();
    else {
      mockScope = { ...mockScope, network: 'changed-during-persistence' };
      view.rerender(<ExternalWatchAsset />);
    }
    await act(async () => finish());
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      'wallet_watchAsset.synthetic.test',
      true
    );
    expect(mockAlert.info).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledTimes(departure === 'unmount' ? 0 : 1);
  }
);

it('submits and settles only once for retained Add callbacks', async () => {
  let finish!: () => void;
  const saved = new Promise<void>((resolve) => (finish = resolve));
  await loadPreview();
  mockEmitter.mockReturnValueOnce(saved);
  const oldAdd = mockAdd;
  await act(async () => {
    oldAdd();
    oldAdd();
  });
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'handleWatchAsset'
    )
  ).toHaveLength(1);
  await act(async () => finish());
  await act(async () => oldAdd());
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'handleWatchAsset'
    )
  ).toHaveLength(1);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
});

it('does not report acceptance when the controller rejects stale-context admission', async () => {
  let reject!: (error: Error) => void;
  const rejected = new Promise((_, fail) => (reject = fail));
  const view = await loadPreview();
  mockEmitter.mockReturnValueOnce(rejected);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.addToken' }));
  mockScope = { ...mockScope, account: 'changed-before-controller-entry' };
  view.rerender(<ExternalWatchAsset />);
  await act(async () => reject(new Error('Wallet context changed')));
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
});
