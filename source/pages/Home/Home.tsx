import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { FaucetChainIds } from '../../types/faucet';
import { ArrowUpSvg, ArrowDownLoadSvg } from 'components/Icon/Icon';
import {
  Button,
  FaucetAccessModal,
  FaucetFirstAccessModal,
} from 'components/index';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { StatusModal } from 'components/Modal/StatusModal';
import { WalletProviderDefaultModal } from 'components/Modal/WalletProviderDafault';
import { ConnectHardwareWallet } from 'components/Modal/WarningBaseModal';
import { usePrice, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { toNumericBalance } from 'utils/balance';
import {
  formatMillionNumber,
  formatFullPrecisionBalance,
  ONE_MILLION,
} from 'utils/index';

import { TxsPanel } from './TxsPanel';

// Memoize expensive balance formatting
const BalanceDisplay = memo(
  ({
    actualBalance,
    isLoadingBalance,
    currency,
  }: {
    actualBalance: number | string;
    currency: string;
    isLoadingBalance: boolean;
  }) => {
    if (isLoadingBalance) {
      return (
        <div className="flex items-center justify-center gap-2">
          <SkeletonLoader width="200px" height="48px" />
          <SkeletonLoader width="60px" height="35px" />
        </div>
      );
    }

    return (
      <div className="balance-account flex gap-x-0.5 items-center justify-center">
        <p id="home-balance" className="font-rubik text-5xl font-medium">
          {formatFullPrecisionBalance(actualBalance, 4)}
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
    isLoadingBalance,
    formatFiatAmount,
    priceChange24h,
  }: {
    formatFiatAmount: string | null;
    isLoadingBalance: boolean;
    priceChange24h?: number;
  }) => {
    if (isLoadingBalance) {
      return <SkeletonLoader width="100px" height="20px" margin="10px 0 0 0" />;
    }

    if (!formatFiatAmount) return null;

    return (
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm text-brand-graylight">{formatFiatAmount}</p>
        {priceChange24h !== undefined && (
          <div
            className={`text-xs ${
              priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'
            }`}
          >
            {priceChange24h >= 0 ? '+' : ''}
            {priceChange24h.toFixed(2)}% (24h)
          </div>
        )}
      </div>
    );
  }
);

FiatDisplay.displayName = 'FiatDisplay';

// Memoize Icon components to prevent unnecessary re-renders
const SendIcon = memo(() => (
  <ArrowUpSvg className="w-5 h-5 mr-2 transform rotate-45" />
));
SendIcon.displayName = 'SendIcon';

const ReceiveIcon = memo(() => <ArrowDownLoadSvg className="w-5 h-5 mr-2" />);
ReceiveIcon.displayName = 'ReceiveIcon';

export const Home = () => {
  // ALL hooks must be called first in consistent order
  const { getFiatAmount } = usePrice();
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const { state } = useLocation();
  const { controllerEmitter, isUnlocked } = useController();

  const { asset: fiatAsset, priceChange24h } = useSelector(
    (priceState: RootState) => priceState.price.fiat
  );

  const {
    accounts,
    activeAccount,
    activeNetwork,
    isBitcoinBased,
    shouldShowFaucetModal: isOpenFaucetModal,
  } = useSelector((rootState: RootState) => rootState.vault);
  const {
    lastLogin,
    loadingStates: { isLoadingBalances },
    isPollingUpdate,
    isSwitchingAccount,
    isPostNetworkSwitchLoading,
  } = useSelector((rootState: RootState) => rootState.vaultGlobal);

  // ALL useState hooks
  const [showModalCongrats, setShowModalCongrats] = useState(false);
  const [showModalHardWallet, setShowModalHardWallet] = useState(() => {
    // Check if user has previously dismissed this modal
    const dismissed = localStorage.getItem('hardwareWalletModalDismissed');
    return dismissed !== 'true';
  });
  const [shouldShowFaucet, setShouldShowFaucet] = useState(false);

  // ALL useEffect hooks

  // ALL useCallback hooks
  const closeModal = useCallback(() => {
    // Remember that user dismissed the congratulations modal
    localStorage.setItem('congratsModalDismissed', 'true');
    setShowModalCongrats(false);
  }, []);

  const handleCloseModal = useCallback(() => {
    // Remember that user dismissed this modal
    localStorage.setItem('hardwareWalletModalDismissed', 'true');
    setShowModalHardWallet(false);

    // Only show congratulations modal if user hasn't dismissed it before
    const congratsDismissed = localStorage.getItem('congratsModalDismissed');
    if (congratsDismissed !== 'true') {
      setShowModalCongrats(true);
    }
  }, []);

  const handleOnCloseFaucetModal = useCallback(() => {
    if (activeNetwork?.chainId) {
      // Update modal state
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

  const rawBalance = useMemo(() => {
    // Always return -1 during post-network switch to prevent flashing
    if (isPostNetworkSwitchLoading) return '-1';

    if (!currentAccount?.balances) return '-1';
    const balance = isBitcoinBased
      ? currentAccount.balances[INetworkType.Syscoin]
      : currentAccount.balances[INetworkType.Ethereum];
    // During network switches, treat -1 and undefined/null as loading states
    return balance === undefined || balance === null || balance === -1
      ? '-1'
      : String(balance);
  }, [currentAccount?.balances, isBitcoinBased, isPostNetworkSwitchLoading]);

  // Actual balance for display (convert -1 to 0)
  const actualBalance = useMemo(
    () =>
      rawBalance === '-1' || isPostNetworkSwitchLoading ? '0' : rawBalance,
    [rawBalance, isPostNetworkSwitchLoading]
  );

  const moreThanMillion = useMemo(
    () => toNumericBalance(actualBalance) >= ONE_MILLION,
    [actualBalance]
  );

  const fiatPriceValue = useMemo(() => {
    const numBalance = toNumericBalance(actualBalance);
    // Always return fiat amount, even for zero balance
    return getFiatAmount(
      numBalance,
      4,
      String(fiatAsset).toUpperCase(),
      true,
      true
    );
  }, [getFiatAmount, actualBalance, fiatAsset]);

  const formatFiatAmount = useMemo(() => {
    if (!fiatPriceValue) return null;

    if (moreThanMillion) {
      const matches = fiatPriceValue.match(/[\d\.]+/g);
      if (matches && matches.length > 0) {
        const numberValue = Number(matches[0]);
        return formatMillionNumber(numberValue);
      }
      return fiatPriceValue;
    }

    return fiatPriceValue;
  }, [fiatPriceValue, moreThanMillion]);

  // Safe computed values - AFTER all hooks
  const isWalletImported = state?.isWalletImported;

  // Get network status to check for errors
  const networkStatus = useSelector(
    (rootState: RootState) => rootState.vaultGlobal.networkStatus
  );

  // Show skeleton loader when:
  // 1. Balance is -1 (no data) or we're in post-network switch loading
  // 2. Network is in error, connecting, or switching state
  // 3. Balance is loading (non-polling) and balance is not yet loaded
  // 4. Always during post-network switch to prevent any flashing
  const isLoadingBalance =
    rawBalance === '-1' ||
    isPostNetworkSwitchLoading ||
    (isLoadingBalances && !isPollingUpdate) ||
    networkStatus === 'error' ||
    networkStatus === 'connecting' ||
    networkStatus === 'switching';

  // Debounced faucet modal display to prevent flashing during network/account switches
  useEffect(() => {
    const canShowFaucet =
      isFaucetAvailable &&
      toNumericBalance(actualBalance) === 0 &&
      !isLoadingBalance &&
      !isSwitchingAccount &&
      !isPostNetworkSwitchLoading && // Don't show during post-switch loading
      currentAccount;

    if (canShowFaucet) {
      setShouldShowFaucet(true);
    } else {
      // Immediately hide the faucet modal if conditions aren't met
      setShouldShowFaucet(false);
    }
  }, [
    isFaucetAvailable,
    actualBalance,
    isLoadingBalance,
    isSwitchingAccount,
    isPostNetworkSwitchLoading,
    currentAccount,
  ]);

  // Early returns only AFTER all hooks are called
  if (!accounts || !activeAccount || !activeNetwork || !currentAccount) {
    // This should be handled by AppLayout's PageLoadingOverlay instead
    return null;
  }

  return (
    <div className="h-full bg-bkg-3">
      {currentAccount && lastLogin && isUnlocked && (
        <>
          {shouldShowFaucet && (
            <>
              {shouldShowFaucetFirstModal ? (
                <FaucetFirstAccessModal onClose={handleOnCloseFaucetModal} />
              ) : (
                <FaucetAccessModal />
              )}
            </>
          )}
          {/* Floating dots container wrapping both blue sections for continuity */}
          <div className="floating-dots-container">
            <WalletProviderDefaultModal />

            <section className="flex flex-col gap-1 items-center pt-8 pb-24 text-brand-white bg-bkg-1">
              <div
                className={`flex flex-col items-center justify-center text-center floating-dots-content ${
                  shouldShowFaucet ? 'mt-12' : ''
                }`}
              >
                <BalanceDisplay
                  actualBalance={actualBalance}
                  isLoadingBalance={isLoadingBalance}
                  currency={activeNetwork.currency}
                />
                <FiatDisplay
                  isLoadingBalance={isLoadingBalance}
                  formatFiatAmount={formatFiatAmount}
                  priceChange24h={priceChange24h}
                />
              </div>

              <div className="flex items-center justify-center pt-8 w-3/4 max-w-md floating-dots-content">
                <Button
                  type="button"
                  className="xl:p-18 h-8 font-medium flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-l-full transition-all duration-300 xl:flex-none"
                  id="send-btn"
                  onClick={() =>
                    isBitcoinBased
                      ? navigate('/send/sys')
                      : navigate('/send/eth')
                  }
                  disabled={isLoadingBalance}
                >
                  <SendIcon />
                  {t('buttons.send')}
                </Button>

                <Button
                  type="button"
                  className="xl:p-18 h-8 font-medium flex flex-1 items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-r-full transition-all duration-300 xl:flex-none"
                  id="receive-btn"
                  onClick={() => navigate('/receive')}
                  disabled={isLoadingBalance}
                >
                  <ReceiveIcon />
                  {t('buttons.receive')}
                </Button>
              </div>
            </section>
          </div>
          {/* End floating dots container */}

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
