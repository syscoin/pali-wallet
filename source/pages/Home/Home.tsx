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
import {
  selectActiveAccount,
  selectActiveAccountRef,
} from 'state/vault/selectors';
import { INetworkType } from 'types/network';
import { toNumericBalance } from 'utils/balance';
import {
  formatMillionNumber,
  formatFullPrecisionBalance,
  ONE_MILLION,
} from 'utils/index';

import { TxsPanel } from './TxsPanel';

const homeBalanceCache: Record<string, string> = {};

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

  const currentAccount = useSelector(selectActiveAccount);
  const activeAccountRef = useSelector(selectActiveAccountRef);
  const activeNetwork = useSelector(
    (rootState: RootState) => rootState.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (rootState: RootState) => rootState.vault.isBitcoinBased
  );
  const isOpenFaucetModal = useSelector(
    (rootState: RootState) => rootState.vault.shouldShowFaucetModal
  );
  const { isSwitchingAccount, isPostNetworkSwitchLoading } = useSelector(
    (rootState: RootState) => rootState.vaultGlobal
  );

  // ALL useState hooks
  const [showModalCongrats, setShowModalCongrats] = useState(false);
  const [showModalHardWallet, setShowModalHardWallet] = useState(() => {
    // Check if user has previously dismissed this modal
    const dismissed = localStorage.getItem('hardwareWalletModalDismissed');
    return dismissed !== 'true';
  });

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
  }, [activeNetwork?.chainId]);

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

  const balanceCacheKey = useMemo(
    () =>
      [
        activeNetwork?.chainId ?? 'unknown-chain',
        activeAccountRef.type,
        activeAccountRef.id,
        currentAccount?.xpub ?? currentAccount?.address ?? 'unknown-account',
        isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum,
      ].join(':'),
    [
      activeAccountRef.id,
      activeAccountRef.type,
      activeNetwork?.chainId,
      currentAccount?.address,
      currentAccount?.xpub,
      isBitcoinBased,
    ]
  );

  const currentBalanceValue = useMemo(() => {
    if (!currentAccount?.balances) return '-1';

    const balance = isBitcoinBased
      ? currentAccount.balances[INetworkType.Syscoin]
      : currentAccount.balances[INetworkType.Ethereum];

    return balance === undefined || balance === null || balance === -1
      ? '-1'
      : String(balance);
  }, [currentAccount?.balances, isBitcoinBased]);

  useEffect(() => {
    if (currentBalanceValue !== '-1') {
      homeBalanceCache[balanceCacheKey] = currentBalanceValue;
    }
  }, [balanceCacheKey, currentBalanceValue]);

  const cachedBalance = homeBalanceCache[balanceCacheKey];

  const rawBalance = useMemo(
    () =>
      currentBalanceValue !== '-1'
        ? currentBalanceValue
        : cachedBalance ?? '-1',
    [cachedBalance, currentBalanceValue]
  );

  // Actual balance for display (convert -1 to 0)
  const actualBalance = useMemo(
    () => (rawBalance === '-1' ? '0' : rawBalance),
    [rawBalance]
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
        // Preserve original formatted string when fiat is zero
        if (numberValue === 0) return fiatPriceValue;
        return formatMillionNumber(numberValue);
      }
      return fiatPriceValue;
    }

    return fiatPriceValue;
  }, [fiatPriceValue, moreThanMillion]);

  // Safe computed values - AFTER all hooks
  const isWalletImported = state?.isWalletImported;

  // Show skeleton only when no balance is known for this account/network yet.
  // Background refreshes should update the value behind the scenes instead of
  // making the already-rendered home view unusable.
  const isLoadingBalance = rawBalance === '-1';

  // Derived state for faucet visibility
  const shouldShowFaucet = useMemo(
    () =>
      isFaucetAvailable &&
      toNumericBalance(actualBalance) === 0 &&
      !isLoadingBalance &&
      !isSwitchingAccount &&
      !isPostNetworkSwitchLoading &&
      currentAccount,
    [
      isFaucetAvailable,
      actualBalance,
      isLoadingBalance,
      isSwitchingAccount,
      isPostNetworkSwitchLoading,
      currentAccount,
    ]
  );

  // Early returns only AFTER all hooks are called
  if (!activeNetwork || !currentAccount) {
    // This should be handled by AppLayout's PageLoadingOverlay instead
    return null;
  }

  return (
    <div className="h-full bg-bkg-3">
      {currentAccount && isUnlocked && (
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
