import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { WarnIconSvg } from 'components/Icon/Icon';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';

import { useNetworkInfo } from './NetworkInfo';
import { NetworkList } from './NetworkList';

export const SwitchNetwork = () => {
  const { state }: { state: any } = useLocation();
  const queryData = useQueryData();
  const { t } = useTranslation();

  // Use query data for popup data, fallback to location state for navigation
  const popupData = Object.keys(queryData).length > 0 ? queryData : state;

  const { isBitcoinBased, activeNetwork } = useSelector(
    (rootState: RootState) => rootState.vault
  );
  const {
    networkThatNeedsChanging,
    connectedColor,
    networkNeedsChangingColor,
  } = useNetworkInfo({ isBitcoinBased });

  const networkLabel = useMemo(
    () => (
      <p className="text-xs font-bold text-white">{activeNetwork?.label}</p>
    ),
    []
  );

  const networkSymbol = useMemo(
    () => (
      <p className={`text-xs font-extrabold ${connectedColor}`}>
        {isBitcoinBased ? 'UTXO' : 'EVM'}
      </p>
    ),
    [connectedColor, isBitcoinBased]
  );

  const networkSymbolChange = useMemo(
    () => (
      <p className={`text-xs font-extrabold ${networkNeedsChangingColor}`}>
        {networkThatNeedsChanging}!
      </p>
    ),
    []
  );

  return (
    <>
      <div className="gap-4 mb-7 w-full flex flex-col justify-center items-center remove-scrollbar h-full">
        {!state || !state?.switchingFromTimeError ? (
          <>
            <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]'">
              <WarnIconSvg />
            </div>
            <span className="text-xs font-medium text-white text-center">
              {t('switchNetworkPage.connectedOn')}
              <div className="inline-block ml-1 align-middle">
                {networkLabel}
              </div>
              <div className="inline-block ml-1 align-middle">
                {networkSymbol}
              </div>
              , {t('switchNetworkPage.toUse')}
              <div className="inline-block ml-1 align-middle">
                {networkSymbolChange}
              </div>
            </span>
            {/*TODO: We don't have the link yet */}
            {/* <p className="text-[#808795] text-xs underline">
                {t('switchNetwork.learnAbout')}
              </p> */}
          </>
        ) : null}
        <NetworkList
          disabledNetworkType={popupData?.disabledNetworkType}
          forceNetworkType={popupData?.forceNetworkType}
          isTypeSwitch={popupData?.isTypeSwitch}
        />
      </div>
    </>
  );
};
