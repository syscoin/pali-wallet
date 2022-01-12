import { useAlert } from 'react-alert';
import { IAccountState } from 'state/wallet/types';
import { useHistory } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';

export const useUtils = (): any => {
  const history = useHistory();

  const useSettingsView = () =>
    useCallback((view) => {
      history.push(view);
    }, []);

  const handleRefresh = (controller: any, activeAccount: IAccountState) => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool(activeAccount);
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

  const alert = useAlert();

  const getHost = (url: string) => {
    if (typeof url === 'string' && url !== '') {
      return new URL(url).host;
    }

    return url;
  };

  const isNFT = (guid: number) => {
    const assetGuid = BigInt.asUintN(64, BigInt(guid));

    return assetGuid >> BigInt(32) > 0;
  };

  return {
    useSettingsView,
    useCopyClipboard,
    alert,
    getHost,
    history,
    handleRefresh,
    isNFT,
  };
};
