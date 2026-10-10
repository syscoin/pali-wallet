import { useMemo, useState } from 'react';

export const INITIAL_VISIBLE_ITEMS = 50;

/** Limit expensive row mounting without changing or filtering the underlying data. */
export const useIncrementalList = <T>(
  items: T[],
  context: string,
  initialCount = INITIAL_VISIBLE_ITEMS
) => {
  const restoredCount = Number.isFinite(initialCount)
    ? Math.max(INITIAL_VISIBLE_ITEMS, Math.floor(initialCount))
    : INITIAL_VISIBLE_ITEMS;
  const [page, setPage] = useState({ context, count: restoredCount });
  const count = page.context === context ? page.count : restoredCount;
  const visibleItems = useMemo(() => items.slice(0, count), [items, count]);
  return {
    visibleItems,
    visibleCount: count,
    hasMore: count < items.length,
    showMore: () => setPage({ context, count: count + INITIAL_VISIBLE_ITEMS }),
  };
};
