/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastContainer, toast } from 'react-toastify';

import { AddToken } from './AddToken';

const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
const mockTranslate = (
  key: string,
  values?: { symbol?: string; token?: string }
) => {
  if (key === 'tokens.importNamedToken')
    return `Import ${values?.symbol} token`;
  if (key === 'tokens.hasBeenAddedToYourWallet')
    return `${values?.token} has been added to your wallet`;
  return key;
};
let mockState: any;
let mockClock = 0;
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en' } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => mockNavigate,
}));
jest.mock('hooks/index', () => ({
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
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
  getCurrentTab: (params: URLSearchParams, _state: unknown, fallback: string) =>
    params.get('tab') || fallback,
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  truncate: (value: unknown) => String(value),
  ellipsis: (value: unknown) => String(value),
  formatFullPrecisionBalance:
    jest.requireActual('utils/format').formatFullPrecisionBalance,
}));

const fixtureToken = {
  assetGuid: '123457',
  symbol: 'FIRSTSPT',
  balance: '2',
  decimals: 8,
};
const tree = () => (
  <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
    <Link to="/home">Home</Link>
    <Routes>
      <Route path="/tokens/add" element={<AddToken />} />
      <Route path="/home" element={<p>Wallet home</p>} />
    </Routes>
    <ToastContainer />
  </MemoryRouter>
);
beforeEach(() => {
  jest.useFakeTimers();
  mockClock += 10_000;
  jest.setSystemTime(mockClock);
  jest.clearAllMocks();
  mockState = {
    vault: {
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: { address: 'public-account-a', xpub: 'public-xpub-a' },
          1: { address: 'public-account-b', xpub: 'public-xpub-b' },
        },
      },
      activeNetwork: {
        chainId: 5700,
        url: 'https://synthetic-blockbook.invalid',
      },
      accountAssets: {},
    },
  };
  mockEmitter.mockReset().mockImplementation(([, method], args) => {
    if (method === 'getUserOwnedTokens')
      return Promise.resolve(
        args[0] === 'public-account-a' ? [fixtureToken] : []
      );
    if (method === 'saveTokenInfo') return Promise.resolve(true);
    throw new Error(`Unexpected ${method}`);
  });
});
afterEach(() => {
  toast.dismiss();
  jest.useRealTimers();
});

it('does not announce an old SPT import after the actual keyed parent switches accounts', async () => {
  let finishSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const view = render(tree());
  await act(async () => undefined);
  const importButton = screen.getByRole('button', {
    name: 'Import FIRSTSPT token',
  });
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'saveTokenInfo') return pendingSave;
    if (method === 'getUserOwnedTokens')
      return Promise.resolve(
        args[0] === 'public-account-a' ? [fixtureToken] : []
      );
    throw new Error(`Unexpected ${method}`);
  });
  fireEvent.click(importButton);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'saveTokenInfo'],
    [
      expect.objectContaining({
        assetGuid: fixtureToken.assetGuid,
        chainId: 5700,
      }),
      expect.objectContaining({
        account: expect.any(String),
        network: expect.any(String),
      }),
    ]
  );
  mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
  view.rerender(tree());
  await act(async () => undefined);
  expect(
    screen.queryByRole('button', { name: 'Import FIRSTSPT token' })
  ).toBeNull();
  expect(screen.getByText('tokens.noTokensFound')).toBeTruthy();
  await act(async () => {
    finishSave();
  });
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(
    screen.queryByText('FIRSTSPT has been added to your wallet')
  ).toBeNull();
});

it('announces and disables the successfully imported SPT while the same view remains current', async () => {
  render(tree());
  await act(async () => undefined);
  const importButton = screen.getByRole('button', {
    name: 'Import FIRSTSPT token',
  });
  await act(async () => fireEvent.click(importButton));
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(
    screen.getByText('FIRSTSPT has been added to your wallet')
  ).toBeTruthy();
  expect((importButton as HTMLButtonElement).disabled).toBe(true);
});

it.each(['account', 'network', 'home'])(
  'does not announce an old SPT import after leaving via %s',
  async (departure) => {
    let finishSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const view = render(tree());
    await act(async () => undefined);
    mockEmitter.mockImplementation(([, method]) =>
      method === 'saveTokenInfo' ? pendingSave : Promise.resolve([])
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Import FIRSTSPT token' })
    );
    if (departure === 'account')
      mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
    else if (departure === 'network')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: 'https://replacement-blockbook.invalid',
      };
    if (departure === 'home')
      fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    else view.rerender(tree());
    await act(async () => undefined);
    expect(
      screen.queryByRole('button', { name: 'Import FIRSTSPT token' })
    ).toBeNull();
    await act(async () => finishSave());
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(
      screen.queryByText('FIRSTSPT has been added to your wallet')
    ).toBeNull();
    expect(
      mockEmitter.mock.calls.filter(
        ([[, method]]) => method === 'saveTokenInfo'
      )
    ).toHaveLength(1);
  }
);

it.each(['account', 'network', 'home'])(
  'does not show an old SPT persistence failure after leaving via %s',
  async (departure) => {
    let rejectSave!: (error: Error) => void;
    const pendingSave = new Promise<void>((_, reject) => {
      rejectSave = reject;
    });
    const view = render(tree());
    await act(async () => undefined);
    mockEmitter.mockImplementation(([, method]) =>
      method === 'saveTokenInfo' ? pendingSave : Promise.resolve([])
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Import FIRSTSPT token' })
    );
    if (departure === 'account')
      mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
    else if (departure === 'network')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: 'https://replacement-blockbook.invalid',
      };
    if (departure === 'home')
      fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    else view.rerender(tree());
    await act(async () => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await act(async () =>
        rejectSave(new Error('Previous import persistence failed'))
      );
      await act(async () => jest.advanceTimersByTimeAsync(0));
      expect(
        screen.queryByText('Previous import persistence failed')
      ).toBeNull();
      expect(
        screen.queryByText('FIRSTSPT has been added to your wallet')
      ).toBeNull();
    } finally {
      error.mockRestore();
    }
  }
);

it('reports a current persistence failure and permits retrying the same SPT', async () => {
  render(tree());
  await act(async () => undefined);
  let saves = 0;
  mockEmitter.mockImplementation(([, method]) => {
    if (method === 'saveTokenInfo' && ++saves === 1)
      return Promise.reject(new Error('Current import persistence failed'));
    return Promise.resolve(true);
  });
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    const importButton = screen.getByRole('button', {
      name: 'Import FIRSTSPT token',
    });
    await act(async () => fireEvent.click(importButton));
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Current import persistence failed')).toBeTruthy();
    expect((importButton as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(importButton));
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(
      screen.getByText('FIRSTSPT has been added to your wallet')
    ).toBeTruthy();
    expect((importButton as HTMLButtonElement).disabled).toBe(true);
    expect(saves).toBe(2);
  } finally {
    error.mockRestore();
  }
});
