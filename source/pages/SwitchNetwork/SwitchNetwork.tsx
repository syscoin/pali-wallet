import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import warningImg from 'assets/icons/warn.svg';
import { Header } from 'components/Header';
import { Layout } from 'components/Layout';
import { RootState } from 'state/store';

import { useNetworkInfo } from './NetworkInfo';
import { NetworkList } from './NetworkList';

export const SwitchNetwork = () => {
  const { state }: { state: any } = useLocation();
  const { t } = useTranslation();
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
    () => (
      <p className="text-xs font-bold text-white">{activeNetwork?.label}</p>
    ),
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
      <Layout canGoBack={false} title="Switch Network">
        <div className="gap-4 mb-7 w-full flex flex-col justify-center items-center scrollbar-styled h-full">
          {!state || !state?.switchingFromTimeError ? (
            <>
              <div className="w-[65px] h-[65px] rounded-[100px] p-[15px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]'">
                <img src={warningImg} />
              </div>
              <span className="text-xs font-medium text-white text-center">
                {t('switchNetwork.connectedOn')}
                <div className="inline-block ml-1 align-middle">
                  {networkLabel}
                </div>
                <div className="inline-block ml-1 align-middle">
                  {networkSymbol}
                </div>
                , {t('switchNetwork.toUse')}
                <div className="inline-block ml-1 align-middle">
                  {networkSymbolChange}
                </div>
              </span>
              {/* We don't have the link yet */}
              {/* <p className="text-[#808795] text-xs underline">
                {t('switchNetwork.learnAbout')}
              </p> */}
            </>
          ) : null}
          <NetworkList isChanging={state?.switchingFromTimeError} />
        </div>
      </Layout>
    </>
  );
};
