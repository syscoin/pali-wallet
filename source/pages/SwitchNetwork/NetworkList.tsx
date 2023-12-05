import { uniqueId } from 'lodash';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { INetwork } from '@pollum-io/sysweb3-network';

import networkImg from 'assets/icons/network.svg';
import { Button } from 'components/Button';
import store, { RootState } from 'state/store';
import { setOpenDAppErrorModal } from 'state/vault';
import { getController } from 'utils/browser';

import { useNetworkInfo } from './NetworkInfo';

export const NetworkList = ({ isChanging }: { isChanging: boolean }) => {
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);

  const [selectCurrentNetwork, setSelectCurrentNetwork] = useState({
    current: null,
    chain: '',
  });
  const [selectedNetwork, setSelectedNetwork] = useState<string>(
    isBitcoinBased ? 'UTXO' : 'EVM'
  );

  const { wallet } = getController();
  const {
    networkThatNeedsChanging,
    networkDescription,
    selectedNetworkText,
    leftLogo,
    rightLogo,
    filteredNetworks,
  } = useNetworkInfo(selectedNetwork);

  const testnetNetworks = filteredNetworks.filter((obj) =>
    obj.label.includes('Testnet')
  );

  const mainetNetworks = filteredNetworks.filter((obj) =>
    ['Mainnet', 'NEVM', 'Rollux'].some((substring) =>
      obj.label.includes(substring)
    )
  );

  const handleChangeNetwork = async (network: INetwork, chain: string) => {
    try {
      store.dispatch(setOpenDAppErrorModal(false));
      await wallet.setActiveNetwork(network, chain);
      window.close();
    } catch (networkError) {
      window.close();
    }
  };

  const chainName = isBitcoinBased ? 'ethereum' : 'syscoin';

  return (
    <div>
      {isChanging && (
        <div className="flex pl-[20px] gap-2">
          <div
            className={`bg-brand-blue500 text-base text-white ${
              selectedNetwork === 'UTXO' ? 'opacity-100' : 'opacity-60'
            } px-[19px] py-2 rounded-t-[20px] cursor-pointer hover:bg-brand-blue800`}
            onClick={() => setSelectedNetwork('UTXO')}
          >
            UTXO
          </div>
          <div
            className={`bg-brand-blue500 text-base text-white ${
              selectedNetwork === 'EVM' ? 'opacity-100' : 'opacity-60'
            } px-[19px] py-2 rounded-t-[20px] cursor-pointer hover:bg-brand-blue800`}
            onClick={() => setSelectedNetwork('EVM')}
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
          {mainetNetworks.map((currentNetwork: INetwork) => (
            <div
              key={uniqueId()}
              className={`${
                selectCurrentNetwork.current?.label === currentNetwork.label
                  ? 'bg-brand-blue800'
                  : 'bg-brand-blue600'
              } mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800`}
              onClick={() =>
                setSelectCurrentNetwork({
                  current: currentNetwork,
                  chain: chainName,
                })
              }
            >
              {currentNetwork.label}
            </div>
          ))}
        </div>
        <div className="flex flex-col">
          <p className="text-brand-gray200 text-xs font-medium mb-2">
            Testnet network:
          </p>
          {testnetNetworks.map((currentNetwork: INetwork) => (
            <div
              key={uniqueId()}
              className={`${
                selectCurrentNetwork.current?.label === currentNetwork.label
                  ? 'bg-brand-blue800'
                  : 'bg-brand-blue600'
              } mb-[2px] rounded-[10px] p-2 w-full h-[37px] text-white text-sm font-normal transition-all cursor-pointer hover:bg-brand-blue800`}
              onClick={() =>
                setSelectCurrentNetwork({
                  current: currentNetwork,
                  chain: chainName,
                })
              }
            >
              {currentNetwork.label}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="flex justify-center items-center gap-2 mb-4">
            <img src={networkImg} alt="Network Icon" />
            <span className="underline text-white font-normal text-sm">
              Add new network
            </span>
          </div>
          <Button
            type="submit"
            onClick={() =>
              handleChangeNetwork(
                selectCurrentNetwork.current,
                selectCurrentNetwork.chain
              )
            }
            className="bg-white rounded-[100px] w-[19.5rem] h-[40px] text-brand-blue400 text-base font-medium"
          >
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
};
