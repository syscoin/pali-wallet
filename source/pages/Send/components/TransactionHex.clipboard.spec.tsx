/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { TransactionHexComponent } from './TransactionHex';

const mockWrite = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockTranslate = (key: string) => key;
let clock = 1_930_000_000_000;

jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    info: (...args: any[]) => mockInfo(...args),
    error: (...args: any[]) => mockError(...args),
    success: jest.fn(),
    dismiss: jest.fn(),
  }),
}));

// Valid synthetic approve calldata, differing only in the edited allowance.
// No wallet, provider or signing is involved in this clipboard interaction.
const SPENDER = '11'.repeat(20).padStart(64, '0');
const calldata = (amount: number) =>
  `0x095ea7b3${SPENDER}${amount.toString(16).padStart(64, '0')}`;
const DATA_A = calldata(1);
const DATA_B = calldata(2);
const contents = (dataHex = DATA_A) => (
  <TransactionHexComponent dataHex={dataHex} />
);
const copyButton = () => screen.getByRole('button', { name: 'buttons.copy' });
const clickCopy = () => fireEvent.click(copyButton());
const installClipboard = () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
};
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  // Keep native promise settlement separate from the queued toast delivery.
  await act(async () => Promise.resolve());
  await act(async () => jest.advanceTimersByTimeAsync(0));
};

beforeEach(() => {
  jest.useFakeTimers();
  // The real toast helper retains its dedup map between test cases.
  clock += 60_000;
  jest.setSystemTime(clock);
  jest.clearAllMocks();
  mockWrite.mockReset().mockResolvedValue(undefined);
  installClipboard();
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('copies the exact displayed calldata with the ordinary mouse control', async () => {
  render(contents());
  expect(copyButton()).toHaveAttribute('type', 'button');
  expect(copyButton()).toHaveTextContent(DATA_A);
  clickCopy();
  await flush();
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockWrite).toHaveBeenCalledWith(DATA_A);
  expect(mockInfo).toHaveBeenCalledTimes(1);
  expect(mockInfo).toHaveBeenCalledWith('send.hexDataCopied', undefined);
  expect(mockError).not.toHaveBeenCalled();
});

it.each([
  ['Enter', '{Enter}'],
  ['Space', ' '],
])('allows Tab then %s to copy the displayed calldata', async (_name, key) => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  // user-event installs its own clipboard; control only native IO afterward.
  installClipboard();
  render(
    <>
      <button type="button">Before hex</button>
      {contents()}
      <button type="button">After hex</button>
    </>
  );
  screen.getByRole('button', { name: 'Before hex' }).focus();
  await user.tab();
  expect(copyButton()).toHaveFocus();
  await user.keyboard(key);
  await flush();
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockWrite).toHaveBeenCalledWith(DATA_A);
  expect(mockInfo).toHaveBeenCalledTimes(1);
});

it('waits for native clipboard acceptance before reporting copied', async () => {
  const pending = deferred();
  mockWrite.mockReturnValueOnce(pending.promise);
  render(contents());
  clickCopy();
  await flush();
  expect(mockWrite).toHaveBeenCalledWith(DATA_A);
  expect(mockInfo).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await flush();
  expect(mockInfo).toHaveBeenCalledTimes(1);
  expect(mockInfo).toHaveBeenCalledWith('send.hexDataCopied', undefined);
});

it('reports a refused native write without a copied success', async () => {
  mockWrite.mockRejectedValueOnce(new Error('Synthetic clipboard denied'));
  render(contents());
  clickCopy();
  await flush();
  expect(mockWrite).toHaveBeenCalledWith(DATA_A);
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockInfo).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'retires pending %s feedback when the reviewed calldata changes',
  async (outcome) => {
    const pending = deferred();
    mockWrite.mockReturnValueOnce(pending.promise);
    const view = render(contents());
    const originalButton = copyButton();
    clickCopy();
    view.rerender(contents(DATA_B));
    expect(copyButton()).toBe(originalButton);
    expect(copyButton()).toHaveTextContent(DATA_B);
    await act(async () => {
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new Error('Old calldata write refused'));
    });
    await flush();
    expect(mockWrite).toHaveBeenCalledWith(DATA_A);
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('does not revive a pending copy after calldata changes A to B to A', async () => {
  const pending = deferred();
  mockWrite.mockReturnValueOnce(pending.promise);
  const view = render(contents());
  clickCopy();
  view.rerender(contents(DATA_B));
  view.rerender(contents(DATA_A));
  await act(async () => pending.resolve());
  await flush();
  expect(copyButton()).toHaveTextContent(DATA_A);
  expect(mockInfo).not.toHaveBeenCalled();
  expect(mockError).not.toHaveBeenCalled();
});

it('retires an accepted notice still queued when calldata changes', async () => {
  const view = render(contents());
  clickCopy();
  await act(async () => Promise.resolve());
  expect(mockInfo).not.toHaveBeenCalled();
  view.rerender(contents(DATA_B));
  await flush();
  expect(mockInfo).not.toHaveBeenCalled();
  expect(mockError).not.toHaveBeenCalled();
});

it('allows a fresh exact copy after retiring the prior calldata write', async () => {
  const oldWrite = deferred();
  const newWrite = deferred();
  mockWrite.mockReturnValueOnce(oldWrite.promise);
  mockWrite.mockReturnValueOnce(newWrite.promise);
  const view = render(contents());
  clickCopy();
  view.rerender(contents(DATA_B));
  clickCopy();
  expect(mockWrite.mock.calls).toEqual([[DATA_A], [DATA_B]]);
  await act(async () => oldWrite.resolve());
  await flush();
  expect(mockInfo).not.toHaveBeenCalled();
  await act(async () => newWrite.resolve());
  await flush();
  expect(mockInfo).toHaveBeenCalledTimes(1);
  expect(mockInfo).toHaveBeenCalledWith('send.hexDataCopied', undefined);
  expect(mockError).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'retires pending native %s feedback after unmount',
  async (outcome) => {
    const pending = deferred();
    mockWrite.mockReturnValueOnce(pending.promise);
    const view = render(contents());
    clickCopy();
    view.unmount();
    await act(async () => {
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new Error('Closed review write refused'));
    });
    await flush();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('retires an accepted notice still queued when the view unmounts', async () => {
  const view = render(contents());
  clickCopy();
  await act(async () => Promise.resolve());
  view.unmount();
  await flush();
  expect(mockInfo).not.toHaveBeenCalled();
});

it('lets only the latest duplicate copy report successful completion', async () => {
  const first = deferred();
  const latest = deferred();
  mockWrite.mockReturnValueOnce(first.promise);
  mockWrite.mockReturnValueOnce(latest.promise);
  render(contents());
  clickCopy();
  clickCopy();
  expect(mockWrite.mock.calls).toEqual([[DATA_A], [DATA_A]]);
  await act(async () => first.resolve());
  await flush();
  expect(mockInfo).not.toHaveBeenCalled();
  await act(async () => latest.resolve());
  await flush();
  expect(mockInfo).toHaveBeenCalledTimes(1);
  expect(mockError).not.toHaveBeenCalled();
});

it('does not let an earlier copy success replace the latest refusal', async () => {
  const first = deferred();
  mockWrite.mockReturnValueOnce(first.promise);
  mockWrite.mockRejectedValueOnce(new Error('Latest write refused'));
  render(contents());
  clickCopy();
  clickCopy();
  await flush();
  expect(mockError).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve());
  await flush();
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockInfo).not.toHaveBeenCalled();
});
