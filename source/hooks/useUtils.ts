import { useCallback, useEffect, useState } from 'react';
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
  ): [boolean, (toCopy: string) => void] => {
    const [isCopied, setIsCopied] = useState<boolean>(false);

    const staticCopy = useCallback(async (text) => {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
    }, []);

    useEffect(() => {
      if (isCopied) {
        const hide = setTimeout(() => {
          setIsCopied(false);
        }, timeout);

        return () => {
          clearTimeout(hide);
        };
      }
    }, [isCopied, setIsCopied, timeout]);

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
