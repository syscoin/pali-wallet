import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import { FaucetChainIds } from '../../types/faucet';
import { FaucetAccessModal, FaucetFirstAccessModal } from 'components/index';
import { Header, Icon, Button, Loading } from 'components/index';
import { StatusModal } from 'components/Modal/StatusModal';
import { WalletProviderDefaultModal } from 'components/Modal/WalletProviderDafault';
import { ConnectHardwareWallet } from 'components/Modal/WarningBaseModal';
import { usePrice, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
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
  const { state } = useLocation();
  const { controllerEmitter, isUnlocked } = useController();

  //* Selectors
  const { asset: fiatAsset, price: fiatPrice } = useSelector(
    (priceState: RootState) => priceState.price.fiat
  );
  const isWalletImported = state?.isWalletImported;
  const {
    accounts,
    isNetworkChanging,
    activeAccount,
    activeNetwork,
    isBitcoinBased,
    lastLogin,
    isLoadingBalances,
    shouldShowFaucetModal: isOpenFaucetModal,
  } = useSelector((rootState: RootState) => rootState.vault);

  //* States
  const [isTestnet, setIsTestnet] = useState(false);
  const [showModalCongrats, setShowModalCongrats] = useState(false);
  const [showModalHardWallet, setShowModalHardWallet] = useState(true);

  //* Constants
  const { url, chainId } = activeNetwork;

  let isInCooldown: boolean;

  controllerEmitter(
    ['wallet', 'ethereumTransaction', 'web3Provider'],
    [],
    true
  ).then((response: CustomJsonRpcProvider) => {
    isInCooldown = response?.isInCooldown || false;
  });

  const bgColor = isNetworkChanging ? 'bg-bkg-2' : 'bg-bkg-3';
  const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
    accounts[activeAccount.type][activeAccount.id].balances;

  const actualBalance = isBitcoinBased ? syscoinBalance : ethereumBalance;
  const moreThanMillion = actualBalance >= ONE_MILLION;
  const moreThanTrillion = actualBalance > ONE_TRILLION;

  const closeModal = () => {
    setShowModalCongrats(false);
  };

  const handleCloseModal = () => {
    setShowModalHardWallet(false);
    setShowModalCongrats(true);
  };

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

  const formatFiatAmount = useMemo(() => {
    if (isTestnet) {
      return null;
    }

    if (moreThanMillion) {
      const numberValue = Number(fiatPriceValue.match(/[\d\.]+/g)[0]);
      return formatMillionNumber(numberValue);
    }

    return formatBalanceDecimals(fiatPriceValue, true);
  }, [fiatPriceValue, isTestnet, moreThanMillion]);

  const handleOnCloseFaucetModal = useCallback(() => {
    controllerEmitter(
      ['wallet', 'setFaucetModalState'],
      [{ chainId: activeNetwork.chainId, state: false }]
    );
  }, [activeNetwork]);

  const shouldShowFaucetFirstModal = !!isOpenFaucetModal?.[chainId];

  const isFaucetAvailable =
    !isBitcoinBased && Object.values(FaucetChainIds).includes(chainId);

  return (
    <div className={`scrollbar-styled h-full ${bgColor} overflow-auto`}>
      {accounts[activeAccount.type][activeAccount.id] &&
      lastLogin &&
      isUnlocked &&
      !isNetworkChanging ? (
        <>
          <Header accountHeader />
          <WalletProviderDefaultModal />

          {isFaucetAvailable && (
            <>
              {shouldShowFaucetFirstModal ? (
                <FaucetFirstAccessModal
                  handleOnClose={handleOnCloseFaucetModal}
                />
              ) : (
                <FaucetAccessModal />
              )}
            </>
          )}

          <section className="flex flex-col gap-1 items-center pt-14 pb-24 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="balance-account flex gap-x-0.5 items-center justify-center">
                <p
                  id="home-balance"
                  className={`font-rubik text-5xl font-medium`}
                >
                  {moreThanMillion
                    ? formatMillionNumber(actualBalance)
                    : formatBalanceDecimals(actualBalance || 0, false)}{' '}
                </p>

                <p
                  className={`${
                    moreThanTrillion ? 'text-lg' : 'mt-4'
                  } font-poppins`}
                >
                  {activeNetwork.currency.toUpperCase()}
                </p>
              </div>

              <p id="fiat-amount">{formatFiatAmount}</p>
            </div>

            <div className="flex items-center justify-center pt-8 w-3/4 max-w-md">
              <Button
                type="button"
                className="xl:p-18 h-8 font-medium flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-l-full transition-all duration-300 xl:flex-none"
                id="send-btn"
                onClick={() =>
                  isBitcoinBased ? navigate('/send/sys') : navigate('/send/eth')
                }
                disabled={isLoadingBalances}
              >
                <Icon
                  name="ArrowUpBoldIcon"
                  className="w-5 h-5"
                  wrapperClassname="mr-2"
                  rotate={45}
                  isSvg={true}
                />
                {t('buttons.send')}
              </Button>

              <Button
                type="button"
                className="xl:p-18 h-8 font-medium flex flex-1 items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-r-full transition-all duration-300 xl:flex-none"
                id="receive-btn"
                onClick={() => navigate('/receive')}
              >
                <Icon
                  name="ArrowDownLoad"
                  className="w-5 h-5"
                  wrapperClassname="mr-2"
                  isSvg={true}
                />
                {t('buttons.receive')}
              </Button>
            </div>
          </section>
          {isWalletImported && (
            <>
              <ConnectHardwareWallet
                title={t('accountMenu.connectTrezor').toUpperCase()}
                onClose={handleCloseModal}
                show={showModalHardWallet}
                phraseOne={t('home.ifYouHaveAHardWallet')}
              />
              <StatusModal
                show={showModalCongrats}
                title={t('home.congratulations')}
                description={t('home.youWalletWas')}
                onClose={closeModal}
                status="success"
              />
            </>
          )}
          <TxsPanel />
        </>
      ) : (
        <Loading />
      )}
    </div>
  );
};
