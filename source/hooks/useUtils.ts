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
    timeout = 1000
  ): [boolean, (toCopy: string) => Promise<void>] => {
    const [isCopied, setIsCopied] = useState<boolean>(false);
    const active = useRef(true);
    const copyRevision = useRef(0);
    const resetTimer = useRef<ReturnType<typeof setTimeout>>();

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
        const revision = ++copyRevision.current;
        clearTimeout(resetTimer.current);
        setIsCopied(false);
        let writing: Promise<void>;
        try {
          // Invoke within the user gesture, preserving clipboard activation.
          writing = Promise.resolve(navigator.clipboard.writeText(text));
        } catch (error) {
          writing = Promise.reject(error);
        }
        const result = writing.then(() => {
          if (!active.current || revision !== copyRevision.current) return;
          setIsCopied(true);
          resetTimer.current = setTimeout(() => {
            if (active.current && revision === copyRevision.current)
              setIsCopied(false);
          }, timeout);
        });
        // Observe the same returned promise, rather than swallowing its error:
        // fire-and-forget callers are safe, while awaited callers still reject.
        void result.catch(() => {
          if (!active.current || revision !== copyRevision.current) return;
          setIsCopied(false);
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
      [timeout]
    );

    return [isCopied, staticCopy];
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
      info: (message: string, options?: any) => {
        if (!shouldShowMessage(message, 'info')) return;
        toast.dismiss();
        setTimeout(() => toast.info(message, options), 0);
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
