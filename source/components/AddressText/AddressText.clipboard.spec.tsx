/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { AddressText, IAddressText } from './AddressText';

const mockWrite = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockDismiss = jest.fn();
const mockTranslate = (key: string) => key;
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
    dismiss: (...args: any[]) => mockDismiss(...args),
  }),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => (
    <span title={content}>{children}</span>
  ),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const pending = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let clock = 2_060_000_000_000;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime((clock += 10_000));
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

const mount = (props: Partial<IAddressText> = {}) =>
  render(<AddressText value={A} {...props} />);
const click = () =>
  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
const settle = async (
  write: ReturnType<typeof pending>,
  outcome: 'resolve' | 'reject'
) => {
  await act(async () => {
    if (outcome === 'resolve') write.resolve();
    else write.reject(new Error('Synthetic clipboard denial'));
  });
  await act(async () => jest.advanceTimersByTimeAsync(0));
};

it.each(['resolve', 'reject'] as const)(
  'announces only the current settled native clipboard result: %s',
  async (outcome) => {
    const write = pending();
    mockWrite.mockReturnValue(write.promise);
    mount();
    click();
    expect(mockWrite).toHaveBeenCalledWith(A);
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
    await settle(write, outcome);
    if (outcome === 'resolve') {
      expect(mockInfo).toHaveBeenCalledWith('home.addressCopied', undefined);
      expect(mockInfo).toHaveBeenCalledTimes(1);
      expect(mockError).not.toHaveBeenCalled();
    } else {
      expect(mockInfo).not.toHaveBeenCalled();
      expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
      expect(mockError).toHaveBeenCalledTimes(1);
    }
  }
);

describe.each(['resolve', 'reject'] as const)('late native %s', (outcome) => {
  it.each(['value', 'ABA', 'unmount'])(
    'retires feedback after %s without changing the text already copied',
    async (change) => {
      const write = pending();
      mockWrite.mockReturnValue(write.promise);
      const view = mount();
      const button = screen.getByRole('button', { name: 'buttons.copy' });
      click();
      expect(mockWrite).toHaveBeenCalledWith(A);
      if (change === 'unmount') view.unmount();
      else {
        view.rerender(<AddressText value={B} />);
        expect(screen.getByRole('button', { name: 'buttons.copy' })).toBe(
          button
        );
        if (change === 'ABA') view.rerender(<AddressText value={A} />);
      }
      await settle(write, outcome);
      expect(mockInfo).not.toHaveBeenCalled();
      expect(mockError).not.toHaveBeenCalled();
      expect(mockDismiss).not.toHaveBeenCalled();
    }
  );
});

it.each(['value', 'unmount'])(
  'rechecks an accepted success still queued before %s',
  async (change) => {
    const write = pending();
    mockWrite.mockReturnValue(write.promise);
    const view = mount();
    click();
    await act(async () => write.resolve());
    expect(mockInfo).not.toHaveBeenCalled();
    if (change === 'value') view.rerender(<AddressText value={B} />);
    else view.unmount();
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  }
);

it.each(['resolve', 'reject'] as const)(
  'does not replace the latest copy with an older %s',
  async (outcome) => {
    const first = pending();
    const second = pending();
    mockWrite
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = mount();
    click();
    view.rerender(<AddressText value={B} />);
    click();
    expect(mockWrite.mock.calls).toEqual([[A], [B]]);
    await settle(first, outcome);
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
    await settle(second, 'resolve');
    expect(mockInfo).toHaveBeenCalledTimes(1);
  }
);

it('keeps a same-value copy current across presentation-only changes', async () => {
  const write = pending();
  mockWrite.mockReturnValue(write.promise);
  const view = mount();
  click();
  view.rerender(
    <AddressText
      value={A}
      preset="full"
      tooltip={false}
      className="presentation-update"
      explorerUrl="https://explorer.synthetic.invalid/address"
    />
  );
  const link = screen.getByRole('link', { name: A });
  expect(link).toHaveAttribute(
    'href',
    'https://explorer.synthetic.invalid/address'
  );
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noreferrer');
  expect(link.closest('.presentation-update')).not.toBeNull();
  await settle(write, 'resolve');
  expect(mockInfo).toHaveBeenCalledTimes(1);
  expect(mockError).not.toHaveBeenCalled();
});

it('retains a non-copyable presentation without clipboard work', () => {
  mount({ copyable: false, preset: 'full' });
  expect(screen.getByText(A)).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  expect(mockWrite).not.toHaveBeenCalled();
});

it('reports a synchronous native refusal once without an unhandled rejection', async () => {
  mockWrite.mockImplementationOnce(() => {
    throw new Error('Synthetic synchronous clipboard refusal');
  });
  mount();
  click();
  await act(async () => Promise.resolve());
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(mockInfo).not.toHaveBeenCalled();
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
});
