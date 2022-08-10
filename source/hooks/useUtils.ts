import { useCallback, useEffect, useState } from 'react';
import { useAlert } from 'react-alert';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';
import { getController } from 'utils/browser';

export const useUtils = () => {
  const alert = useAlert();
  const navigate = useNavigate();
  const controller = getController();
  const { activeAccount }: IVaultState = useSelector(
    (state: RootState) => state.vault
  );

  const handleRefresh = (silent?: boolean): void => {
    if (!activeAccount.address) return;

    controller.wallet.account.sys.getLatestUpdate(silent);
    controller.wallet.account.sys.watchMemPool();
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
    }, [isCopied, setIsCopied, timeout]);

    return [isCopied, staticCopy];
  };

  return {
    useCopyClipboard,
    alert,
    navigate,
    handleRefresh,
  };
};
