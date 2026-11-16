/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import { getNativeBalanceCacheKey } from 'utils/nativeBalanceCache';

import { LazyAccountBalance } from './LazyAccountBalance';

const mockController = jest.fn();
let mockNetwork: any;
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockController }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vault: { activeNetwork: mockNetwork } }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({ isFiatAvailable: false, getFiatAmount: () => '--' }),
}));

const firstNetwork = {
  kind: 'ethereum',
  chainId: 1,
  url: 'https://first.example',
  currency: 'AAA',
};
const secondNetwork = {
  ...firstNetwork,
  chainId: 2,
  url: 'https://second.example',
  currency: 'BBB',
};
const account = (id: number, cachedNetwork?: any, balance = '7'): any => ({
  id,
  address: `0x${id.toString(16).padStart(40, '0')}`,
  nativeBalanceCache: cachedNetwork
    ? {
        [getNativeBalanceCacheKey(cachedNetwork)]: {
          balance,
          updatedAt: Date.now(),
        },
      }
    : {},
});
let clock = 1_000_000;
beforeEach(() => {
  jest.useFakeTimers();
  clock += 10_000;
  jest.setSystemTime(clock);
  mockNetwork = firstNetwork;
  mockController.mockReset().mockImplementation(async () => '3');
});
afterEach(async () => {
  cleanup();
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  jest.useRealTimers();
});

const queued = () => {
  const siblings = Array.from({ length: 10 }, (_, index) =>
    account(index, secondNetwork, '1')
  );
  const target = account(10, secondNetwork);
  const onBalanceLoad = jest.fn();
  const tree = (selected: any) => (
    <>
      {siblings.map((value) => (
        <LazyAccountBalance key={value.id} account={value} showFiat={false} />
      ))}
      <section data-testid="target">
        <LazyAccountBalance
          account={selected}
          showFiat={false}
          showSkeleton={false}
          onBalanceLoad={onBalanceLoad}
        />
      </section>
    </>
  );
  const view = render(tree(target));
  return { view, target, tree, onBalanceLoad };
};

it.each(['network', 'account'])(
  'retires an old rate-limit retry before a same-instance %s change can dispatch it',
  async (boundary) => {
    const { view, target, tree, onBalanceLoad } = queued();
    await act(async () => jest.advanceTimersByTimeAsync(100));
    expect(mockController).toHaveBeenCalledTimes(10);
    if (boundary === 'network') mockNetwork = secondNetwork;
    const current = boundary === 'network' ? target : account(99, firstNetwork);
    view.rerender(tree(current));
    expect(screen.getByTestId('target')).toHaveTextContent(
      boundary === 'network' ? '7 BBB' : '7 AAA'
    );
    await act(async () => jest.advanceTimersByTimeAsync(2000));
    expect(
      mockController.mock.calls.some(([, args]) => args[0].id === 10)
    ).toBe(false);
    expect(screen.getByTestId('target')).toHaveTextContent(
      boundary === 'network' ? '7 BBB' : '7 AAA'
    );
    expect(onBalanceLoad).toHaveBeenLastCalledWith('7');
    expect(onBalanceLoad).not.toHaveBeenCalledWith('3');
  }
);

it('keeps a legitimate current-context rate-limit retry', async () => {
  queued();
  await act(async () => jest.advanceTimersByTimeAsync(1100));
  expect(mockController).toHaveBeenCalledTimes(11);
  expect(
    mockController.mock.calls.filter(([, args]) => args[0].id === 10)
  ).toHaveLength(1);
  expect(screen.getByTestId('target')).toHaveTextContent('3 AAA');
});

it('retires a queued retry on unmount', async () => {
  const { view } = queued();
  await act(async () => jest.advanceTimersByTimeAsync(100));
  view.unmount();
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(mockController).toHaveBeenCalledTimes(10);
});

it.each(['success', 'error'])(
  'ignores an old in-flight %s after a fresh account takes ownership',
  async (outcome) => {
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    mockController.mockImplementation(
      () =>
        new Promise<string>((done, fail) => {
          resolve = done;
          reject = fail;
        })
    );
    const onBalanceLoad = jest.fn();
    const view = render(
      <LazyAccountBalance
        account={account(200)}
        showFiat={false}
        showSkeleton={false}
        onBalanceLoad={onBalanceLoad}
      />
    );
    await act(async () => jest.advanceTimersByTimeAsync(100));
    expect(mockController).toHaveBeenCalledTimes(1);
    view.rerender(
      <LazyAccountBalance
        account={account(201, firstNetwork)}
        showFiat={false}
        showSkeleton={false}
        onBalanceLoad={onBalanceLoad}
      />
    );
    await act(async () =>
      outcome === 'success' ? resolve('3') : reject(new Error('Old owner'))
    );
    expect(screen.getByText('7 AAA')).toBeInTheDocument();
    expect(onBalanceLoad).toHaveBeenLastCalledWith('7');
    expect(onBalanceLoad).not.toHaveBeenCalledWith('3');
  }
);
