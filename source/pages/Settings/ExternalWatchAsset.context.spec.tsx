/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ExternalWatchAsset from './ExternalWatchAsset';

let mockScope: string;
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
  mockScope = 'first-account-and-network';
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

it.each(['account', 'network'])(
  'discards the previous token approval after a completed %s change',
  async (change) => {
    const view = await loadPreview();
    const oldAdd = mockAdd;
    mockScope = `changed-${change}`;
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
  mockScope = 'changed-without-a-render';
  await act(async () => mockAdd());
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'handleWatchAsset')
  ).toBe(false);
});

it('does not display delayed metadata fetched before an account/network change', async () => {
  let finish!: (value: unknown) => void;
  mockEmitter.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const view = render(<ExternalWatchAsset />);
  mockScope = 'changed-while-loading';
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
    [preview]
  );
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(mockDispatch).toHaveBeenCalledWith(
    'wallet_watchAsset.synthetic.test',
    true
  );
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
  'does not complete a stale Add after %s',
  async (departure) => {
    const view = await loadPreview();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.addToken' }));
    await act(async () => undefined);
    if (departure === 'unmount') view.unmount();
    else mockScope = 'changed-after-save';
    await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  }
);
