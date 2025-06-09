import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
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
import { RootState } from 'state/store';
import {
  formatBalanceDecimals,
  formatMillionNumber,
  ONE_MILLION,
  verifyIfIsTestnet,
} from 'utils/index';

import { TxsPanel } from './TxsPanel';

// Memoize expensive balance formatting
const BalanceDisplay = memo(
  ({
    actualBalance,
    moreThanMillion,
    isNetworkChanging,
    isSwitchingAccount,
    currency,
  }: {
    actualBalance: number;
    currency: string;
    isNetworkChanging: boolean;
    isSwitchingAccount: boolean;
    moreThanMillion: boolean;
  }) => {
    if (isNetworkChanging || isSwitchingAccount) {
      return (
        <div className="flex items-center">
          <SkeletonLoader width="200px" height="40px" />
          <SkeletonLoader width="50px" height="35px" />
        </div>
      );
    }

    return (
      <div className="balance-account flex gap-x-0.5 items-center justify-center">
        <p id="home-balance" className="font-rubik text-5xl font-medium">
          {moreThanMillion
            ? formatMillionNumber(actualBalance)
            : formatBalanceDecimals(actualBalance || 0, false)}
        </p>
        <p className="mt-4 font-poppins">{currency.toUpperCase()}</p>
      </div>
    );
  }
);

BalanceDisplay.displayName = 'BalanceDisplay';

// Memoize fiat display component
const FiatDisplay = memo(
  ({
    isNetworkChanging,
    isSwitchingAccount,
    formatFiatAmount,
  }: {
    formatFiatAmount: string | null;
    isNetworkChanging: boolean;
    isSwitchingAccount: boolean;
  }) => {
    if (isNetworkChanging || isSwitchingAccount) {
      return <SkeletonLoader width="80px" height="30px" margin="10px 0 0 0" />;
    }

    if (!formatFiatAmount) return null;

    return <p className="text-sm text-brand-graylight">{formatFiatAmount}</p>;
  }
);

FiatDisplay.displayName = 'FiatDisplay';

export const Home = () => {
  // ALL hooks must be called first in consistent order
  const { getFiatAmount } = usePrice();
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const { state } = useLocation();
  const { controllerEmitter, isUnlocked } = useController();

  const { asset: fiatAsset } = useSelector(
    (priceState: RootState) => priceState.price.fiat
  );

  const {
    accounts,
    networkStatus,
    activeAccount,
    activeNetwork,
    isBitcoinBased,
    lastLogin,
    isLoadingBalances,
    isSwitchingAccount,
    shouldShowFaucetModal: isOpenFaucetModal,
  } = useSelector((rootState: RootState) => rootState.vault);

  // ALL useState hooks
  const [isTestnet, setIsTestnet] = useState(false);
  const [showModalCongrats, setShowModalCongrats] = useState(false);
  const [showModalHardWallet, setShowModalHardWallet] = useState(true);
  const [isInCooldown, setIsInCooldown] = useState(false);

  // ALL useEffect hooks
  useEffect(() => {
    if (!isUnlocked) return;

    controllerEmitter(
      ['wallet', 'ethereumTransaction', 'web3Provider'],
      [],
      true
    )
      .then((response: CustomJsonRpcProvider) => {
        setIsInCooldown(response?.isInCooldown || false);
      })
      .catch((error) => {
        console.warn('Failed to get web3Provider cooldown status:', error);
        setIsInCooldown(false);
      });
  }, [isUnlocked, controllerEmitter]);

  useEffect(() => {
    if (!isUnlocked || !activeNetwork) return;

    verifyIfIsTestnet(
      activeNetwork.url,
      isBitcoinBased,
      isInCooldown,
      activeNetwork
    ).then((_isTestnet) => setIsTestnet(_isTestnet));
  }, [isUnlocked, activeNetwork, isBitcoinBased, isInCooldown]);

  useEffect(() => {
    if (!isUnlocked || !lastLogin) return;

    controllerEmitter(['callGetLatestUpdateForAccount']).catch((error) => {
      console.warn('Failed to fetch initial account data:', error);
    });
  }, [isUnlocked, lastLogin, controllerEmitter]);

  // ALL useCallback hooks
  const closeModal = useCallback(() => {
    setShowModalCongrats(false);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModalHardWallet(false);
    setShowModalCongrats(true);
  }, []);

  const handleOnCloseFaucetModal = useCallback(() => {
    if (activeNetwork?.chainId) {
      controllerEmitter(
        ['wallet', 'setFaucetModalState'],
        [{ chainId: activeNetwork.chainId, isOpen: false }]
      );
    }
  }, [activeNetwork?.chainId, controllerEmitter]);

  // ALL useMemo hooks - must be called before any early returns
  const shouldShowFaucetFirstModal = useMemo(
    () => !!isOpenFaucetModal?.[activeNetwork?.chainId],
    [isOpenFaucetModal, activeNetwork?.chainId]
  );

  const isFaucetAvailable = useMemo(
    () =>
      !isBitcoinBased &&
      activeNetwork?.chainId &&
      Object.values(FaucetChainIds).includes(activeNetwork.chainId),
    [isBitcoinBased, activeNetwork?.chainId]
  );

  // Calculate values that depend on data that might not be ready yet
  const currentAccount = useMemo(() => {
    if (!accounts || !activeAccount) return null;
    return accounts[activeAccount.type]?.[activeAccount.id] || null;
  }, [accounts, activeAccount]);

  const actualBalance = useMemo(() => {
    if (!currentAccount?.balances) return 0;
    const { syscoin: syscoinBalance, ethereum: ethereumBalance } =
      currentAccount.balances;
    return isBitcoinBased ? syscoinBalance || 0 : ethereumBalance || 0;
  }, [currentAccount?.balances, isBitcoinBased]);

  const moreThanMillion = useMemo(
    () => actualBalance >= ONE_MILLION,
    [actualBalance]
  );

  const fiatPriceValue = useMemo(() => {
    if (!actualBalance) return '';
    return getFiatAmount(
      actualBalance > 0 ? actualBalance : 0,
      4,
      String(fiatAsset).toUpperCase(),
      true,
      true
    );
  }, [getFiatAmount, actualBalance, fiatAsset]);

  const formatFiatAmount = useMemo(() => {
    if (isTestnet || !fiatPriceValue) return null;

    if (moreThanMillion) {
      const matches = fiatPriceValue.match(/[\d\.]+/g);
      if (matches && matches.length > 0) {
        const numberValue = Number(matches[0]);
        return formatMillionNumber(numberValue);
      }
      return fiatPriceValue;
    }

    return fiatPriceValue;
  }, [fiatPriceValue, isTestnet, moreThanMillion]);

  // Safe computed values - AFTER all hooks
  const isWalletImported = state?.isWalletImported;
  const isNetworkChanging = networkStatus === 'switching';

  // Early returns only AFTER all hooks are called
  if (!accounts || !activeAccount || !activeNetwork) {
    return (
      <div className="flex items-center justify-center h-full min-h-popup bg-bkg-3">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
          <p className="text-sm">Loading wallet data...</p>
        </div>
      </div>
    );
  }

  // Check if account data exists
  if (!currentAccount) {
    return (
      <div className="flex items-center justify-center h-full min-h-popup bg-bkg-3">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
          <p className="text-sm">Loading account data...</p>
        </div>
      </div>
    );
  }

  const bgColor = isNetworkChanging ? 'bg-bkg-2' : 'bg-bkg-3';

  return (
    <div className={`scrollbar-styled h-full ${bgColor} overflow-auto`}>
      {currentAccount && lastLogin && isUnlocked && (
        <>
          <Header accountHeader />
          <WalletProviderDefaultModal />

          {isFaucetAvailable && actualBalance === 0 && (
            <>
              {shouldShowFaucetFirstModal ? (
                <FaucetFirstAccessModal onClose={handleOnCloseFaucetModal} />
              ) : (
                <FaucetAccessModal />
              )}
            </>
          )}

          <section className="flex flex-col gap-1 items-center pt-14 pb-24 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              <BalanceDisplay
                actualBalance={actualBalance}
                moreThanMillion={moreThanMillion}
                isNetworkChanging={isNetworkChanging}
                isSwitchingAccount={isSwitchingAccount}
                currency={activeNetwork.currency}
              />
              <FiatDisplay
                isNetworkChanging={isNetworkChanging}
                isSwitchingAccount={isSwitchingAccount}
                formatFiatAmount={formatFiatAmount}
              />
            </div>

            <div className="flex items-center justify-center pt-8 w-3/4 max-w-md">
              <Button
                type="button"
                className="xl:p-18 h-8 font-medium flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-l-full transition-all duration-300 xl:flex-none"
                id="send-btn"
                onClick={() =>
                  isBitcoinBased ? navigate('/send/sys') : navigate('/send/eth')
                }
                disabled={
                  isLoadingBalances || isNetworkChanging || isSwitchingAccount
                }
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
                disabled={
                  isLoadingBalances || isNetworkChanging || isSwitchingAccount
                }
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

Home.displayName = 'Home';
