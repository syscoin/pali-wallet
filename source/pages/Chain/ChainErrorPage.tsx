import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import loadImg from 'assets/icons/loading.svg';
import ethChainImg from 'assets/images/ethChain.svg';
import rolluxChainImg from 'assets/images/rolluxChain.png';
import sysChainImg from 'assets/images/sysChain.svg';
import { Button } from 'components/Button';
import { Header } from 'components/Header';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';

export const ChainErrorPage = () => {
  const { controllerEmitter } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networkTarget = useSelector(
    (state: RootState) => state.vault.networkTarget
  );
  const networkStatus = useSelector(
    (state: RootState) => state.vault.networkStatus
  );

  // Use the target network if we're trying to switch, otherwise use active network
  const displayNetwork = networkTarget || activeNetwork;

  const [isRetrying, setIsRetrying] = useState(false);

  // Auto-navigate back to home if network switch succeeds
  useEffect(() => {
    if (networkStatus === 'idle' && !networkTarget) {
      // Network switch completed successfully, go back to home
      console.log(
        'ChainErrorPage: Network switch completed, navigating to home'
      );
      navigate('/home');
    }
  }, [networkStatus, networkTarget, navigate]);

  const handleRetryToConnect = async () => {
    setIsRetrying(true);
    try {
      await controllerEmitter(['wallet', 'switchNetwork'], [displayNetwork]);
    } catch (error) {
      // Show the actual error message instead of generic one
      const errorMessage = error?.message || t('chainError.connectionTooLong');
      alert.error(errorMessage);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCancelSwitch = async () => {
    try {
      // Reset network status and navigate back to home
      await controllerEmitter(['wallet', 'resetNetworkStatus'], []);
      navigate('/home');
    } catch (error) {
      console.error('Failed to reset network status:', error);
      navigate('/home'); // Navigate anyway
    }
  };

  const handleConnectToAnotherRpc = () =>
    navigate('/switch-network', {
      state: { switchingFromTimeError: true },
    });

  const CurrentChains = () => {
    let toChain: React.ReactNode;

    switch (displayNetwork.chainId) {
      case 1:
        toChain = <img src={ethChainImg} alt="eth" width="39px" />;
        break;
      case 57:
        toChain = <img src={sysChainImg} alt="sys" width="39px" />;
        break;
      case 570:
        toChain = <img src={rolluxChainImg} alt="sys" width="39px" />;
        break;
      case 5700:
        toChain = <img src={rolluxChainImg} alt="sys" width="39px" />;
        break;
      default:
        toChain = (
          <div
            className="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
            style={{ width: '39px', height: '39px' }}
          >
            {displayNetwork.currency}
          </div>
        );
    }

    return (
      <div className="gap-4 flex items-center align-center flex-row">
        {toChain}
      </div>
    );
  };

  return (
    <>
      <Header />
      <div className="gap-4 mt-6 mb-7 w-full flex flex-col justify-center items-center">
        <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]'">
          <img src={loadImg} />
        </div>
        <span className="text-sm font-normal text-white text-center">
          {t('chainError.connectionTooLong')}
        </span>
        <div className="rounded-[20px] bg-brand-blue500 p-5 h-max w-[22rem]">
          <div className="relative flex mb-4">
            <CurrentChains />
            <div className="flex flex-col ml-3">
              <h1 className="text-xs font-light text-white">
                {t('chainError.tryingToConnectOn')}
              </h1>
              <h1 className="text-lg font-bold text-white">
                {displayNetwork.label}
              </h1>
            </div>
          </div>
          <div className="flex flex-col mb-2">
            <div
              className={`bg-brand-blue600 mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800`}
              onClick={() =>
                navigate('/settings/networks/custom-rpc', {
                  state: {
                    selected: displayNetwork,
                    chain: displayNetwork.chainId,
                    isDefault: displayNetwork.default,
                    isEditing: true,
                  },
                })
              }
            >
              {t('chainError.editCurrentRpc')}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 mt-6">
          <Button
            type="submit"
            className="bg-white rounded-[100px] w-[13.25rem] h-[40px] text-brand-blue400 text-base font-medium"
            onClick={handleConnectToAnotherRpc}
          >
            {t('chainError.goToAnotherNetwork')}
          </Button>
          <Button
            loading={isRetrying}
            type="submit"
            className="bg-white rounded-[100px] w-[13.25rem] h-[40px] text-brand-blue400 text-base font-medium"
            onClick={handleRetryToConnect}
          >
            {t('buttons.retryConnect')}
          </Button>
          <Button
            type="submit"
            className="bg-gray-500 rounded-[100px] w-[13.25rem] h-[40px] text-white text-base font-medium"
            onClick={handleCancelSwitch}
          >
            {t('buttons.cancel')}
          </Button>
        </div>
      </div>
    </>
  );
};
