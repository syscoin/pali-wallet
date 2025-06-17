import { uniqueId } from 'lodash';
import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import { Button } from 'components/Button';
import { ChainIcon } from 'components/ChainIcon';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import store, { RootState } from 'state/store';
import { setOpenDAppErrorModal } from 'state/vault';
import { getChainIdPriority } from 'utils/chainIdPriority';

import { useNetworkInfo } from './NetworkInfo';

type currentNetwork = {
  current: INetwork;
};

export const NetworkList = ({ isChanging }: { isChanging: boolean }) => {
  const { controllerEmitter } = useController();
  const { isBitcoinBased, networks, isDappAskingToChangeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { navigate } = useUtils();

  const [selectCurrentNetwork, setSelectCurrentNetwork] =
    useState<currentNetwork>();
  const [selectedNetwork, setSelectedNetwork] = useState<INetworkType>(
    isBitcoinBased ? INetworkType.Ethereum : INetworkType.Syscoin
  );
  const [isLoading, setIsLoading] = useState(false);

  const {
    networkThatNeedsChanging,
    networkDescription,
    selectedNetworkText,
    leftLogo,
    rightLogo,
  } = useNetworkInfo({ isBitcoinBased, isChanging, selectedNetwork });

  const isButtonDisabledBgStyle = selectCurrentNetwork
    ? 'bg-white'
    : 'bg-slate-400';

  const seletedEvmButtonStyle =
    selectedNetwork === INetworkType.Ethereum ? 'opacity-100' : 'opacity-60';

  const seletedUtxoButtonStyle =
    selectedNetwork === INetworkType.Syscoin ? 'opacity-100' : 'opacity-60';

  const handleChangeNetwork = async (network: INetwork) => {
    try {
      setIsLoading(true);
      store.dispatch(setOpenDAppErrorModal(false));

      // Wait for the network change to complete
      await controllerEmitter(['wallet', 'setActiveNetwork'], [network]);

      // Navigate only after successful network change
      navigate('/home');
      if (isDappAskingToChangeNetwork) window.close();
    } catch (networkError) {
      console.error('Network change failed:', networkError);
      // Show the actual error to the user
      const errorMessage = networkError?.message || 'Network change failed';
      // We can use the existing error modal system or create an alert
      // For now, let's set an error state that can be displayed
      console.error('Network switch error:', errorMessage);
      // Don't close window on error, let user try again
      // The error modal will be handled by the Header component
    } finally {
      setIsLoading(false);
    }
  };

  const newNetworks = useMemo(() => {
    if (isChanging) {
      return selectedNetwork === INetworkType.Syscoin
        ? Object.values(networks.syscoin)
        : Object.values(networks.ethereum);
    }

    return isBitcoinBased
      ? Object.values(networks.ethereum)
      : Object.values(networks.syscoin);
  }, [isBitcoinBased, isChanging, selectedNetwork, networks]);

  const sortedNetworks = useMemo(
    () =>
      newNetworks.sort(
        (a, b) => getChainIdPriority(a.chainId) - getChainIdPriority(b.chainId)
      ),
    [newNetworks]
  );

  return (
    <div className="mb-14">
      {isChanging && (
        <div className="flex pl-[20px] gap-2">
          <div
            className={`bg-brand-blue500 text-base text-white ${seletedUtxoButtonStyle} px-[19px] py-2 rounded-t-[20px] cursor-pointer hover:bg-brand-blue800`}
            onClick={() => {
              setSelectedNetwork(INetworkType.Syscoin);
              setSelectCurrentNetwork(null);
            }}
          >
            UTXO
          </div>
          <div
            className={`bg-brand-blue500 text-base text-white ${seletedEvmButtonStyle} px-[19px] py-2 rounded-t-[20px] cursor-pointer hover:bg-brand-blue800`}
            onClick={() => {
              setSelectedNetwork(INetworkType.Ethereum);
              setSelectCurrentNetwork(null);
            }}
          >
            EVM
          </div>
        </div>
      )}
      <div className="rounded-[20px] bg-brand-blue500 p-5 h-max w-full max-w-[22rem]">
        <div className="relative flex mb-4">
          {React.createElement(leftLogo, { className: 'relative z-[0px]' })}
          {React.createElement(rightLogo, {
            className: 'absolute top-[2px] left-8 z-[1px]',
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
          {sortedNetworks.map((currentNetworks: INetwork) => (
            <div
              key={uniqueId()}
              className={`${
                selectCurrentNetwork?.current?.label === currentNetworks?.label
                  ? 'bg-brand-blue800'
                  : 'bg-brand-blue600'
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
                <span>
                  {currentNetworks.label || `Chain ${currentNetworks.chainId}`}
                </span>
              </div>
              {selectCurrentNetwork?.current?.label ===
                currentNetworks?.label && (
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Button
            type="submit"
            disabled={!selectCurrentNetwork?.current || isLoading}
            onClick={() => handleChangeNetwork(selectCurrentNetwork?.current)}
            className={`${isButtonDisabledBgStyle} rounded-[100px] w-full h-[40px] text-brand-blue400 text-base font-medium`}
            loading={isLoading}
          >
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
};
