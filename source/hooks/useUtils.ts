import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';

import { useSafeNavigate } from './useSafeNavigate';

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
        toast.dismiss();
        setTimeout(() => toast(message, options), 0);
      },
      success: (message: string, options?: any) => {
        toast.dismiss();
        setTimeout(() => toast.success(message, options), 0);
      },
      error: (message: string, options?: any) => {
        toast.dismiss();
        setTimeout(() => toast.error(message, options), 0);
      },
      info: (message: string, options?: any) => {
        toast.dismiss();
        setTimeout(() => toast.info(message, options), 0);
      },
      warning: (message: string, options?: any) => {
        toast.dismiss();
        setTimeout(() => toast.warn(message, options), 0);
      },
    },
    navigate,
  };
};
