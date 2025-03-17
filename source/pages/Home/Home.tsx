import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import { FaucetChainIds } from '../../types/faucet';
import {
  Button,
  FaucetAccessModal,
  FaucetFirstAccessModal,
  Header,
  Icon,
} from 'components/index';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { StatusModal } from 'components/Modal/StatusModal';
import { WalletProviderDefaultModal } from 'components/Modal/WalletProviderDafault';
import { ConnectHardwareWallet } from 'components/Modal/WarningBaseModal';
import { usePrice, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useNetworkChangeHandler } from 'hooks/useNetworkChangeHandler';
import { RootState } from 'state/store';
import {
  formatBalanceDecimals,
  formatMillionNumber,
  ONE_MILLION,
  ONE_TRILLION,
  verifyIfIsTestnet,
} from 'utils/index';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const { getFiatAmount } = usePrice();
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const { state } = useLocation();
  const { controllerEmitter, isUnlocked } = useController();
  useNetworkChangeHandler();

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

  const [isTestnet, setIsTestnet] = useState(false);
  const [showModalCongrats, setShowModalCongrats] = useState(false);
  const [showModalHardWallet, setShowModalHardWallet] = useState(true);

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

  useEffect(() => {
    if (!isUnlocked) return;

    verifyIfIsTestnet(url, isBitcoinBased, isInCooldown).then((_isTestnet) =>
      setIsTestnet(_isTestnet)
    );
  }, [isUnlocked, activeNetwork, activeNetwork.chainId, isBitcoinBased]);

  const fiatPriceValue = useMemo(
    () =>
      getFiatAmount(
        actualBalance > 0 ? actualBalance : 0,
        4,
        String(fiatAsset).toUpperCase(),
        true,
        true
      ),
    [
      isUnlocked,
      activeAccount,
      accounts[activeAccount.type][activeAccount.id].address,
      activeNetwork,
      activeNetwork.chainId,
      fiatAsset,
      fiatPrice,
      actualBalance,
    ]
  );

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
      [{ chainId: activeNetwork.chainId, isOpen: false }]
    );
  }, [activeNetwork]);

  const shouldShowFaucetFirstModal = !!isOpenFaucetModal?.[chainId];

  const isFaucetAvailable =
    !isBitcoinBased && Object.values(FaucetChainIds).includes(chainId);

  return (
    <div className={`scrollbar-styled h-full ${bgColor} overflow-auto`}>
      {accounts[activeAccount.type][activeAccount.id] &&
        lastLogin &&
        isUnlocked && (
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
                    {isNetworkChanging ? (
                      <SkeletonLoader width="200px" height="40px" />
                    ) : moreThanMillion ? (
                      formatMillionNumber(actualBalance)
                    ) : (
                      formatBalanceDecimals(actualBalance || 0, false)
                    )}{' '}
                  </p>

                  {isNetworkChanging ? (
                    <SkeletonLoader width="50px" height="35px" />
                  ) : (
                    <p
                      className={`${
                        moreThanTrillion ? 'text-lg' : 'mt-4'
                      } font-poppins`}
                    >
                      {activeNetwork.currency.toUpperCase()}
                    </p>
                  )}
                </div>

                <p id="fiat-amount">
                  {isNetworkChanging ? (
                    <SkeletonLoader
                      width="80px"
                      height="30px"
                      margin="10px 0 0 0"
                    />
                  ) : (
                    formatFiatAmount
                  )}
                </p>
              </div>

              <div className="flex items-center justify-center pt-8 w-3/4 max-w-md">
                <Button
                  type="button"
                  className="xl:p-18 h-8 font-medium flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-l-full transition-all duration-300 xl:flex-none"
                  id="send-btn"
                  onClick={() =>
                    isBitcoinBased
                      ? navigate('/chain-fail-to-connect')
                      : navigate('/send/eth')
                  }
                  disabled={isLoadingBalances || isNetworkChanging}
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
                  disabled={isLoadingBalances || isNetworkChanging}
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
        )}
    </div>
  );
};
