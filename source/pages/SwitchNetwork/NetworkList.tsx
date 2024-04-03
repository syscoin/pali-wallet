import { uniqueId } from 'lodash';
import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { INetwork } from '@pollum-io/sysweb3-network';

import { Button } from 'components/Button';
import { useUtils } from 'hooks/useUtils';
import store, { RootState } from 'state/store';
import { setOpenDAppErrorModal } from 'state/vault';
import { getController } from 'utils/browser';
import { getChainIdPriority } from 'utils/chainIdPriority';
import { NetworkType } from 'utils/types';

import { useNetworkInfo } from './NetworkInfo';

type currentNetwork = {
  chain: string;
  current: INetwork;
};

export const NetworkList = ({ isChanging }: { isChanging: boolean }) => {
  const { wallet } = getController();
  const { isBitcoinBased, networks } = useSelector(
    (state: RootState) => state.vault
  );
  const { navigate } = useUtils();

  const [selectCurrentNetwork, setSelectCurrentNetwork] =
    useState<currentNetwork>();
  const [selectedNetwork, setSelectedNetwork] = useState<string>(
    isBitcoinBased ? 'UTXO' : 'EVM'
  );

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
    selectedNetwork === NetworkType.EVM ? 'opacity-100' : 'opacity-60';

  const seletedUtxoButtonStyle =
    selectedNetwork === NetworkType.UTXO ? 'opacity-100' : 'opacity-60';

  const handleChangeNetwork = async (network: INetwork, chain: string) => {
    try {
      store.dispatch(setOpenDAppErrorModal(false));
      await wallet.setActiveNetwork(network, chain);
      navigate('/home');
    } catch (networkError) {
      window.close();
    }
  };

  const chainName = useMemo(() => {
    if (isChanging) {
      return selectedNetwork === 'UTXO' ? 'syscoin' : 'ethereum';
    } else {
      return isBitcoinBased ? 'ethereum' : 'syscoin';
    }
  }, [isBitcoinBased, isChanging, selectedNetwork]);

  const newNetworks = useMemo(() => {
    if (isChanging) {
      return selectedNetwork === 'UTXO'
        ? Object.values(networks.syscoin)
        : Object.values(networks.ethereum);
    }

    return isBitcoinBased
      ? Object.values(networks.ethereum)
      : Object.values(networks.syscoin);
  }, [isBitcoinBased, isChanging, selectedNetwork, networks]);

  const testnetNetworks = useMemo(
    () => newNetworks.filter((obj) => obj?.isTestnet),
    [newNetworks]
  );

  const mainnetNetworks = useMemo(
    () =>
      newNetworks
        .filter((obj) => !obj?.isTestnet)
        .sort(
          (a, b) =>
            getChainIdPriority(a.chainId) - getChainIdPriority(b.chainId)
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
              setSelectedNetwork('UTXO');
              setSelectCurrentNetwork(null);
            }}
          >
            UTXO
          </div>
          <div
            className={`bg-brand-blue500 text-base text-white ${seletedEvmButtonStyle} px-[19px] py-2 rounded-t-[20px] cursor-pointer hover:bg-brand-blue800`}
            onClick={() => {
              setSelectedNetwork('EVM');
              setSelectCurrentNetwork(null);
            }}
          >
            EVM
          </div>
        </div>
      )}
      <div className="rounded-[20px] bg-brand-blue500 p-5 h-max w-[22rem]">
        <div className="relative flex mb-4">
          <img src={leftLogo} className="relative z-[0px]" />
          <img src={rightLogo} className="absolute top-[2px] left-8 z-[1px]" />
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
          {mainnetNetworks.map((currentNetworks: INetwork) => (
            <div
              key={uniqueId()}
              className={`${
                selectCurrentNetwork?.current?.label === currentNetworks?.label
                  ? 'bg-brand-blue800'
                  : 'bg-brand-blue600'
              } mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800`}
              onClick={() =>
                setSelectCurrentNetwork({
                  current: currentNetworks,
                  chain: chainName,
                })
              }
            >
              {currentNetworks.label}
            </div>
          ))}
        </div>
        <div className="flex flex-col">
          <p className="text-brand-gray200 text-xs font-medium mb-2">
            Testnet network:
          </p>
          {testnetNetworks.map((currentNetworks: INetwork) => (
            <div
              key={uniqueId()}
              className={`${
                selectCurrentNetwork?.current?.label === currentNetworks?.label
                  ? 'bg-brand-blue800'
                  : 'bg-brand-blue600'
              } mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800`}
              onClick={() =>
                setSelectCurrentNetwork({
                  current: currentNetworks,
                  chain: chainName,
                })
              }
            >
              {currentNetworks?.label}
            </div>
          ))}
        </div>
        <div className="mt-4">
          {/* <div className="flex justify-center items-center gap-2 mb-4">
            <img src={networkImg} alt="Network Icon" />
            <span className="underline text-white font-normal text-sm">
              Add new network
            </span>
          </div> */}
          <Button
            type="submit"
            disabled={!selectCurrentNetwork?.current}
            onClick={() =>
              handleChangeNetwork(
                selectCurrentNetwork?.current,
                selectCurrentNetwork?.chain
              )
            }
            className={`${isButtonDisabledBgStyle} rounded-[100px] w-[19.5rem] h-[40px] text-brand-blue400 text-base font-medium`}
          >
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
};
