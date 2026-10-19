/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AddToken } from './AddToken';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { symbol?: string }) =>
      key === 'tokens.importNamedToken'
        ? `Import ${values?.symbol} token`
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('utils/index', () => ({
  truncate: (value: unknown) => String(value),
  ellipsis: (value: unknown) => String(value),
  formatFullPrecisionBalance:
    jest.requireActual('utils/format').formatFullPrecisionBalance,
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'account', network: 'network' }),
  getCurrentTab: (params: URLSearchParams, _state: unknown, fallback: string) =>
    params.get('tab') || fallback,
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));

const A = `0x${'33'.repeat(20)}`;
const B = `0x${'44'.repeat(20)}`;
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
};
const details = (contractAddress: string, symbol: string) => ({
  contractAddress,
  symbol,
  name: symbol,
  chainId: 1,
  tokenStandard: 'ERC-20',
  isNft: false,
  decimals: 18,
  balance: 3,
  image: 'https://assets.invalid/logo.png',
});
let a: ReturnType<typeof deferred>;
let b: ReturnType<typeof deferred>;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  a = deferred();
  b = deferred();
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'11'.repeat(20)}` } } },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        url: 'https://rpc.invalid',
        apiUrl: 'https://explorer.invalid/api',
      },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
    },
  };
  mockEmitter.mockReset().mockImplementation(([, method], args) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve([]);
    if (method === 'getTokenDetailsWithMarketData')
      return args[0] === A ? a.promise : b.promise;
    if (method === 'saveTokenInfo') return Promise.resolve();
    throw new Error(`Unexpected ${method}`);
  });
});
afterEach(() => jest.useRealTimers());
const input = () => screen.getByLabelText('settings.contractAddress');
const edit = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const startA = async () => {
  const view = render(
    <MemoryRouter initialEntries={['/tokens/add?tab=custom']}>
      <AddToken />
    </MemoryRouter>
  );
  edit(A);
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getTokenDetailsWithMarketData'],
    [A, mockState.vault.accounts.HDAccount[0].address]
  );
  return view;
};
const finishAndImportB = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
    b.resolve(details(B, 'CURRENT'));
  });
  expect(screen.queryByRole('button', { name: 'Import OLD token' })).toBeNull();
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Import CURRENT token' })
    );
  });
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'saveTokenInfo'],
    [expect.objectContaining({ contractAddress: B }), expect.any(Object)]
  );
};

it('keeps an old response nonactionable after a real deferred input update', async () => {
  await startA();
  edit(B);
  await act(async () => {
    a.resolve(details(A, 'OLD'));
  });
  expect(input()).toHaveValue(B);
  expect(screen.queryByRole('button', { name: 'Import OLD token' })).toBeNull();
  await finishAndImportB();
});

it('does not expose an old result when input and settlement share an event turn', async () => {
  await startA();
  await act(async () => {
    edit(B);
    a.resolve(details(A, 'OLD'));
    await Promise.resolve();
  });
  expect(input()).toHaveValue(B);
  const stale = screen.queryByRole('button', { name: 'Import OLD token' });
  if (stale)
    await act(async () => {
      fireEvent.click(stale);
    });
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method], args]) =>
        method === 'saveTokenInfo' && args[0].contractAddress === A
    )
  ).toHaveLength(0);
  await finishAndImportB();
});

it('keeps an adjacent native input event and RPC settlement bound to the current contract', async () => {
  await startA();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(input(), B);
  input().dispatchEvent(new Event('input', { bubbles: true }));
  a.resolve(details(A, 'OLD'));
  await act(async () => {
    await Promise.resolve();
  });
  expect(input()).toHaveValue(B);
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getTokenDetailsWithMarketData'],
    [B, mockState.vault.accounts.HDAccount[0].address]
  );
  // B is now an actual in-flight validation, not just a raw DOM value.
  // A's enabled action must not survive while B is being reviewed.
  const stale = screen.queryByRole('button', { name: 'Import OLD token' });
  if (stale)
    await act(async () => {
      fireEvent.click(stale);
    });
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method], args]) =>
        method === 'saveTokenInfo' && args[0].contractAddress === A
    )
  ).toHaveLength(0);
  await finishAndImportB();
});

it('retains a usable current contract after the older request rejects late', async () => {
  await startA();
  edit(B);
  await finishAndImportB();
  await act(async () => {
    a.reject(new Error('old validation refused'));
  });
  expect(screen.queryByRole('button', { name: 'Import OLD token' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Import CURRENT token' })
  ).toBeDisabled();
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.some(
      ([[, method]]) =>
        method === 'validateNftContract' || method === 'validateERC20Only'
    )
  ).toBe(false);
});

it.each(['account', 'same-chain RPC'])(
  'does not restore old validation after an actual AddToken %s remount',
  async (change) => {
    const view = await startA();
    if (change === 'account')
      mockState.vault.accounts.HDAccount[0].address = `0x${'22'.repeat(20)}`;
    else mockState.vault.activeNetwork.url = 'https://other-rpc.invalid';
    view.rerender(
      <MemoryRouter initialEntries={['/tokens/add?tab=custom']}>
        <AddToken />
      </MemoryRouter>
    );
    expect(input()).toHaveValue('');
    await act(async () => {
      a.resolve(details(A, 'OLD'));
    });
    expect(
      screen.queryByRole('button', { name: 'Import OLD token' })
    ).toBeNull();
    edit(B);
    await finishAndImportB();
  }
);

it('rechecks the current custom contract after an awaited logo request before import', async () => {
  await startA();
  await act(async () => {
    a.resolve({ ...details(A, 'OLD'), image: undefined });
  });
  const logo = deferred();
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'getOnlyMarketData' ? logo.promise : original(path, args)
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Import OLD token' }));
  });
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getOnlyMarketData'],
    [A]
  );
  edit(B);
  await act(async () => {
    logo.resolve({ image: 'https://assets.invalid/old.png' });
  });
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'saveTokenInfo')
  ).toBe(false);
  await finishAndImportB();
});

it('restarts validation after native A to B to A edits before deferred work settles', async () => {
  await startA();
  const freshA = deferred();
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'getTokenDetailsWithMarketData' && args[0] === A
      ? freshA.promise
      : original(path, args)
  );
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  await act(async () => {
    setter.call(input(), B);
    input().dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input(), A);
    input().dispatchEvent(new Event('input', { bubbles: true }));
    a.resolve(details(A, 'STALE'));
    await Promise.resolve();
  });
  expect(input()).toHaveValue(A);
  expect(
    screen.queryByRole('button', { name: 'Import STALE token' })
  ).toBeNull();
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method], args]) =>
        method === 'getTokenDetailsWithMarketData' && args[0] === A
    )
  ).toHaveLength(2);
  await act(async () => {
    freshA.resolve(details(A, 'CURRENT'));
  });
  expect(
    screen.getByRole('button', { name: 'Import CURRENT token' })
  ).toBeEnabled();
});

it('does not expose an old result after native input is shortened to an invalid address', async () => {
  await startA();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(input(), '0x12');
  input().dispatchEvent(new Event('input', { bubbles: true }));
  a.resolve(details(A, 'OLD'));
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(input()).toHaveValue('0x12');
  expect(screen.queryByRole('button', { name: 'Import OLD token' })).toBeNull();
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'saveTokenInfo')
  ).toBe(false);
});
