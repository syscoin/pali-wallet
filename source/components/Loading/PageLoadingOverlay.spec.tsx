import React from 'react';

import {
  MAX_BLOCKING_LOADING_MS,
  PageLoadingOverlay,
} from './PageLoadingOverlay';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const elements = (node: React.ReactNode): React.ReactElement[] => {
  const result: React.ReactElement[] = [];
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    result.push(child, ...elements(child.props.children));
  });
  return result;
};

describe('bounded loading overlay', () => {
  let values: any[];
  let index: number;
  let effect: (() => void) | undefined;
  const render = (isLoading = true, nonBlocking = false) => {
    index = 0;
    return (PageLoadingOverlay as any).type({
      isLoading,
      message: 'Updating balances',
      nonBlocking,
    });
  };
  beforeEach(() => {
    jest.useFakeTimers();
    values = [];
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const key = index++;
      if (!(key in values)) values[key] = initial;
      return [
        values[key],
        (next: any) => {
          values[key] = next;
        },
      ] as any;
    });
    jest.spyOn(React, 'useEffect').mockImplementation((callback) => {
      if (!effect) effect = callback;
    });
    effect = undefined;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('replaces click-blocking backdrop with pointer-transparent progress at two seconds', () => {
    render();
    effect!();
    jest.advanceTimersByTime(500);
    expect(
      elements(render()).some((el) =>
        el.props.className?.includes('inset-0 z-50')
      )
    ).toBe(true);
    jest.advanceTimersByTime(MAX_BLOCKING_LOADING_MS - 500);
    const progress = render();
    expect(
      elements(progress).some((el) =>
        el.props.className?.includes('inset-0 z-50')
      )
    ).toBe(false);
    expect(progress.props.role).toBe('status');
    expect(progress.props.className).toContain('pointer-events-none');
  });

  it('shows service recovery without ever covering navigation', () => {
    const progress = render(true, true);
    expect(progress.props.role).toBe('status');
    expect(progress.props.className).toContain('pointer-events-none');
    expect(
      elements(progress).some((el) =>
        el.props.className?.includes('inset-0 z-50')
      )
    ).toBe(false);
  });

  it('removes all loading UI immediately when the operation settles', () => {
    render();
    effect!();
    jest.advanceTimersByTime(MAX_BLOCKING_LOADING_MS);
    expect(render(false)).toBeNull();
  });
});
