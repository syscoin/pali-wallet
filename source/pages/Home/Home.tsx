import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import { Header, Icon, Button, Loading } from 'components/index';
import { usePrice, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import {
  ONE_MILLION,
  ONE_TRILLION,
  formatMillionNumber,
  verifyIfIsTestnet,
  formatBalanceDecimals,
} from 'utils/index';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  //* Hooks
  const { getFiatAmount } = usePrice();
  const { navigate } = useUtils();
  const { t } = useTranslation();

  //* Selectors
  const { asset: fiatAsset, price: fiatPrice } = useSelector(
    (state: RootState) => state.price.fiat
  );

  const {
    accounts,
    isNetworkChanging,
    activeAccount,
    activeNetwork,
    isBitcoinBased,
    lastLogin,
    isLoadingBalances,
  } = useSelector((state: RootState) => state.vault);

  //* States
  const [isTestnet, setIsTestnet] = useState(false);

  //* Constants
  const { url } = activeNetwork;
  const controller = getController();
  const { isInCooldown }: CustomJsonRpcProvider =
    controller.wallet.ethereumTransaction.web3Provider;
  const isUnlocked =
    controller.wallet.isUnlocked() &&
    accounts[activeAccount.type][activeAccount.id].address !== '';
  const bgColor = isNetworkChanging ? 'bg-bkg-2' : 'bg-bkg-3';
  const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
    accounts[activeAccount.type][activeAccount.id].balances;

  const actualBalance = isBitcoinBased ? syscoinBalance : ethereumBalance;
  const moreThanMillion = actualBalance >= ONE_MILLION;

  const moreThanTrillion = actualBalance > ONE_TRILLION;

  //* Effect for set Testnet or not
  useEffect(() => {
    if (!isUnlocked) return;

    verifyIfIsTestnet(url, isBitcoinBased, isInCooldown).then((_isTestnet) =>
      setIsTestnet(_isTestnet)
    );
  }, [isUnlocked, activeNetwork, activeNetwork.chainId, isBitcoinBased]);

  //* fiatPriceValue with useMemo to recalculate every time that something changes and be in cache if the value is the same
  const fiatPriceValue = useMemo(() => {
    const getAmount = getFiatAmount(
      actualBalance > 0 ? actualBalance : 0,
      4,
      String(fiatAsset).toUpperCase(),
      true,
      true
    );

    return getAmount;
  }, [
    isUnlocked,
    activeAccount,
    accounts[activeAccount.type][activeAccount.id].address,
    activeNetwork,
    activeNetwork.chainId,
    fiatAsset,
    fiatPrice,
    actualBalance,
  ]);

  return (
    <div className={`scrollbar-styled h-full ${bgColor} overflow-auto`}>
      {accounts[activeAccount.type][activeAccount.id] &&
      lastLogin &&
      isUnlocked &&
      !isNetworkChanging ? (
        <>
          <Header accountHeader />

          <section className="flex flex-col gap-1 items-center py-14 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="balance-account flex gap-x-0.5 items-center justify-center">
                <p
                  id="home-balance"
                  className={`font-rubik ${
                    moreThanTrillion ? 'text-sm' : 'text-5xl'
                  }  font-medium`}
                >
                  {moreThanMillion
                    ? formatMillionNumber(actualBalance)
                    : formatBalanceDecimals(actualBalance || 0)}{' '}
                </p>

                <p
                  className={`${
                    moreThanTrillion ? 'text-sm' : 'mt-4'
                  } font-poppins`}
                >
                  {activeNetwork.currency.toUpperCase()}
                </p>
              </div>

              <p id="fiat-ammount">{isTestnet ? null : fiatPriceValue}</p>
            </div>

            <div className="flex gap-x-0.5 items-center justify-center pt-8 w-3/4 max-w-md">
              <Button
                type="button"
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-l-full transition-all duration-300 xl:flex-none"
                id="send-btn"
                onClick={() =>
                  isBitcoinBased ? navigate('/send/sys') : navigate('/send/eth')
                }
                disabled={isLoadingBalances}
              >
                <Icon
                  name="arrow-up"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                  rotate={45}
                />
                {t('buttons.send')}
              </Button>

              <Button
                type="button"
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-r-full transition-all duration-300 xl:flex-none"
                id="receive-btn"
                onClick={() => navigate('/receive')}
              >
                <Icon
                  name="arrow-down"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                />
                {t('buttons.receive')}
              </Button>
            </div>
          </section>

          <TxsPanel />
        </>
      ) : (
        <Loading />
      )}
    </div>
  );
};
