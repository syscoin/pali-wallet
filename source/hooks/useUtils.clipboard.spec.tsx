/** @jest-environment jsdom */

import { act, render, screen } from '@testing-library/react';
import React, { useLayoutEffect } from 'react';

import { useUtils } from './useUtils';

const mockWrite = jest.fn();
const mockError = jest.fn();
const mockInfo = jest.fn();
const mockDismiss = jest.fn();
const message = 'Localized clipboard failure';
let testClock = 1_900_000_000_000;
let current: {
  alert: ReturnType<typeof useUtils>['alert'];
  copy: (text: string) => Promise<void>;
  isCurrentCopy: () => boolean;
};

jest.mock('./useSafeNavigate', () => ({ useSafeNavigate: () => jest.fn() }));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: () => 'Localized clipboard failure' },
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    error: (...args: any[]) => mockError(...args),
    info: (...args: any[]) => mockInfo(...args),
    dismiss: (...args: any[]) => mockDismiss(...args),
  }),
}));

const Fixture = ({
  timeout = 1000,
  scope,
  onLayout,
}: {
  onLayout?: () => void;
  scope?: string;
  timeout?: number;
}) => {
  const utils = useUtils();
  const [copied, copy, isCurrentCopy] = utils.useCopyClipboard(timeout, scope);
  current = { copy, alert: utils.alert, isCurrentCopy };
  useLayoutEffect(() => onLayout?.());
  return <output data-testid="copied">{String(copied)}</output>;
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  testClock += 60_000;
  jest.setSystemTime(testClock);
  jest.clearAllMocks();
  mockWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
});
afterEach(() => jest.useRealTimers());

it('handles a fire-and-forget denial without copied state or an unhandled rejection', async () => {
  mockWrite.mockRejectedValueOnce(new Error('Synthetic denied clipboard'));
  render(<Fixture />);
  act(() => {
    void current.copy('public fixture');
  });
  await settle();
  expect(mockWrite).toHaveBeenCalledWith('public fixture');
  expect(screen.getByTestId('copied').textContent).toBe('false');
  expect(mockError).toHaveBeenCalledWith(message);
  expect(mockError).toHaveBeenCalledTimes(1);
});

it('preserves rejection for awaited callers and deduplicates their existing error handler', async () => {
  const error = new Error('Synthetic denied clipboard');
  mockWrite.mockRejectedValueOnce(error);
  render(<Fixture />);
  await act(async () => {
    await expect(current.copy('public fixture')).rejects.toBe(error);
    current.alert.error(message);
  });
  await settle();
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockError.mock.calls[0][0]).toBe(message);
});

it('calls the browser synchronously inside the gesture and only marks a resolved write as copied', async () => {
  const pending = deferred();
  mockWrite.mockReturnValueOnce(pending.promise);
  render(<Fixture />);
  let result!: Promise<void>;
  act(() => {
    result = current.copy('unaltered public fixture');
    expect(mockWrite).toHaveBeenCalledWith('unaltered public fixture');
  });
  expect(screen.getByTestId('copied').textContent).toBe('false');
  await act(async () => {
    pending.resolve();
    await result;
  });
  expect(screen.getByTestId('copied').textContent).toBe('true');
  expect(mockError).not.toHaveBeenCalled();
});

it('restarts the copied indicator timeout for repeated successful copies', async () => {
  render(<Fixture />);
  await act(async () => current.copy('same public fixture'));
  await act(async () => jest.advanceTimersByTimeAsync(750));
  await act(async () => current.copy('same public fixture'));
  await act(async () => jest.advanceTimersByTimeAsync(750));
  expect(screen.getByTestId('copied').textContent).toBe('true');
  await act(async () => jest.advanceTimersByTimeAsync(250));
  expect(screen.getByTestId('copied').textContent).toBe('false');
  expect(mockWrite).toHaveBeenCalledTimes(2);
});

it('does not let an old successful reply hide the newest copy failure', async () => {
  const older = deferred();
  mockWrite.mockReturnValueOnce(older.promise);
  mockWrite.mockRejectedValueOnce(new Error('Newest copy failed'));
  render(<Fixture />);
  act(() => {
    void current.copy('old public fixture');
    void current.copy('new public fixture');
  });
  await settle();
  await act(async () => older.resolve());
  expect(screen.getByTestId('copied').textContent).toBe('false');
  expect(mockError).toHaveBeenCalledTimes(1);
});

it('does not replace a newer successful copy with a stale failure notice', async () => {
  const older = deferred();
  mockWrite.mockReturnValueOnce(older.promise);
  render(<Fixture />);
  act(() => void current.copy('old public fixture'));
  await act(async () => current.copy('new public fixture'));
  await act(async () => older.reject(new Error('Old copy failed')));
  await settle();
  expect(screen.getByTestId('copied').textContent).toBe('true');
  expect(mockError).not.toHaveBeenCalled();
});

it('does not suppress the latest failure when a newer copy cancels an unshown notice', async () => {
  mockWrite.mockRejectedValue(new Error('Synthetic clipboard refusal'));
  render(<Fixture />);
  await act(async () => {
    await expect(current.copy('first public fixture')).rejects.toThrow();
  });
  // The previous rejection queued a notice, but its timer has not run yet.
  await act(async () => {
    await expect(current.copy('second public fixture')).rejects.toThrow();
  });
  await settle();
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockError).toHaveBeenCalledWith(message);
});

it.each(['resolve', 'reject'] as const)(
  'retires pending clipboard feedback when the owning view unmounts before %s',
  async (outcome) => {
    const pending = deferred();
    mockWrite.mockReturnValueOnce(pending.promise);
    const view = render(<Fixture />);
    act(() => void current.copy('public fixture'));
    view.unmount();
    await act(async () => {
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new Error('Synthetic late failure'));
    });
    await settle();
    expect(mockError).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  }
);

it('turns synchronous browser clipboard exceptions into the same observed rejection', async () => {
  const error = new Error('Synthetic clipboard unavailable');
  mockWrite.mockImplementationOnce(() => {
    throw error;
  });
  render(<Fixture />);
  let result!: Promise<void>;
  act(() => {
    result = current.copy('public fixture');
  });
  await expect(result).rejects.toBe(error);
  await settle();
  expect(mockError).toHaveBeenCalledWith(message);
});

it('replaces a queued optimistic legacy notice with the actual failure', async () => {
  const events: string[] = [];
  mockInfo.mockImplementation(() => events.push('legacy success'));
  mockDismiss.mockImplementation(() => events.push('dismiss'));
  mockError.mockImplementation(() => events.push('actual failure'));
  mockWrite.mockRejectedValueOnce(new Error('Synthetic denied clipboard'));
  render(<Fixture />);
  act(() => {
    void current.copy('public fixture');
    current.alert.info('Legacy copied notice');
  });
  await settle();
  expect(events.slice(-2)).toEqual(['dismiss', 'actual failure']);
  expect(screen.getByTestId('copied').textContent).toBe('false');
});

it.each(['resolve', 'reject'] as const)(
  'retires a pending %s across A -> B -> A without suppressing the current copy',
  async (outcome) => {
    const old = deferred();
    mockWrite.mockReturnValueOnce(old.promise);
    const view = render(<Fixture scope="A" />);
    act(() => void current.copy('old public fixture'));
    view.rerender(<Fixture scope="B" />);
    view.rerender(<Fixture scope="A" />);
    await act(async () => {
      if (outcome === 'resolve') old.resolve();
      else old.reject(new Error('Old context refusal'));
    });
    await settle();
    expect(screen.getByTestId('copied').textContent).toBe('false');
    expect(mockError).not.toHaveBeenCalled();
    await act(async () => current.copy('current public fixture'));
    expect(screen.getByTestId('copied').textContent).toBe('true');
    expect(mockWrite.mock.calls).toEqual([
      ['old public fixture'],
      ['current public fixture'],
    ]);
  }
);

it('invalidates copied state and its notification predicate before passive effects in the next scope', async () => {
  const view = render(<Fixture scope="A" />);
  await act(async () => current.copy('public fixture'));
  const oldIsCurrent = current.isCurrentCopy;
  expect(oldIsCurrent()).toBe(true);
  const beforePassiveEffects = jest.fn(() => {
    expect(oldIsCurrent()).toBe(false);
    expect(current.isCurrentCopy()).toBe(false);
    expect(screen.getByTestId('copied').textContent).toBe('false');
  });
  view.rerender(<Fixture scope="B" onLayout={beforePassiveEffects} />);
  expect(beforePassiveEffects).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(mockError).not.toHaveBeenCalled();
});

it('does not let a stale scoped callback write or cancel the new scope copy', async () => {
  const view = render(<Fixture scope="A" />);
  const oldCopy = current.copy;
  view.rerender(<Fixture scope="B" />);
  await act(async () => current.copy('current public fixture'));
  await act(async () => oldCopy('stale public fixture'));
  expect(mockWrite.mock.calls).toEqual([['current public fixture']]);
  expect(screen.getByTestId('copied').textContent).toBe('true');
});

it('retires a queued refusal on scope change without deduplicating the current refusal', async () => {
  mockWrite.mockRejectedValue(new Error('Synthetic clipboard refusal'));
  const view = render(<Fixture scope="A" />);
  await act(async () => {
    await expect(current.copy('old public fixture')).rejects.toThrow();
  });
  view.rerender(<Fixture scope="B" />);
  await settle();
  expect(mockError).not.toHaveBeenCalled();
  await act(async () => {
    await expect(current.copy('current public fixture')).rejects.toThrow();
  });
  await settle();
  expect(mockError).toHaveBeenCalledTimes(1);
});

it.each(['scope change', 'new copy', 'unmount'] as const)(
  'retires a queued scoped success after %s without consuming message deduplication',
  async (change) => {
    const view = render(<Fixture scope="A" />);
    await act(async () => current.copy('old public fixture'));
    current.alert.info(
      'Scoped copied notice',
      undefined,
      current.isCurrentCopy
    );
    if (change === 'scope change') view.rerender(<Fixture scope="B" />);
    else if (change === 'new copy')
      await act(async () => current.copy('current public fixture'));
    else view.unmount();
    await settle();
    expect(mockInfo).not.toHaveBeenCalled();
    if (change === 'unmount') return;
    if (change === 'scope change')
      await act(async () => current.copy('current public fixture'));
    current.alert.info(
      'Scoped copied notice',
      undefined,
      current.isCurrentCopy
    );
    await settle();
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith('Scoped copied notice', undefined);
  }
);

it('preserves immediate dismissal and queued insertion for unscoped info while skipping duplicates', async () => {
  render(<Fixture />);
  current.alert.info('Unscoped info');
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(mockInfo).not.toHaveBeenCalled();
  await settle();
  expect(mockInfo).toHaveBeenCalledWith('Unscoped info', undefined);
  current.alert.info('Unscoped info');
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  await settle();
  expect(mockInfo).toHaveBeenCalledTimes(1);
});
