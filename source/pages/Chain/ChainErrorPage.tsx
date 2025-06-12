import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import arrowRight from 'assets/images/arrowRight.svg';
import { Button } from 'components/Button';
import { ChainIcon } from 'components/ChainIcon';
import { Header } from 'components/Header';
import { LoadingSvg } from 'components/Icon/Icon';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import store from 'state/store';
import { resetNetworkStatus } from 'state/vault';

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

  // Auto-navigate back to home if we successfully switched to the target network
  useEffect(() => {
    if (
      networkStatus === 'idle' &&
      !networkTarget &&
      displayNetwork &&
      activeNetwork.chainId === displayNetwork.chainId &&
      activeNetwork.url === displayNetwork.url
    ) {
      // Network switch completed successfully to our target, go back to home
      console.log(
        'ChainErrorPage: Network switch to target completed, navigating to home'
      );
      navigate('/home');
    }
  }, [networkStatus, networkTarget, activeNetwork, displayNetwork, navigate]);

  const handleRetryToConnect = async () => {
    setIsRetrying(true);
    try {
      // First, reset the network status to clear any stuck states
      store.dispatch(resetNetworkStatus());

      // Small delay to ensure state is cleared
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now attempt to switch networks again
      await controllerEmitter(['wallet', 'setActiveNetwork'], [displayNetwork]);

      // Success! Navigation will happen automatically via useEffect
      // when the activeNetwork matches our displayNetwork target
    } catch (error) {
      console.error('Network retry failed:', error);

      // Show the actual error message instead of generic one
      const errorMessage = error?.message || t('chainError.connectionTooLong');
      alert.error(errorMessage);

      // Reset network status on error to allow future retries
      store.dispatch(resetNetworkStatus());
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCancelSwitch = async () => {
    try {
      // Reset network status to clear switching state
      store.dispatch(resetNetworkStatus());

      // Small delay to ensure state is cleared
      await new Promise((resolve) => setTimeout(resolve, 100));

      navigate('/home');
    } catch (error) {
      console.error('Failed to cancel network switch:', error);
      navigate('/home'); // Navigate anyway
    }
  };

  const handleConnectToAnotherRpc = () => {
    // Reset network status before navigating
    store.dispatch(resetNetworkStatus());

    navigate('/switch-network', {
      state: { switchingFromTimeError: true },
    });
  };

  const CurrentChains = () => {
    // Show current network on the left and target network on the right
    const fromChain = (
      <ChainIcon
        chainId={Number(activeNetwork.chainId)}
        size={45}
        className=""
        fallbackClassName="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
      />
    );

    const toChain = (
      <ChainIcon
        chainId={Number(displayNetwork.chainId)}
        size={45}
        className=""
        fallbackClassName="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
      />
    );

    return (
      <div className="flex text-center gap-3 items-center justify-center w-full">
        {/* Current network */}
        <div className="flex flex-col items-center gap-1">
          {fromChain}
          <span className="text-xs text-gray-300 truncate max-w-[80px]">
            {activeNetwork.label}
          </span>
        </div>

        {/* Arrow */}
        <img src={arrowRight} alt="arrow" width="20px" className="mx-2" />

        {/* Target network */}
        <div className="flex flex-col items-center gap-1">
          {toChain}
          <span className="text-xs text-gray-300 truncate max-w-[80px]">
            {displayNetwork.label}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <Header />
      <div className="gap-4 mt-6 mb-7 w-full flex flex-col justify-center items-center">
        <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]'">
          <LoadingSvg />
        </div>
        <span className="text-sm font-normal text-white text-center">
          {t('chainError.connectionTooLong')}
        </span>
        <div className="rounded-[20px] bg-brand-blue500 p-5 h-max w-[22rem]">
          <div className="relative flex mb-4">
            <CurrentChains />
          </div>

          <div className="flex flex-col mb-2">
            <div
              className={`bg-brand-blue600 mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800 flex items-center justify-center`}
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
          <div className="text-xs text-gray-300 text-center">
            {t('networkConnection.mayBeRateLimited')}
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
