import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { startInactivityTimer } from 'scripts/Background/events/InactivityTimer';
import {
  removeVerifyPaliRequestListener,
  resetPaliRequestsCount,
  verifyPaliRequests,
} from 'scripts/Background/utils/updateRequestsPerSecond';
import { rehydrateStore } from 'state/rehydrate';
import store, { RootState } from 'state/store';
import { SYS_UTXO_MAINNET_NETWORK } from 'utils/constants';

export const useRouterLogic = () => {
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setmodalMessage] = useState('');
  const [showUtf8ErrorModal, setShowUtf8ErrorModal] = useState(false);
  const { alert, navigate } = useUtils();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const {
    timer,
    isTimerEnabled,
    isBitcoinBased,
    isNetworkChanging,
    activeNetwork,
  } = useSelector((state: RootState) => state.vault);
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { web3Provider } = useController();
  const { serverHasAnError, errorMessage } = web3Provider;

  const utf8ErrorData = JSON.parse(
    window.localStorage.getItem('sysweb3-utf8Error') ??
      JSON.stringify({ hasUtf8Error: false })
  );

  const hasUtf8Error = utf8ErrorData?.hasUtf8Error ?? false;

  useEffect(() => {
    function handleStateChange(message: any) {
      if (message.type === 'CONTROLLER_STATE_CHANGE') {
        rehydrateStore(store, message.data);
      }
    }

    chrome.runtime.onMessage.addListener(handleStateChange);

    return () => {
      chrome.runtime.onMessage.removeListener(handleStateChange);
    };
  }, []);

  useEffect(() => {
    if (accounts) {
      setShowUtf8ErrorModal(hasUtf8Error);
    }
  }, [hasUtf8Error, accounts]);

  useEffect(() => {
    const canProceed = accounts;

    if (canProceed) {
      navigate('/home');
      return;
    }

    controllerEmitter(['appRoute']).then((route) => {
      if (route !== '/') navigate(route);
    });
  }, [accounts]);

  useEffect(() => {
    if (isTimerEnabled) startInactivityTimer(timer);
  }, [isTimerEnabled, timer]);

  useEffect(() => {
    const isFullscreen = window.innerWidth > 600;
    if (isFullscreen) {
      navigate('/settings/account/hardware');
    }
  }, []);

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
    if (isFullscreen && accounts) {
      navigate('/settings/account/hardware');
    }
  }, [pathname, accounts]);

  useEffect(() => {
    if (serverHasAnError && accounts && !isBitcoinBased && !isNetworkChanging) {
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
    if (activeNetwork.chainId !== SYS_UTXO_MAINNET_NETWORK.chainId) {
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        [SYS_UTXO_MAINNET_NETWORK, 'syscoin']
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
