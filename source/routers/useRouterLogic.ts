import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import {
  removeVerifyPaliRequestListener,
  resetPaliRequestsCount,
  verifyPaliRequests,
} from 'scripts/Background/utils/bgActions';
import { rehydrateStore } from 'state/rehydrate';
import store, { RootState } from 'state/store';
import { SYSCOIN_UTXO_MAINNET_NETWORK } from 'utils/constants';

export const useRouterLogic = () => {
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setmodalMessage] = useState('');
  const [showUtf8ErrorModal, setShowUtf8ErrorModal] = useState(false);
  const [initialCheckComplete, setInitialCheckComplete] = useState(false);
  const { alert, navigate } = useUtils();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { isBitcoinBased, networkStatus, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { isUnlocked, web3Provider, isLoading } = useController();
  const { serverHasAnError, errorMessage } = web3Provider;

  const isNetworkChanging = networkStatus === 'switching';

  const utf8ErrorData = JSON.parse(
    window.localStorage.getItem('sysweb3-utf8Error') ??
      JSON.stringify({ hasUtf8Error: false })
  );

  const hasUtf8Error = utf8ErrorData?.hasUtf8Error ?? false;

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'getCurrentState' }).then((message) => {
      rehydrateStore(store, message.data);
    });

    function handleStateChange(message: any) {
      if (message.type === 'CONTROLLER_STATE_CHANGE') {
        rehydrateStore(store, message.data);
        return true;
      }
      return false;
    }

    chrome.runtime.onMessage.addListener(handleStateChange);

    return () => {
      chrome.runtime.onMessage.removeListener(handleStateChange);
    };
  }, []);

  useEffect(() => {
    if (isUnlocked) {
      setShowUtf8ErrorModal(hasUtf8Error);
    }
  }, [hasUtf8Error, isUnlocked]);

  useEffect(() => {
    // Don't navigate until we've completed the initial check
    if (isLoading) return;

    const canProceed = isUnlocked && accounts;

    if (canProceed) {
      navigate('/home');
      setInitialCheckComplete(true);
      return;
    }

    // Only check app route after initial loading is complete
    if (!initialCheckComplete) {
      controllerEmitter(['appRoute']).then((route) => {
        if (route !== '/') navigate(route);
        setInitialCheckComplete(true);
      });
    }
  }, [isUnlocked, isLoading, initialCheckComplete, accounts, navigate]);

  useEffect(() => {
    const isFullscreen = window.innerWidth > 600;
    if (isFullscreen) {
      navigate('/settings/account/hardware');
    }
  }, [navigate]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      if (isNetworkChanging) resetPaliRequestsCount();
      if (!isBitcoinBased) verifyPaliRequests();
      if (isBitcoinBased) removeVerifyPaliRequestListener();
    }
  }, [isBitcoinBased, isNetworkChanging]);

  useEffect(() => {
    alert.removeAll();
    const isFullscreen = window.innerWidth > 600;
    if (isFullscreen && isUnlocked) {
      navigate('/settings/account/hardware');
    }
  }, [pathname, isUnlocked, navigate, alert]);

  useEffect(() => {
    if (
      serverHasAnError &&
      isUnlocked &&
      !isBitcoinBased &&
      !isNetworkChanging
    ) {
      if (errorMessage !== 'string' && errorMessage?.code === -32016) {
        setmodalMessage(
          'The current RPC provider has a low rate-limit. We are applying a cooldown that will affect Pali performance. Modify the RPC URL in the network settings to resolve this issue.'
        );
      } else {
        setmodalMessage(
          'The RPC provider from network has an error. Pali performance may be affected. Modify the RPC URL in the network settings to resolve this issue.'
        );
      }
      setShowModal(true);
    }
  }, [serverHasAnError]);

  const handleUtf8ErrorClose = async () => {
    setShowUtf8ErrorModal(false);
    if (activeNetwork.chainId !== SYSCOIN_UTXO_MAINNET_NETWORK.chainId) {
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        [SYSCOIN_UTXO_MAINNET_NETWORK]
      );
    }

    controllerEmitter(['wallet', 'lock']);
    navigate('/');
  };

  const warningMessage = `Provider Error: ${
    errorMessage === 'string' || typeof errorMessage === 'undefined'
      ? errorMessage
      : errorMessage?.message
  }`;

  return {
    showModal,
    setShowModal,
    modalMessage,
    showUtf8ErrorModal,
    setShowUtf8ErrorModal,
    t,
    activeNetwork,
    handleUtf8ErrorClose,
    warningMessage,
    navigate,
  };
};
