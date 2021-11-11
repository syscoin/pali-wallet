import { useHistory } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useAlert } from 'react-alert';

export const useUtils = () => {
  const useSettingsView = () => {
    const history = useHistory();
  
    return useCallback((view) => {
      history.push(view);
    }, []);
  }

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
      return undefined;
    }, [isCopied, setIsCopied, timeout]);
  
    return [isCopied, staticCopy];
  }

  const alert = useAlert();

  return {
    useSettingsView,
    useCopyClipboard,
    alert
  }
}