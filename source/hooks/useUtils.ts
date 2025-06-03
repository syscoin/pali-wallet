import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

export const useUtils = () => {
  const navigate = useNavigate();

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
      show: toast,
      success: toast.success,
      error: toast.error,
      info: toast.info,
      warning: toast.warn,
      removeAll: toast.dismiss,
    },
    navigate,
  };
};
