import { useHistory } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useAlert } from 'react-alert';

export const useUtils = () => {
  const history = useHistory();
  
  const useSettingsView = () => {
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

  const getHost = (url: string) => {
    if (typeof url === 'string' && url !== '') {
      return new URL(url).host;
    }
  
    return url;
  };

  const sendMessage = (
    eventReceivedDetails: any,
    postMessageDetails: any
  ) => {
    return new Promise((resolve) => {
      const callback = (event: any) => {
        if (
          event.data.type === eventReceivedDetails.type &&
          event.data.target === eventReceivedDetails.target
        ) {
          resolve(
            eventReceivedDetails.freeze
              ? Object.freeze(event.data[eventReceivedDetails.eventResult])
              : event.data[eventReceivedDetails.eventResult]
          );
  
          window.removeEventListener('message', callback);
  
          return true;
        }
  
        return false;
      };
  
      window.addEventListener('message', callback);
  
      window.postMessage(postMessageDetails, '*');
    });
  };
  
  return {
    useSettingsView,
    useCopyClipboard,
    alert,
    getHost,
    history,
    sendMessage
  }
}