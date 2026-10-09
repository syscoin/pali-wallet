import { useMemo, useState } from 'react';

export const INITIAL_VISIBLE_ITEMS = 50;

/** Limit expensive row mounting without changing or filtering the underlying data. */
export const useIncrementalList = <T>(items: T[], context: string) => {
  const [page, setPage] = useState({ context, count: INITIAL_VISIBLE_ITEMS });
  const count = page.context === context ? page.count : INITIAL_VISIBLE_ITEMS;
  const visibleItems = useMemo(() => items.slice(0, count), [items, count]);
  return {
    visibleItems,
    hasMore: count < items.length,
    showMore: () => setPage({ context, count: count + INITIAL_VISIBLE_ITEMS }),
  };
};
