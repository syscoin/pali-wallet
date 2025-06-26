import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button } from 'components/Button';
import { ChainIcon } from 'components/ChainIcon';
import { Icon } from 'components/Icon';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import store from 'state/store';
import { startConnecting, switchNetworkError } from 'state/vaultGlobal';

export const ChainErrorPage = () => {
  const { controllerEmitter } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networkTarget = useSelector(
    (state: RootState) => state.vaultGlobal.networkTarget
  );
  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );

  // Use the target network if we're trying to switch, otherwise use active network
  const displayNetwork = networkTarget || activeNetwork;

  const [isRetrying, setIsRetrying] = useState(false);

  // Auto-navigate back to home only when connection truly succeeds
  useEffect(() => {
    // Navigate away only if status is idle (successful) and we're not retrying
    if (networkStatus === 'idle' && !isRetrying) {
      console.log('[ChainErrorPage] Connection succeeded, navigating to home');
      navigate('/home');
    }
  }, [networkStatus, isRetrying, navigate]);

  const handleRetryToConnect = async () => {
    console.log('[ChainErrorPage] Retry clicked');
    setIsRetrying(true);

    // Always set connecting status to show loading states
    store.dispatch(startConnecting());

    try {
      // Force a non-polling update which will show skeletons
      await controllerEmitter(
        ['wallet', 'getLatestUpdateForCurrentAccount'],
        [false, true]
      );

      // If we get here, it succeeded - navigation handled by Redux state changes
    } catch (error) {
      console.error('[ChainErrorPage] Retry failed:', error);

      // Set error status so user stays on error page
      store.dispatch(switchNetworkError());

      // Show error message
      const errorMessage = error?.message || t('chainError.connectionTooLong');
      alert.error(errorMessage);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleConnectToAnotherRpc = () => {
    // Don't reset network status - it will trigger navigation to home
    // The switch network page can handle the status itself
    navigate('/switch-network', {
      state: { switchingFromTimeError: true },
    });
  };

  const CurrentChains = () => {
    // If we're not switching networks (just reconnecting), or if active and display are the same
    const isSameNetwork =
      !networkTarget ||
      (activeNetwork.chainId === displayNetwork.chainId &&
        activeNetwork.url === displayNetwork.url);

    if (isSameNetwork) {
      return (
        <div className="flex text-center items-center justify-center w-full">
          <div className="flex flex-col items-center gap-1">
            <ChainIcon
              chainId={Number(displayNetwork.chainId)}
              size={45}
              className=""
              fallbackClassName="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
            />
            <span className="text-xs text-gray-300 truncate max-w-[120px]">
              {displayNetwork.label}
            </span>
          </div>
        </div>
      );
    }

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
        <Icon name="arrowright" size={20} isSvg className="mx-2" />

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
    <div className="flex flex-col items-center justify-start min-h-full px-4 py-6 overflow-y-auto">
      <div className="flex flex-col items-center gap-4 w-full max-w-[22rem]">
        <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%] flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
        </div>
        <span className="text-sm font-normal text-white text-center">
          {t('chainError.connectionTooLong')}
        </span>
        <div className="rounded-[20px] bg-brand-blue500 p-5 w-full">
          <div className="relative flex mb-4">
            <CurrentChains />
          </div>

          <div className="flex flex-col mb-2">
            <div
              className="bg-brand-blue600 mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800 flex items-center justify-center"
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
        <div className="flex flex-col gap-2 mt-4 mb-4 w-full">
          <Button
            type="button"
            className="bg-white rounded-[100px] w-full h-[40px] text-brand-blue400 text-base font-medium disabled:opacity-60"
            onClick={handleConnectToAnotherRpc}
            disabled={isRetrying}
          >
            {t('chainError.goToAnotherNetwork')}
          </Button>
          <Button
            type="button"
            className="bg-white rounded-[100px] w-full h-[40px] text-brand-blue400 text-base font-medium disabled:opacity-60"
            onClick={handleRetryToConnect}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-brand-blue400 border-t-transparent"></div>
                <span>{t('buttons.retryConnect')}</span>
              </div>
            ) : (
              t('buttons.retryConnect')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
