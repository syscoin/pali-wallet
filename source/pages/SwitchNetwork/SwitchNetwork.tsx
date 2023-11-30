import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';

import warningImg from 'assets/icons/warn.svg';
// import { Header } from 'components/Header';
import { Layout } from 'components/Layout';
import { RootState } from 'state/store';

import { useNetworkInfo } from './NetworkInfo';
import { NetworkList } from './NetworkList';

export const SwitchNetwork = () => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const {
    connectedNetwork,
    networkThatNeedsChanging,
    connectedColor,
    networkNeedsChangingColor,
  } = useNetworkInfo();

  const networkLabel = useMemo(
    () => <p className="text-xs font-bold text-white">{activeNetwork.label}</p>,
    []
  );

  const networkSymbol = useMemo(
    () => (
      <p className={`text-xs font-bold ${connectedColor}`}>
        {connectedNetwork}
      </p>
    ),
    []
  );

  const networkSymbolChange = useMemo(
    () => (
      <p className={`text-xs font-bold ${networkNeedsChangingColor}`}>
        {networkThatNeedsChanging}!
      </p>
    ),
    []
  );

  return (
    <Layout canGoBack={false} title="Switch Network">
      {/* <Header accountHeader={false} /> */}
      <div className="gap-4 w-full flex flex-col justify-center items-center overflow-auto scrollbar-styled h-full">
        <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]'">
          <img src={warningImg} />
        </div>
        <span className="text-xs font-medium text-white text-center">
          You are connected on
          <div className="inline-block ml-1 align-middle">{networkLabel}</div>
          <div className="inline-block ml-1 align-middle">{networkSymbol}</div>,
          to use this dApp you must change to
          <div className="inline-block ml-1 align-middle">
            {networkSymbolChange}
          </div>
        </span>
        <p className="text-[#808795] text-xs underline">
          Learn about UTXO and EVM
        </p>
        <NetworkList />
      </div>
    </Layout>
  );
};
