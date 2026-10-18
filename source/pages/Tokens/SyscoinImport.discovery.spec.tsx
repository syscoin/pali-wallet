/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AddToken } from './AddToken';

const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockState = {
  vault: {
    isBitcoinBased: true,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {
        0: { address: 'public-fixture-address', xpub: 'public-fixture-xpub' },
      },
    },
    activeNetwork: { chainId: 5700, url: 'https://blockbook.invalid' },
    accountAssets: {},
  },
};
const originalNetworkUrl = mockState.vault.activeNetwork.url;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
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
  formatFullPrecisionBalance: (value: unknown) => String(value),
}));
jest.mock('utils/tokens', () => ({
  getTokenLogo: () => '',
  getTokenTypeBadgeColor: () => '',
}));

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
      <AddToken />
    </MemoryRouter>
  );
beforeEach(() => {
  jest.clearAllMocks();
  mockState.vault.activeNetwork.url = originalNetworkUrl;
  mockEmitter.mockReset().mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

it('shows a legitimate empty SPT discovery result without a failure diagnostic', async () => {
  mount();
  await screen.findByText('tokens.noTokensFound');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getUserOwnedTokens'],
    ['public-fixture-address']
  );
});

it('reports failed SPT discovery instead of claiming there are no tokens', async () => {
  mockEmitter.mockRejectedValueOnce(
    new Error('Synthetic Blockbook unavailable')
  );
  mount();
  await act(async () => undefined);
  expect(screen.queryByText('tokens.noTokensFound')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain(
    'settings.apiConnectionError'
  );
  const retry = screen.getByRole('button', { name: 'receive.retry' });
  expect(retry.getAttribute('type')).toBe('button');
  expect(retry.className).toContain('min-h-11');
});

it('retries failed discovery only on request and recovers the real owned-token list', async () => {
  jest.useFakeTimers();
  mockEmitter.mockRejectedValueOnce(
    new Error('Synthetic Blockbook unavailable')
  );
  mockEmitter.mockResolvedValueOnce([
    { assetGuid: '123', symbol: 'DISCOVERED', balance: '2', decimals: 8 },
  ]);
  mount();
  await act(async () => jest.advanceTimersByTimeAsync(60_000));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  const retry = screen.getByRole('button', { name: 'receive.retry' });
  await act(async () => fireEvent.click(retry));
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('DISCOVERED')).toBeDefined();
  expect(screen.queryByText('tokens.noTokensFound')).toBeNull();
});

it('accepts a successful empty retry without retaining the error state', async () => {
  mockEmitter.mockRejectedValueOnce(
    new Error('Synthetic Blockbook unavailable')
  );
  mockEmitter.mockResolvedValueOnce([]);
  mount();
  await act(async () => undefined);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }))
  );
  expect(screen.getByText('tokens.noTokensFound')).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('keeps custom GUID import available while owned discovery is unavailable', async () => {
  mockEmitter.mockRejectedValueOnce(
    new Error('Synthetic Blockbook unavailable')
  );
  mount();
  await act(async () => undefined);
  fireEvent.click(screen.getByRole('button', { name: 'tokens.addCustomTab' }));
  expect(
    screen.getByRole('textbox', { name: 'tokens.assetGuid' })
  ).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('keeps pending replacement-network discovery isolated from a previous network failure', async () => {
  let rejectPrevious!: (error: Error) => void;
  let finishCurrent!: (value: unknown[]) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectPrevious = reject;
      })
  );
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCurrent = resolve;
      })
  );
  const view = mount();
  mockState.vault.activeNetwork.url = 'https://replacement-blockbook.invalid';
  view.rerender(
    <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
      <AddToken />
    </MemoryRouter>
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  await act(async () =>
    rejectPrevious(new Error('Previous network unavailable'))
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('tokens.noTokensFound')).toBeNull();
  await act(async () =>
    finishCurrent([
      { assetGuid: '456', symbol: 'CURRENT', balance: '3', decimals: 8 },
    ])
  );
  expect(screen.getByText('CURRENT')).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
});
