import { useHistory } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'webextension-polyfill-ts';

export function useController() {
  const controller = browser.extension.getBackgroundPage().controller;

  if (controller) {
    return controller;
  }
  
  browser.runtime.reload();

  return controller;
}

export function useSettingsView() {
  const history = useHistory();

  return useCallback((view) => {
    history.push(view);
  }, []);
}

export function useCopyClipboard(
  timeout = 1000
): [boolean, (toCopy: string) => void] {
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
