import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Header } from 'components/Header';
import { WarnIconSvg } from 'components/Icon/Icon';
import { RootState } from 'state/store';

import { useNetworkInfo } from './NetworkInfo';
import { NetworkList } from './NetworkList';

export const SwitchNetwork = () => {
  const { state }: { state: any } = useLocation();
  const { t } = useTranslation();
  const { isBitcoinBased, activeNetwork } = useSelector(
    (rootState: RootState) => rootState.vault
  );
  const {
    connectedNetwork,
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
        {connectedNetwork}
      </p>
    ),
    []
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
      <Header accountHeader={false} />
      <div className="gap-4 mb-7 w-full flex flex-col justify-center items-center scrollbar-styled h-full">
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
        <NetworkList />
      </div>
    </>
  );
};
