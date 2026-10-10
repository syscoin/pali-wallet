import { SetStateAction, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useHomeBrowsingState } from '../../../useHomeBrowsingState';
import { useContextualState } from 'hooks/useContextualState';

const historyPages = new Map<string, any[]>();
const MAX_RETAINED_LISTS = 8;
const MAX_RETAINED_ROWS = 2000;
const MAX_RESTORED_PAGES = 5;
const RESTORE_DEADLINE_MS = 10_000;

export interface IHistoryPage<T> {
  hasMore: boolean;
  rows: T[];
}

interface IHistoryView {
  cacheKey: string;
  hasMoreServer: boolean;
  nextPage: number;
  restoreThroughPage?: number;
  visibleCount: number;
}

/** Fetched public rows stay in memory; navigation metadata stores only their cache key. */
export const useHistoryBrowsingState = <T>(
  scope: string,
  hasMoreInitially: boolean,
  fetchPage?: (page: number) => Promise<IHistoryPage<T>>
) => {
  const location = useLocation();
  const saved = location.state?.homeActivity;
  const restored = saved?.scope === scope ? saved.value : undefined;
  const cacheKey = restored?.cacheKey || `${Date.now()}:${Math.random()}`;
  const [view, setView] = useHomeBrowsingState<IHistoryView>(
    'homeActivity',
    scope,
    {
      cacheKey,
      hasMoreServer: hasMoreInitially,
      nextPage: 2,
      visibleCount: 50,
    }
  );
  const [extraTransactions, setExtraTransactions] = useContextualState<T[]>(
    scope,
    historyPages.get(view.cacheKey) || []
  );
  const updateRows = (update: SetStateAction<T[]>) =>
    setExtraTransactions((previous) => {
      const rows = typeof update === 'function' ? update(previous) : update;
      if (
        !historyPages.has(view.cacheKey) &&
        historyPages.size >= MAX_RETAINED_LISTS
      ) {
        const oldest = historyPages.keys().next().value;
        if (oldest !== undefined) historyPages.delete(oldest);
      }
      if (rows.length <= MAX_RETAINED_ROWS)
        historyPages.set(view.cacheKey, rows);
      else historyPages.delete(view.cacheKey);
      return rows;
    });

  const setField =
    <K extends keyof IHistoryView>(key: K) =>
    (update: SetStateAction<IHistoryView[K]>) =>
      setView((previous) => ({
        ...previous,
        [key]:
          typeof update === 'function'
            ? (update as (value: IHistoryView[K]) => IHistoryView[K])(
                previous[key]
              )
            : update,
      }));

  const [isRestoringPages, setIsRestoringPages] = useContextualState(
    scope,
    false
  );

  useEffect(() => {
    const hasCachedRows = historyPages.has(view.cacheKey);
    const desiredLastPage = view.restoreThroughPage || view.nextPage - 1;
    if (
      !fetchPage ||
      desiredLastPage < 2 ||
      (hasCachedRows && !view.restoreThroughPage)
    )
      return;
    let current = true;
    const firstPage = hasCachedRows ? view.nextPage : 2;
    const lastPage = Math.min(
      desiredLastPage,
      firstPage + MAX_RESTORED_PAGES - 1
    );
    const deadline = Date.now() + RESTORE_DEADLINE_MS;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setIsRestoringPages(true);
    // Load More must resume at the first missing page if replay stops early.
    setView((previous) => ({
      ...previous,
      nextPage: firstPage,
      restoreThroughPage: lastPage,
      hasMoreServer: true,
    }));

    const replay = async () => {
      try {
        for (let page = firstPage; current && page <= lastPage; page += 1) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          const result = await Promise.race([
            fetchPage(page),
            new Promise<null>((resolve) => {
              timeout = setTimeout(() => resolve(null), remaining);
            }),
          ]);
          if (timeout) clearTimeout(timeout);
          if (!current || !result) break;
          if (!result.rows.length) {
            setView((previous) => ({ ...previous, hasMoreServer: false }));
            break;
          }
          updateRows((previous) => [...previous, ...result.rows]);
          setView((previous) => ({
            ...previous,
            nextPage: page + 1,
            hasMoreServer: result.hasMore,
          }));
          if (!result.hasMore) break;
        }
      } catch {
        // Keep the recovered pages and the exact next page for a manual retry.
      } finally {
        if (current) {
          setView((previous) => ({
            ...previous,
            restoreThroughPage: undefined,
          }));
          setIsRestoringPages(false);
        }
      }
    };
    void replay();
    return () => {
      current = false;
      if (timeout) clearTimeout(timeout);
    };
    // Scope changes cancel this replay; progress updates must not restart it.
  }, [scope, view.cacheKey, fetchPage]);

  return {
    extraTransactions,
    setExtraTransactions: updateRows,
    isRestoringPages,
    ...view,
    setVisibleCount: setField('visibleCount'),
    setNextPage: setField('nextPage'),
    setHasMoreServer: setField('hasMoreServer'),
  };
};
