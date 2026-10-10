import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Restore inner scroll panes after lazy content and bounded history replay render. */
export const useBrowsingNavigationScroll = (walletScope: string) => {
  const location = useLocation();
  const positionsKey = JSON.stringify(location.state?.scrollPositions || {});
  const windowPosition = location.state?.scrollPosition;
  useEffect(() => {
    const targets = location.state?.scrollPositions;
    const windowTarget = location.state?.scrollPosition;
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
          (entry): entry is [string, number] =>
            /^[\w-]{1,64}$/.test(entry[0]) &&
            typeof entry[1] === 'number' &&
            Number.isFinite(entry[1]) &&
            entry[1] >= 0 &&
            entry[1] <= 10_000_000
        )
        .slice(0, 20)
    );
    const cleanup = () => {
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
    return cleanup;
  }, [location.pathname, positionsKey, windowPosition, walletScope]);
};
