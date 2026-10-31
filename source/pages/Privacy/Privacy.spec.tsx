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

import en from '../../assets/locales/en.json';

import Privacy from './Privacy';
import { isPrivacySyncStatus } from './usePrivacyIndex';

const mockEmitter = jest.fn();
let mockState: any;
jest.mock('./PrivateNotes', () => () => null);
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
  const prepare = screen.getByRole('button', { name: en.privacy.prepare });
  expect(prepare).toBeDisabled();
  await waitFor(() => expect(prepare).toBeEnabled());
  expect(
    screen.getByRole('combobox', { name: en.privacy.poolLabel })
  ).toHaveValue('eth-0.1');
  expect(
    screen.getAllByRole('option').map((option) => option.textContent)
  ).toEqual(['0.1 ETH', '1 ETH', '10 ETH', '100 ETH']);
  expect(mockEmitter.mock.calls).toEqual([
    [['privacy', 'getStatus'], ['eth-0.1'], 10000, false],
  ]);
  expect(screen.getByText(en.privacy.scopeNotice)).toBeVisible();
  expect(screen.getByText(en.privacy.description)).toBeVisible();
  await user.tab();
  expect(screen.getByRole('combobox')).toHaveFocus();
  await user.tab();
  expect(prepare).toHaveFocus();
  await user.keyboard('{Enter}');
  await screen.findByText(en.privacy.syncing);
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privacy', 'start'],
    ['eth-0.1'],
    10000,
    false
  );
});

it('shows active progress, then observes local ready status at a slower interval', async () => {
  jest.useFakeTimers();
  render(<Privacy />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.privacy.prepare }));
  });
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.syncing);
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
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.verifying);
  expect(screen.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '50'
  );
  mockEmitter.mockResolvedValueOnce(ready);
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.ready);
  expect(
    screen.getByText(en.privacy.savedDeposits.replace('{{count}}', '42'))
  ).toBeVisible();
  expect(
    screen.getByText(en.privacy.verifiedBlock.replace('{{block}}', '20000000'))
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: en.privacy.refresh })
  ).toBeEnabled();
  const calls = mockEmitter.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(14999);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(calls);
  mockEmitter.mockResolvedValueOnce(ready);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(calls + 1);
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privacy', 'getStatus'],
    ['eth-0.1'],
    10000,
    false
  );
  expect(
    mockEmitter.mock.calls.filter((call) => call[0][1] === 'start')
  ).toHaveLength(1);
});

it('observes locally retried jobs after an error without issuing another start', async () => {
  jest.useFakeTimers();
  mockEmitter.mockResolvedValueOnce({ ...ready, phase: 'error' });
  render(<Privacy />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.error);
  expect(screen.getByRole('button', { name: en.privacy.pause })).toBeEnabled();
  await act(async () => {
    jest.advanceTimersByTime(14999);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  mockEmitter.mockResolvedValueOnce({ ...ready, phase: 'syncing' });
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.syncing);
  expect(
    mockEmitter.mock.calls.every((call) => call[0][1] === 'getStatus')
  ).toBe(true);
});

it.each(['idle', 'paused'])(
  'does not poll local status while %s',
  async (phase) => {
    jest.useFakeTimers();
    mockEmitter.mockResolvedValue({ ...ready, phase });
    render(<Privacy />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it('retains verified cache metadata after an update error and allows retry', async () => {
  mockEmitter.mockResolvedValueOnce(ready).mockResolvedValueOnce({
    ...ready,
    phase: 'error',
    errorCode: 'untrusted remote details',
  });
  const user = userEvent.setup();
  render(<Privacy />);
  await user.click(
    await screen.findByRole('button', { name: en.privacy.refresh })
  );
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.error);
  expect(
    screen.getByText(en.privacy.savedDeposits.replace('{{count}}', '42'))
  ).toBeVisible();
  expect(
    screen.queryByText('untrusted remote details')
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: en.privacy.retry }));
  await screen.findByText(en.privacy.syncing);
});

it('recovers from a failed local status read without claiming the pool is empty', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('offline'));
  const user = userEvent.setup();
  render(<Privacy />);
  await screen.findByText(en.privacy.unavailable);
  expect(screen.queryByText(en.privacy.idle)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: en.privacy.retry }));
  await screen.findByText(en.privacy.syncing);
});

it('supports pause, resume and clearing public data without a transaction action', async () => {
  const user = userEvent.setup();
  render(<Privacy />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: en.privacy.prepare })
    ).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: en.privacy.prepare }));
  mockEmitter.mockResolvedValueOnce({ poolId: 'eth-0.1', phase: 'paused' });
  await user.click(screen.getByRole('button', { name: en.privacy.pause }));
  await screen.findByText(en.privacy.paused);
  await user.click(screen.getByRole('button', { name: en.privacy.resume }));
  await screen.findByText(en.privacy.syncing);
  await user.click(screen.getByRole('button', { name: en.privacy.clear }));
  await screen.findByText(en.privacy.idle);
  expect(mockEmitter.mock.calls.map((call) => call[0][1])).toEqual([
    'getStatus',
    'start',
    'pause',
    'start',
    'clear',
  ]);
});

it('pauses future updates from ready, retains verified data on resume and clears it on request', async () => {
  const pauseReply = deferred();
  mockEmitter
    .mockResolvedValueOnce(ready)
    .mockReturnValueOnce(pauseReply.promise);
  const user = userEvent.setup();
  render(<Privacy />);
  const pause = await screen.findByRole('button', { name: en.privacy.pause });
  const clear = screen.getByRole('button', { name: en.privacy.clear });
  await user.click(pause);
  expect(pause).toBeDisabled();
  expect(clear).toBeDisabled();
  expect(
    screen.getByRole('button', { name: en.privacy.refresh })
  ).toBeDisabled();
  await act(async () => pauseReply.resolve({ ...ready, phase: 'paused' }));
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.paused);
  expect(
    screen.getByText(en.privacy.savedDeposits.replace('{{count}}', '42'))
  ).toBeVisible();
  expect(
    screen.getByText(en.privacy.verifiedBlock.replace('{{block}}', '20000000'))
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: en.privacy.pause })
  ).not.toBeInTheDocument();

  mockEmitter.mockResolvedValueOnce({ ...ready, phase: 'syncing' });
  await user.click(screen.getByRole('button', { name: en.privacy.resume }));
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.syncing);
  expect(
    screen.getByText(en.privacy.savedDeposits.replace('{{count}}', '42'))
  ).toBeVisible();
  expect(screen.getByRole('button', { name: en.privacy.pause })).toBeEnabled();

  const clearReply = deferred();
  mockEmitter.mockReturnValueOnce(clearReply.promise);
  await user.click(screen.getByRole('button', { name: en.privacy.clear }));
  expect(screen.getByRole('button', { name: en.privacy.pause })).toBeDisabled();
  expect(screen.getByRole('button', { name: en.privacy.clear })).toBeDisabled();
  await act(async () =>
    clearReply.resolve({ poolId: ready.poolId, phase: 'idle' })
  );
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.idle);
  expect(
    screen.queryByText(en.privacy.savedDeposits.replace('{{count}}', '42'))
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: en.privacy.pause })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: en.privacy.clear })
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: en.privacy.prepare })
  ).toBeEnabled();
  expect(mockEmitter.mock.calls.map((call) => call[0][1])).toEqual([
    'getStatus',
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
      screen.getByRole('button', { name: en.privacy.prepare })
    ).toBeEnabled()
  );
  await act(async () => oldReply.resolve(ready));
  expect(screen.getByRole('combobox')).toHaveValue('eth-10');
  expect(
    screen.queryByText(en.privacy.savedDeposits.replace('{{count}}', '42'))
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: en.privacy.prepare }));
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
    await screen.findByText(en.privacy.idle);
    expect(
      screen.getByRole('button', { name: en.privacy.prepare })
    ).toBeDisabled();
    expect(screen.getByText(en.privacy.networkRequired)).toBeVisible();
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

it.each([
  ['syncing', 1500],
  ['verifying', 1500],
  ['ready', 15000],
  ['error', 15000],
])(
  'observes %s status only while this page is visible',
  async (phase, delay) => {
    jest.useFakeTimers();
    const visibility = jest
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('visible');
    mockEmitter.mockResolvedValue({ ...ready, phase });
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
        jest.advanceTimersByTime(30000);
      });
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      act(() => {
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {
        jest.advanceTimersByTime(Number(delay));
      });
      expect(mockEmitter).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
  }
);

it('discards an old network reply and requires mainnet again after a network change', async () => {
  const reply = deferred();
  mockEmitter.mockResolvedValueOnce({ poolId: 'eth-0.1', phase: 'idle' });
  mockEmitter.mockReturnValueOnce(reply.promise);
  const user = userEvent.setup();
  const { rerender } = render(<Privacy />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: en.privacy.prepare })
    ).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: en.privacy.prepare }));
  mockState.vault.activeNetwork = {
    chainId: 57,
    kind: 'ethereum',
    url: 'https://other.test',
  };
  rerender(<Privacy />);
  await screen.findByText(en.privacy.idle);
  await act(async () => reply.resolve(ready));
  expect(
    screen.getByRole('button', { name: en.privacy.prepare })
  ).toBeDisabled();
  expect(
    screen.queryByText(en.privacy.savedDeposits.replace('{{count}}', '42'))
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

it('names pool status with the selected denomination without starting a sync', async () => {
  const user = userEvent.setup();
  render(<Privacy />);
  expect(
    screen.getByRole('region', { name: `${en.privacy.poolData} · 0.1 ETH` })
  ).toBeVisible();
  await user.selectOptions(
    screen.getByRole('combobox', { name: en.privacy.poolLabel }),
    'eth-1'
  );
  expect(
    screen.getByRole('region', { name: `${en.privacy.poolData} · 1 ETH` })
  ).toBeVisible();
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenLastCalledWith(
      ['privacy', 'getStatus'],
      ['eth-1'],
      10000,
      false
    )
  );
  expect(
    mockEmitter.mock.calls.every((call) => call[0][1] === 'getStatus')
  ).toBe(true);
});
