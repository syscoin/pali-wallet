import i18next from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { useSafeNavigate } from './useSafeNavigate';

// Track last shown messages to prevent duplicates
const lastShownMessages = new Map<string, number>();
const DEDUP_TIMEOUT = 2000; // 2 seconds

const shouldShowMessage = (message: string, type: string): boolean => {
  const key = `${type}:${message}`;
  const now = Date.now();
  const lastShown = lastShownMessages.get(key);

  if (lastShown && now - lastShown < DEDUP_TIMEOUT) {
    return false; // Skip duplicate message
  }

  lastShownMessages.set(key, now);

  // Clean up old entries
  for (const [msgKey, time] of lastShownMessages.entries()) {
    if (now - time > DEDUP_TIMEOUT * 2) {
      lastShownMessages.delete(msgKey);
    }
  }

  return true;
};

export const useUtils = () => {
  const navigate = useSafeNavigate();

  const useCopyClipboard = (
    timeout = 1000,
    scope?: string
  ): [boolean, (toCopy: string) => Promise<void>, () => boolean] => {
    const [copiedRevision, setCopiedRevision] = useState<number | null>(null);
    const active = useRef(true);
    const copyRevision = useRef(0);
    const context = useRef({ scope, revision: 0 });
    const resetTimer = useRef<ReturnType<typeof setTimeout>>();
    // Invalidate during render, before an old promise or passive effect can
    // publish into the next context. The epoch also rejects A -> B -> A.
    if (context.current.scope !== scope) {
      context.current = { scope, revision: context.current.revision + 1 };
      copyRevision.current += 1;
    }
    const scopeRevision = context.current.revision;

    // The indicator and its timer belong to the latest copy, not whichever
    // browser promise happens to resolve last.
    useEffect(() => {
      active.current = true;
      return () => {
        active.current = false;
        copyRevision.current += 1;
        clearTimeout(resetTimer.current);
      };
    }, []);

    const staticCopy = useCallback(
      (text: string) => {
        if (scopeRevision !== context.current.revision)
          return Promise.resolve();
        const revision = ++copyRevision.current;
        clearTimeout(resetTimer.current);
        setCopiedRevision(null);
        let writing: Promise<void>;
        try {
          // Invoke within the user gesture, preserving clipboard activation.
          writing = Promise.resolve(navigator.clipboard.writeText(text));
        } catch (error) {
          writing = Promise.reject(error);
        }
        const result = writing.then(() => {
          if (!active.current || revision !== copyRevision.current) return;
          setCopiedRevision(revision);
          resetTimer.current = setTimeout(() => {
            if (active.current && revision === copyRevision.current)
              setCopiedRevision(null);
          }, timeout);
        });
        // Observe the same returned promise, rather than swallowing its error:
        // fire-and-forget callers are safe, while awaited callers still reject.
        void result.catch(() => {
          if (!active.current || revision !== copyRevision.current) return;
          setCopiedRevision(null);
          const message = i18next.t('transactions.copyFailed', {
            defaultValue: 'Could not copy to clipboard. Please try again.',
          });
          resetTimer.current = setTimeout(() => {
            if (!active.current || revision !== copyRevision.current) return;
            if (!shouldShowMessage(message, 'error')) return;
            // Replace an optimistic legacy notice only after queued notices
            // have been inserted. Never log or include clipboard contents.
            toast.dismiss();
            toast.error(message);
          }, 0);
        });
        return result;
      },
      [timeout, scopeRevision]
    );

    const isCurrentCopy = () =>
      active.current && copiedRevision === copyRevision.current;
    return [isCurrentCopy(), staticCopy, isCurrentCopy];
  };

  return {
    useCopyClipboard,
    alert: {
      show: (message: string, options?: any) => {
        if (!shouldShowMessage(message, 'default')) return;
        toast.dismiss();
        setTimeout(() => toast(message, options), 0);
      },
      success: (message: string, options?: any) => {
        if (!shouldShowMessage(message, 'success')) return;
        toast.dismiss();
        setTimeout(() => toast.success(message, options), 0);
      },
      error: (message: string, options?: any) => {
        if (!shouldShowMessage(message, 'error')) return;
        toast.dismiss();
        setTimeout(() => toast.error(message, options), 0);
      },
      info: (message: string, options?: any, isCurrent?: () => boolean) => {
        if (isCurrent && !isCurrent()) return;
        if (!isCurrent && !shouldShowMessage(message, 'info')) return;
        if (!isCurrent) toast.dismiss();
        setTimeout(() => {
          if (
            isCurrent &&
            (!isCurrent() || !shouldShowMessage(message, 'info'))
          )
            return;
          if (isCurrent) toast.dismiss();
          toast.info(message, options);
        }, 0);
      },
      warning: (message: string, options?: any) => {
        if (!shouldShowMessage(message, 'warning')) return;
        toast.dismiss();
        setTimeout(() => toast.warn(message, options), 0);
      },
    },
    navigate,
  };
};
