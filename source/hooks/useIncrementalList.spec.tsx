/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';

import { useIncrementalList } from './useIncrementalList';

it('restores loaded rows and starts a new account/filter at its own count', () => {
  const items = Array.from({ length: 150 }, (_, id) => id);
  const { result, rerender } = renderHook(
    ({ context, count }) => useIncrementalList(items, context, count),
    { initialProps: { context: 'account-a:tokens', count: 100 } }
  );
  expect(result.current.visibleItems).toHaveLength(100);
  act(() => result.current.showMore());
  expect(result.current.visibleItems).toHaveLength(150);
  expect(result.current.visibleCount).toBe(150);
  rerender({ context: 'account-b:tokens', count: 50 });
  expect(result.current.visibleItems).toHaveLength(50);
  expect(result.current.hasMore).toBe(true);
});

it.each([NaN, Infinity, -1])(
  'bounds malformed restored counts (%s)',
  (count) => {
    const { result } = renderHook(() =>
      useIncrementalList([1, 2], 'scope', count)
    );
    expect(result.current.visibleCount).toBe(50);
    expect(result.current.visibleItems).toEqual([1, 2]);
  }
);
