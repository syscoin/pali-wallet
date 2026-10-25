/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import Privacy from './Privacy';
import { isPrivacySyncStatus } from './usePrivacyIndex';

const mockEmitter = jest.fn();
let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options: any = {}) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      const value = key
        .split('.')
        .reduce((current, part) => current?.[part], messages);
      return String(value || key).replace(/{{(\w+)}}/g, (_, name) =>
        String(options[name])
      );
    },
  }),
}));
jest.mock('components/Button', () => ({
  Button: ({ children, loading, fullWidth, variant, ...props }: any) => (
    <button
      {...props}
      data-variant={variant}
      data-full-width={fullWidth}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  ),
}));

const ready = {
  poolId: 'eth-0.1',
  phase: 'ready',
  verifiedAt: 1234,
  leafCount: 42,
  blockNumber: 20000000,
};
const deferred = () => {
  let resolve: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve: (value: any) => resolve(value) };
};

beforeEach(() => {
  mockState = {
    vault: {
      activeNetwork: { chainId: 1, kind: 'ethereum', url: 'https://rpc.test' },
      isBitcoinBased: false,
    },
    vaultGlobal: { networkStatus: 'idle' },
  };
  mockEmitter.mockReset().mockImplementation(([, method], [poolId]) =>
    Promise.resolve({
      poolId,
      phase: method === 'start' ? 'syncing' : 'idle',
    })
  );
});
afterEach(() => jest.useRealTimers());

it('checks only local status before explicit preparation and has an accessible four-pool selector', async () => {
  const user = userEvent.setup();
  render(<Privacy />);
  const prepare = screen.getByRole('button', { name: 'Prepare privacy' });
  expect(prepare).toBeDisabled();
  await waitFor(() => expect(prepare).toBeEnabled());
  expect(screen.getByRole('combobox', { name: 'ETH pool' })).toHaveValue(
    'eth-0.1'
  );
  expect(
    screen.getAllByRole('option').map((option) => option.textContent)
  ).toEqual(['0.1 ETH', '1 ETH', '10 ETH', '100 ETH']);
  expect(mockEmitter.mock.calls).toEqual([
    [['privacy', 'getStatus'], ['eth-0.1'], 10000, false],
  ]);
  expect(
    screen.getByText(/Deposits and withdrawals are not available/)
  ).toBeVisible();
  await user.tab();
  expect(screen.getByRole('combobox')).toHaveFocus();
  await user.tab();
  expect(prepare).toHaveFocus();
  await user.keyboard('{Enter}');
  await screen.findByText('Downloading public pool data…');
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privacy', 'start'],
    ['eth-0.1'],
    10000,
    false
  );
});

it('shows sync, verification and verified cached data, then stops polling', async () => {
  jest.useFakeTimers();
  render(<Privacy />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Prepare privacy' }));
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Downloading public pool data…'
  );
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  mockEmitter.mockResolvedValueOnce({
    poolId: 'eth-0.1',
    phase: 'verifying',
    completed: 2,
    total: 4,
  });
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(screen.getByRole('status')).toHaveTextContent('Verifying pool data…');
  expect(screen.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '50'
  );
  mockEmitter.mockResolvedValueOnce(ready);
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Pool data is verified and saved on this device.'
  );
  expect(screen.getByText('Saved public deposits: 42')).toBeVisible();
  expect(screen.getByText('Last verified block: 20000000')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Update pool data' })
  ).toBeEnabled();
  const calls = mockEmitter.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(calls);
});

it('retains verified cache metadata after an update error and allows retry', async () => {
  mockEmitter.mockResolvedValueOnce(ready).mockResolvedValueOnce({
    ...ready,
    phase: 'error',
    errorCode: 'untrusted remote details',
  });
  const user = userEvent.setup();
  render(<Privacy />);
  await user.click(
    await screen.findByRole('button', { name: 'Update pool data' })
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Preparation could not finish. Try again.'
  );
  expect(screen.getByText('Saved public deposits: 42')).toBeVisible();
  expect(
    screen.queryByText('untrusted remote details')
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Downloading public pool data…');
});

it('recovers from a failed local status read without claiming the pool is empty', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('offline'));
  const user = userEvent.setup();
  render(<Privacy />);
  await screen.findByText('Could not read preparation status. Try again.');
  expect(
    screen.queryByText('Pool data has not been prepared.')
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Downloading public pool data…');
});

it('supports pause, resume and clearing public data without a transaction action', async () => {
  const user = userEvent.setup();
  render(<Privacy />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Prepare privacy' })
    ).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: 'Prepare privacy' }));
  mockEmitter.mockResolvedValueOnce({ poolId: 'eth-0.1', phase: 'paused' });
  await user.click(screen.getByRole('button', { name: 'Pause' }));
  await screen.findByText('Preparation is paused.');
  await user.click(screen.getByRole('button', { name: 'Resume' }));
  await screen.findByText('Downloading public pool data…');
  await user.click(screen.getByRole('button', { name: 'Clear saved data' }));
  await screen.findByText('Pool data has not been prepared.');
  expect(mockEmitter.mock.calls.map((call) => call[0][1])).toEqual([
    'getStatus',
    'start',
    'pause',
    'start',
    'clear',
  ]);
});

it('ignores a prior pool response after keyboard selection changes the pool', async () => {
  const oldReply = deferred();
  mockEmitter.mockReturnValueOnce(oldReply.promise);
  const user = userEvent.setup();
  render(<Privacy />);
  await user.selectOptions(screen.getByRole('combobox'), 'eth-10');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Prepare privacy' })
    ).toBeEnabled()
  );
  await act(async () => oldReply.resolve(ready));
  expect(screen.getByRole('combobox')).toHaveValue('eth-10');
  expect(
    screen.queryByText('Saved public deposits: 42')
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Prepare privacy' }));
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privacy', 'start'],
    ['eth-10'],
    10000,
    false
  );
});

it.each([
  [57, 'ethereum', false, 'idle'],
  [1, 'syscoin', true, 'idle'],
  [1, 'ethereum', false, 'switching'],
])(
  'requires active Ethereum mainnet before starting (%s, %s)',
  async (chainId, kind, bitcoin, networkStatus) => {
    mockState.vault.activeNetwork.chainId = chainId;
    mockState.vault.activeNetwork.kind = kind;
    mockState.vault.isBitcoinBased = bitcoin;
    mockState.vaultGlobal.networkStatus = networkStatus;
    render(<Privacy />);
    await screen.findByText('Pool data has not been prepared.');
    expect(
      screen.getByRole('button', { name: 'Prepare privacy' })
    ).toBeDisabled();
    expect(
      screen.getByText(/Select Ethereum Mainnet from the network menu/)
    ).toBeVisible();
    expect(
      mockEmitter.mock.calls.every((call) => call[0][1] === 'getStatus')
    ).toBe(true);
  }
);

it('stops polling on departure and ignores an outstanding reply', async () => {
  jest.useFakeTimers();
  mockEmitter.mockResolvedValueOnce({ poolId: 'eth-0.1', phase: 'syncing' });
  const { unmount } = render(<Privacy />);
  await act(async () => {
    await Promise.resolve();
  });
  const reply = deferred();
  mockEmitter.mockReturnValueOnce(reply.promise);
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  unmount();
  await act(async () => {
    reply.resolve(ready);
    jest.advanceTimersByTime(10000);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('polls a running job only while this page is visible', async () => {
  jest.useFakeTimers();
  const visibility = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  mockEmitter.mockResolvedValue({ poolId: 'eth-0.1', phase: 'syncing' });
  try {
    render(<Privacy />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    act(() => {
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(mockEmitter).toHaveBeenCalledTimes(2);
  } finally {
    visibility.mockRestore();
  }
});

it('discards an old network reply and requires mainnet again after a network change', async () => {
  const reply = deferred();
  mockEmitter.mockResolvedValueOnce({ poolId: 'eth-0.1', phase: 'idle' });
  mockEmitter.mockReturnValueOnce(reply.promise);
  const user = userEvent.setup();
  const { rerender } = render(<Privacy />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Prepare privacy' })
    ).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: 'Prepare privacy' }));
  mockState.vault.activeNetwork = {
    chainId: 57,
    kind: 'ethereum',
    url: 'https://other.test',
  };
  rerender(<Privacy />);
  await screen.findByText('Pool data has not been prepared.');
  await act(async () => reply.resolve(ready));
  expect(
    screen.getByRole('button', { name: 'Prepare privacy' })
  ).toBeDisabled();
  expect(
    screen.queryByText('Saved public deposits: 42')
  ).not.toBeInTheDocument();
});

it('rejects a wrong-pool or malformed status', () => {
  expect(isPrivacySyncStatus(ready, 'eth-0.1')).toBe(true);
  expect(isPrivacySyncStatus(ready, 'eth-1')).toBe(false);
  expect(isPrivacySyncStatus({ ...ready, leafCount: -1 }, 'eth-0.1')).toBe(
    false
  );
  expect(isPrivacySyncStatus({ ...ready, phase: 'complete' }, 'eth-0.1')).toBe(
    false
  );
});
