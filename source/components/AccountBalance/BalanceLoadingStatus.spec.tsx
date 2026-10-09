import React from 'react';

import {
  BALANCE_LOADING_FEEDBACK_MS,
  BalanceLoadingStatus,
} from './BalanceLoadingStatus';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { operation?: string }) =>
      params?.operation ? `${params.operation}: still loading` : key,
  }),
}));

describe('unknown balance feedback', () => {
  let slow: boolean;
  let effect: () => () => void;
  beforeEach(() => {
    slow = false;
    jest.useFakeTimers();
    jest.spyOn(React, 'useState').mockImplementation(
      () =>
        [
          slow,
          (value: boolean) => {
            slow = value;
          },
        ] as any
    );
    jest.spyOn(React, 'useEffect').mockImplementation((callback) => {
      effect = callback as () => () => void;
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('describes an unknown balance immediately and upgrades feedback before two seconds', () => {
    const pending = BalanceLoadingStatus();
    const cleanup = effect();
    expect(pending.props.id).toBe('home-balance-pending');
    expect(pending.props.role).toBe('status');
    expect(pending.props.children).toBe('networkConnection.updatingBalances');
    jest.advanceTimersByTime(BALANCE_LOADING_FEEDBACK_MS);
    expect(BalanceLoadingStatus().props.children).toContain('still loading');
    expect(BalanceLoadingStatus().props.id).not.toBe('home-balance');
    cleanup();
  });

  it('cancels old context feedback when the keyed balance view is replaced', () => {
    BalanceLoadingStatus();
    const cleanup = effect();
    jest.advanceTimersByTime(500);
    cleanup();
    jest.advanceTimersByTime(2000);
    expect(slow).toBe(false);
  });
});
