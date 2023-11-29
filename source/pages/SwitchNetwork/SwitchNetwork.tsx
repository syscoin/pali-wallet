import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { Header } from 'components/Header';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { NetworkType } from 'utils/types';

export const SwitchNetwork = () => {
  const { navigate } = useUtils();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const PINK_COLOR = 'text-brand-pink';
  const BLUE_COLOR = 'text-brand-blue';

  const utxoNetwork = {
    connectedNetwork: NetworkType.UTXO,
    networkThatNeedsChanging: NetworkType.EVM,
    connectedColor: PINK_COLOR,
    networkNeedsChangingColor: BLUE_COLOR,
  };

  const otherNetworkInfo = {
    connectedNetwork: NetworkType.EVM,
    networkThatNeedsChanging: NetworkType.UTXO,
    connectedColor: BLUE_COLOR,
    networkNeedsChangingColor: PINK_COLOR,
  };

  const {
    connectedNetwork,
    networkThatNeedsChanging,
    connectedColor,
    networkNeedsChangingColor,
  } = isBitcoinBased ? utxoNetwork : otherNetworkInfo;

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
    <>
      <Header accountHeader={false} />
      <div className="gap-4 w-full flex flex-col justify-center items-center p-6">
        <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]'">
          <img src={'assets/icons/warn.svg'} />
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
      </div>
    </>
  );
};
