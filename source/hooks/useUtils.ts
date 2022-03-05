import { useAlert } from 'react-alert';
import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';

import { useAccount, useController } from '.';

export const useUtils = (): any => {
  const navigate = useNavigate();
  const controller = useController();
  const { activeAccount } = useAccount();

  const useSettingsView = () =>
    useCallback((view) => {
      navigate(view);
    }, []);

  const handleRefresh = (): void => {
    controller.wallet.account.getLatestUpdate();
    if (activeAccount) controller.wallet.account.watchMemPool(activeAccount);
    controller.stateUpdater();
  };
  // eslint-disable-next-line no-shadow
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
  };

  const alert = useAlert();

  // eslint-disable-next-line no-shadow
  const getHost = (url: string) => {
    if (typeof url === 'string' && url !== '') {
      return new URL(url).host;
    }

    return url;
  };

  // eslint-disable-next-line no-shadow
  const isNFT = (guid: number) => {
    const assetGuid = BigInt.asUintN(64, BigInt(guid));

    return assetGuid >> BigInt(32) > 0;
  };

  return {
    useSettingsView,
    useCopyClipboard,
    alert,
    getHost,
    navigate,
    handleRefresh,
    isNFT,
  };
};

export const isNFT = (guid: number) => {
  const assetGuid = BigInt.asUintN(64, BigInt(guid));

  return assetGuid >> BigInt(32) > 0;
};

export const getHost = (url: string) => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};

export const useCopyClipboard = (
  timeout = 1000
): [boolean, (toCopy: string) => void] => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const staticCopy = useCallback(async (text) => {
    await navigator?.clipboard?.writeText(text);
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
};
