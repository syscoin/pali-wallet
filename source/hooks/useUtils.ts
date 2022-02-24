import { useAlert } from 'react-alert';
import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';

import { useAccount, useController } from '.';

export const isNFT = (guid: number): boolean => {
  const assetGuid = BigInt.asUintN(64, BigInt(guid));
  return assetGuid >> BigInt(32) > 0;
};

export const getHost = (url: string): string => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};

export const useUtils = () => {
  const alert = useAlert();
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
