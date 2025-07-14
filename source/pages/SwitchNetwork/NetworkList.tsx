import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import { NeutralButton } from 'components/Button';
import { ChainIcon } from 'components/ChainIcon';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';
import { getChainIdPriority } from 'utils/chainIdPriority';

import { useNetworkInfo } from './NetworkInfo';

type currentNetwork = {
  current: INetwork;
};

interface INetworkListProps {
  disabledNetworkType?: string;
  forceNetworkType?: string;
  isTypeSwitch?: boolean;
}

export const NetworkList = ({
  disabledNetworkType,
  forceNetworkType,
  isTypeSwitch,
}: INetworkListProps) => {
  const { controllerEmitter } = useController();
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { t } = useTranslation();
  const { networks } = useSelector((state: RootState) => state.vaultGlobal);

  const { navigate, alert } = useUtils();

  // Get query data for external popup handling
  const queryData = useQueryData();
  const { host, eventName } = queryData;

  const [selectCurrentNetwork, setSelectCurrentNetwork] =
    useState<currentNetwork>();
  const [selectedNetwork, setSelectedNetwork] = useState<INetworkType>(() => {
    // If this is a type switch, force the target network type
    if (isTypeSwitch && forceNetworkType) {
      return forceNetworkType === 'ethereum'
        ? INetworkType.Ethereum
        : INetworkType.Syscoin;
    }
    // Otherwise use current network type
    return isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum;
  });
  const [isLoading, setIsLoading] = useState(false);

  // Set the initial selected network to the current active network
  React.useEffect(() => {
    if (activeNetwork && !selectCurrentNetwork) {
      setSelectCurrentNetwork({ current: activeNetwork });
    }
  }, [activeNetwork, selectCurrentNetwork]);

  const {
    networkThatNeedsChanging,
    networkDescription,
    selectedNetworkText,
    leftLogo,
    rightLogo,
  } = useNetworkInfo({ isBitcoinBased, selectedNetwork });

  // Check if tabs should be disabled
  const isUtxoDisabled = disabledNetworkType === 'syscoin';
  const isEvmDisabled = disabledNetworkType === 'ethereum';

  const seletedEvmButtonStyle =
    selectedNetwork === INetworkType.Ethereum ? 'opacity-100' : 'opacity-60';

  const seletedUtxoButtonStyle =
    selectedNetwork === INetworkType.Syscoin ? 'opacity-100' : 'opacity-60';

  const handleChangeNetwork = async (network: INetwork) => {
    try {
      setIsLoading(true);

      // Remove the timeout race condition - let the network switch take as long as it needs
      // The user can always navigate away or try a different network if it's taking too long
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        [network, isTypeSwitch]
      ); // syncUpdates: true

      // Reset loading state on success
      setIsLoading(false);
      if (isTypeSwitch) {
        // Then dispatch the background event
        if (host && eventName) {
          dispatchBackgroundEvent(`${eventName}.${host}`, { success: true });
        }
        window.close();
        return;
      }

      // Navigate only after successful network change for regular navigation
      navigate('/home');
    } catch (networkError) {
      console.error('Network change failed:', networkError);
      setIsLoading(false);

      // Get the error message
      const errorMessage = networkError?.message || 'Network change failed';

      // Ignore cancellation errors - these happen when switching networks rapidly
      // The new switch will continue in the background
      if (errorMessage === 'Network change cancelled') {
        console.log(
          'Previous network switch cancelled, new switch in progress'
        );
        return;
      }

      // Show appropriate error message based on the type of error
      if (
        errorMessage.includes('timeout') ||
        errorMessage.includes('timed out')
      ) {
        alert.error(
          `Network connection timed out. The network might be slow or unresponsive.`
        );
      } else if (
        errorMessage.includes('rate limit') ||
        errorMessage.includes('429')
      ) {
        alert.error(
          `The network is rate limiting requests. Please wait a moment and try again.`
        );
      } else {
        alert.error(errorMessage);
      }

      // Don't navigate away on error, let user try again
    }
  };

  const newNetworks = useMemo(
    () =>
      // Always show networks based on selectedNetwork to allow switching between UTXO and EVM
      selectedNetwork === INetworkType.Syscoin
        ? Object.values(networks.syscoin)
        : Object.values(networks.ethereum),
    [selectedNetwork, networks]
  );

  const sortedNetworks = useMemo(
    () =>
      newNetworks.sort(
        (a, b) => getChainIdPriority(a.chainId) - getChainIdPriority(b.chainId)
      ),
    [newNetworks]
  );

  return (
    <div className="mb-14">
      {/* Always show network type tabs so users can switch between UTXO and EVM */}
      <div className="flex pl-[20px] gap-2">
        <div
          className={`bg-brand-blue500 text-base text-white ${seletedUtxoButtonStyle} px-[19px] py-2 rounded-t-[20px] ${
            isUtxoDisabled
              ? 'opacity-30 cursor-not-allowed'
              : 'cursor-pointer hover:bg-brand-blue800'
          }`}
          onClick={() => {
            if (!isUtxoDisabled) {
              setSelectedNetwork(INetworkType.Syscoin);
              setSelectCurrentNetwork(null);
            }
          }}
        >
          UTXO {isUtxoDisabled && '(Current)'}
        </div>
        <div
          className={`bg-brand-blue500 text-base text-white ${seletedEvmButtonStyle} px-[19px] py-2 rounded-t-[20px] ${
            isEvmDisabled
              ? 'opacity-30 cursor-not-allowed'
              : 'cursor-pointer hover:bg-brand-blue800'
          }`}
          onClick={() => {
            if (!isEvmDisabled) {
              setSelectedNetwork(INetworkType.Ethereum);
              setSelectCurrentNetwork(null);
            }
          }}
        >
          EVM {isEvmDisabled && '(Current)'}
        </div>
      </div>
      <div className="rounded-[20px] bg-brand-blue500 p-5 h-max w-full max-w-[22rem]">
        <div className="relative flex mb-4">
          {React.createElement(leftLogo, {
            className: 'relative z-[0px] w-10 h-10 flex-shrink-0',
          })}
          {React.createElement(rightLogo, {
            className: 'absolute top-[2px] left-8 z-[1px] w-10 h-10',
          })}
          <div className="flex flex-col ml-11">
            <h1 className="text-lg font-bold text-white">
              {networkThatNeedsChanging}
            </h1>
            <h1 className="text-xs font-light text-white">
              {networkDescription}
            </h1>
          </div>
        </div>
        <div className="flex flex-col mb-2">
          <p className="text-brand-gray200 text-xs font-medium mb-2">
            {selectedNetworkText}
          </p>
          {sortedNetworks.map((currentNetworks: INetwork) => {
            const isSelected =
              selectCurrentNetwork?.current?.label === currentNetworks?.label;
            const isActive =
              activeNetwork?.chainId === currentNetworks?.chainId &&
              activeNetwork?.url === currentNetworks?.url;

            return (
              <div
                key={`${currentNetworks.chainId}-${currentNetworks.url}`}
                className={`${
                  isSelected ? 'bg-brand-blue800' : 'bg-brand-blue600'
                } mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800 flex items-center justify-between`}
                onClick={() =>
                  setSelectCurrentNetwork({
                    current: currentNetworks,
                  })
                }
              >
                <div className="flex items-center gap-2">
                  <ChainIcon
                    chainId={currentNetworks.chainId}
                    size={20}
                    networkKind={selectedNetwork}
                    className="flex-shrink-0"
                  />
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="truncate">
                      {currentNetworks.label ||
                        `Chain ${currentNetworks.chainId}`}
                    </span>
                    {isActive && (
                      <span className="text-xs text-green-400 flex-shrink-0">
                        (Active)
                      </span>
                    )}
                  </span>
                </div>
                {isSelected && (
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          <NeutralButton
            type="submit"
            disabled={!selectCurrentNetwork?.current || isLoading}
            onClick={() => handleChangeNetwork(selectCurrentNetwork?.current)}
            loading={isLoading}
            fullWidth
          >
            {t('buttons.connect')}
          </NeutralButton>
        </div>
      </div>
    </div>
  );
};
