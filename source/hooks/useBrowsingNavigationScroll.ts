import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const MAX_HISTORY_SCROLL_ENTRIES = 40;
type HistoryScroll = {
  scrollPosition: number;
  scrollPositions: Record<string, number>;
};

/** Restore inner scroll panes after lazy content and bounded history replay render. */
export const useBrowsingNavigationScroll = (walletScope: string) => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const requestKey = JSON.stringify([
    location.pathname,
    location.search,
    location.hash,
    walletScope,
    location.state?.walletScope,
    location.state?.scrollPositions || {},
    location.state?.scrollPosition,
    location.state?.scrollRestorationKey,
  ]);
  const previousRequest = useRef<string>();
  const previousEntry = useRef<string>();
  // Browser POP does not carry a child's explicit returnContext. Keep only
  // bounded public viewport positions in this document, never wallet storage.
  const historyScroll = useRef(new Map<string, HistoryScroll>());
  const entry = JSON.stringify([walletScope, location.key]);
  const activeRestoreCleanup = useRef<() => void>();
  useEffect(() => {
    // Field/filter mirrors replace the current entry without opening a view.
    // Retain any pending lazy-content restoration across these updates too.
    const mirroredEntry =
      navigationType === 'REPLACE' && previousRequest.current === requestKey;
    previousRequest.current = requestKey;
    if (mirroredEntry && previousEntry.current) {
      const positions = historyScroll.current.get(previousEntry.current);
      historyScroll.current.delete(previousEntry.current);
      if (positions) historyScroll.current.set(entry, positions);
    }
    previousEntry.current = entry;
    if (mirroredEntry) return;
    activeRestoreCleanup.current?.();
    activeRestoreCleanup.current = undefined;
    const remembered =
      navigationType === 'POP' ? historyScroll.current.get(entry) : undefined;
    const targets =
      remembered?.scrollPositions || location.state?.scrollPositions;
    const windowTarget = remembered
      ? remembered.scrollPosition
      : location.state?.scrollPosition;
    if (
      location.state?.walletScope &&
      JSON.stringify(location.state.walletScope) !== walletScope
    )
      return;
    if (!targets && typeof windowTarget !== 'number') {
      document
        .querySelectorAll<HTMLElement>('[data-navigation-scroll]')
        .forEach((element) => {
          element.scrollTop = 0;
        });
      if (window.scrollY) window.scrollTo(0, 0);
      return;
    }
    let frame = 0;
    let cancelled = false;
    const deadline = Date.now() + 10_000;
    const pending = new Map<string, number>(
      Object.entries(targets || {})
        .filter(
          (position): position is [string, number] =>
            /^[\w-]{1,64}$/.test(position[0]) &&
            typeof position[1] === 'number' &&
            Number.isFinite(position[1]) &&
            position[1] >= 0 &&
            position[1] <= 10_000_000
        )
        .slice(0, 20)
    );
    const cleanup = () => {
      if (activeRestoreCleanup.current === cleanup)
        activeRestoreCleanup.current = undefined;
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      clearTimeout(timeout);
      document.removeEventListener('wheel', cleanup, true);
      document.removeEventListener('touchstart', cleanup, true);
      document.removeEventListener('pointerdown', cleanup, true);
      document.removeEventListener('keydown', cleanup, true);
    };
    const restore = () => {
      if (cancelled || Date.now() > deadline) return;
      for (const element of document.querySelectorAll<HTMLElement>(
        '[data-navigation-scroll]'
      )) {
        const key = element.dataset.navigationScroll!;
        const desired = pending.get(key);
        if (desired === undefined) continue;
        element.scrollTop = desired;
        if (Math.abs(element.scrollTop - desired) <= 1) pending.delete(key);
      }
      if (typeof windowTarget === 'number' && windowTarget > 0)
        window.scrollTo(0, windowTarget);
      if (!pending.size) cleanup();
    };
    const schedule = () => {
      if (cancelled || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        restore();
      });
    };
    const observer = new MutationObserver(schedule);
    const timeout = setTimeout(cleanup, 10_000);
    activeRestoreCleanup.current = cleanup;
    observer.observe(document.body, { childList: true, subtree: true });
    // A deliberate gesture takes precedence over pending restoration.
    document.addEventListener('wheel', cleanup, {
      capture: true,
      passive: true,
    });
    document.addEventListener('touchstart', cleanup, {
      capture: true,
      passive: true,
    });
    document.addEventListener('pointerdown', cleanup, true);
    document.addEventListener('keydown', cleanup, true);
    schedule();
  }, [entry, location.key, navigationType, requestKey]);
  useEffect(() => {
    const remember = () => {
      const scrollPositions: Record<string, number> = {};
      for (const element of document.querySelectorAll<HTMLElement>(
        '[data-navigation-scroll]'
      )) {
        const key = element.dataset.navigationScroll!;
        const top = element.scrollTop;
        if (
          Object.keys(scrollPositions).length < 20 &&
          /^[\w-]{1,64}$/.test(key) &&
          Number.isFinite(top) &&
          top >= 0 &&
          top <= 10_000_000
        )
          scrollPositions[key] = top;
      }
      const scrollPosition = window.scrollY;
      historyScroll.current.delete(entry);
      historyScroll.current.set(entry, {
        scrollPositions,
        scrollPosition:
          Number.isFinite(scrollPosition) &&
          scrollPosition >= 0 &&
          scrollPosition <= 10_000_000
            ? scrollPosition
            : 0,
      });
      while (historyScroll.current.size > MAX_HISTORY_SCROLL_ENTRIES)
        historyScroll.current.delete(
          historyScroll.current.keys().next().value!
        );
    };
    document.addEventListener('scroll', remember, true);
    return () => document.removeEventListener('scroll', remember, true);
  }, [entry]);
  useEffect(
    () => () => {
      activeRestoreCleanup.current?.();
      activeRestoreCleanup.current = undefined;
      previousRequest.current = undefined;
      previousEntry.current = undefined;
      historyScroll.current.clear();
    },
    []
  );
};
