import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { INetworkType } from '@pollum-io/sysweb3-network';

import { NeutralButton } from 'components/Button';
import { ChainIcon } from 'components/ChainIcon';
import { Icon } from 'components/Icon';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import store, { RootState } from 'state/store';
import { switchNetworkError, resetNetworkStatus } from 'state/vaultGlobal';

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

  // Use the target network if we're trying to switch, otherwise use active network
  const displayNetwork = networkTarget || activeNetwork;

  const [isRetrying, setIsRetrying] = useState(false);

  // Always set error state when this page mounts
  useEffect(() => {
    console.log('[ChainErrorPage] Setting network status to error');
    store.dispatch(switchNetworkError());
  }, []); // Empty deps - only run on mount

  const handleRetryToConnect = async () => {
    console.log('[ChainErrorPage] Retry clicked');
    setIsRetrying(true);

    // Clear any previous error state to ensure a fresh retry
    store.dispatch(resetNetworkStatus());

    try {
      const networkToUse = displayNetwork;

      // Get the RPC from global state in case it was edited
      const globalNetworks = store.getState().vaultGlobal.networks;
      const networkType =
        networkToUse.kind === INetworkType.Syscoin ? 'syscoin' : 'ethereum';
      const networkFromGlobal =
        globalNetworks[networkType][networkToUse.chainId];

      // Use the RPC from global state if it exists (could have been edited)
      const selectedRpc = networkFromGlobal || networkToUse;

      console.log('[ChainErrorPage] Switching to network:', selectedRpc.label);

      // Call setActiveNetwork and wait for it to fully complete
      // This method handles all validation internally and resolves when done
      // Pass true for syncUpdates to ensure all updates complete before returning
      const result = await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        [selectedRpc, true]
      );

      console.log(
        '[ChainErrorPage] Network switch completed successfully:',
        result
      );

      // Check if the network is actually working by checking the status
      const finalNetworkStatus = store.getState().vaultGlobal.networkStatus;
      if (finalNetworkStatus === 'error') {
        console.log(
          '[ChainErrorPage] Network is still in error state, not navigating'
        );
        setIsRetrying(false);
        // Show error alert to user
        alert.error(t('chainError.connectionError'));
        return;
      }

      // If we get here, everything succeeded - navigate to home
      alert.success(t('networkConnection.operationCompleted'));
      setIsRetrying(false);
      navigate('/home');
    } catch (error) {
      console.error('[ChainErrorPage] Retry failed:', error);

      // Set error status so user stays on error page
      store.dispatch(switchNetworkError());

      // Show error message with specific handling for timeouts
      let errorMessage = t('chainError.connectionTooLong');

      if (error?.message) {
        if (
          error.message.includes('Network request timed out') ||
          error.message.includes('RPC request timeout') ||
          error.message.includes('timeout')
        ) {
          errorMessage = t('chainError.networkTimeout');
        } else if (
          error.message.includes('parse error') ||
          error.message.includes('JSON') ||
          error.message.includes('Unexpected end of JSON input')
        ) {
          errorMessage = t('chainError.invalidResponse');
        } else if (
          error.message.includes('Failed to fetch') ||
          error.message.includes('Network error')
        ) {
          errorMessage = t('chainError.connectionError');
        } else {
          errorMessage = error.message;
        }
      }

      alert.error(errorMessage);

      // Reset retry state so user can try again
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
    // If we're not switching networks (just reconnecting), or if we're switching to the same chain
    // Only show two icons if we're actually switching to a different chain
    const isSameChain =
      !networkTarget || activeNetwork.chainId === displayNetwork.chainId;

    if (isSameChain) {
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
          <NeutralButton
            type="button"
            onClick={handleConnectToAnotherRpc}
            disabled={isRetrying}
            fullWidth
          >
            {t('chainError.goToAnotherNetwork')}
          </NeutralButton>
          <NeutralButton
            type="button"
            onClick={handleRetryToConnect}
            disabled={isRetrying}
            loading={isRetrying}
            fullWidth
          >
            {t('buttons.retryConnect')}
          </NeutralButton>
        </div>
      </div>
    </div>
  );
};
