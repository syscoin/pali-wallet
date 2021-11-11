import { useHistory } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'webextension-polyfill-ts';

export const useController = () => {
  return browser.extension.getBackgroundPage().controller;
}

export const useSettingsView = () => {
  const history = useHistory();

  return useCallback((view) => {
    history(view);
  }, []);
}

export const useCopyClipboard = (
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
