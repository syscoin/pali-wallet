import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  memo,
  startTransition,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { INetworkType } from '@pollum-io/sysweb3-network';

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
  formatBalanceDecimals,
  formatMillionNumber,
  ONE_MILLION,
} from 'utils/index';

import { TxsPanel } from './TxsPanel';

// Memoize expensive balance formatting
const BalanceDisplay = memo(
  ({
    actualBalance,
    moreThanMillion,
    isLoadingBalance,
    currency,
  }: {
    actualBalance: number;
    currency: string;
    isLoadingBalance: boolean;
    moreThanMillion: boolean;
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
    isLoadingBalance,
    formatFiatAmount,
  }: {
    formatFiatAmount: string | null;
    isLoadingBalance: boolean;
  }) => {
    if (isLoadingBalance) {
      return <SkeletonLoader width="100px" height="20px" margin="10px 0 0 0" />;
    }

    if (!formatFiatAmount) return null;

    return <p className="text-sm text-brand-graylight">{formatFiatAmount}</p>;
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

  const { asset: fiatAsset } = useSelector(
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

  useEffect(() => {
    if (!isUnlocked || !lastLogin) return;

    // Check if coming from transaction confirmation (via navigation state)
    const isFromTransaction = state?.fromTransaction;

    if (isFromTransaction) {
      // Post-transaction polling: keep refreshing cache every 4 seconds for adaptive timing
      let pollCount = 0;
      const maxPolls = 4; // Poll 4 times (16 seconds total) to adapt to explorer speed

      const pollForTransaction = async () => {
        try {
          // Wait 4 seconds before each poll (including poll 1)
          await new Promise((resolve) => setTimeout(resolve, 4000));

          pollCount++;
          console.log(
            `[Post-TX Poll ${pollCount}/${maxPolls}] Checking for transaction changes...`
          );

          // Clear cache and get fresh data - check if changes were detected
          const hasChanges = await controllerEmitter([
            'callGetLatestUpdateForAccount',
          ]);

          console.log(`[Post-TX Poll] Changes detected: ${hasChanges}`);

          if (hasChanges) {
            console.log(
              '[Post-TX Poll] Changes detected! Transaction found, stopping poll.'
            );
            return; // Stop polling early - transaction was detected!
          } else {
            console.log(
              '[Post-TX Poll] No changes detected, continuing polling...'
            );
          }

          if (pollCount < maxPolls) {
            // Continue polling with startTransition for non-urgent updates
            startTransition(() => {
              pollForTransaction();
            });
          } else {
            console.log(
              '[Post-TX Poll] Completed all polls. Transaction should be visible.'
            );
          }
        } catch (error) {
          console.warn('Failed to poll for post-transaction data:', error);
          if (pollCount < maxPolls) {
            // Continue even on error
            pollForTransaction();
          }
        }
      };

      // Start polling
      pollForTransaction();
    } else {
      // Normal navigation - update immediately with cache
      controllerEmitter(['callGetLatestUpdateForAccount']).catch((error) => {
        console.warn('Failed to fetch initial account data:', error);
      });
    }
  }, [isUnlocked, lastLogin, controllerEmitter, state]);

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
      // Use startTransition for non-urgent modal state updates
      startTransition(() => {
        controllerEmitter(
          ['wallet', 'setFaucetModalState'],
          [{ chainId: activeNetwork.chainId, isOpen: false }]
        );
      });
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
    return isBitcoinBased
      ? currentAccount.balances[INetworkType.Syscoin] || 0
      : currentAccount.balances[INetworkType.Ethereum] || 0;
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

  const isLoadingBalance = isLoadingBalances;

  // Debounced faucet modal display to prevent flashing during network/account switches
  useEffect(() => {
    const canShowFaucet =
      isFaucetAvailable &&
      actualBalance === 0 &&
      !isLoadingBalance &&
      currentAccount;

    if (canShowFaucet) {
      // Delay showing the faucet modal to allow loading states to update
      const timer = setTimeout(() => {
        setShouldShowFaucet(true);
      }, 500); // 500ms delay to ensure loading states are properly set

      return () => clearTimeout(timer);
    } else {
      // Immediately hide the faucet modal if conditions aren't met
      setShouldShowFaucet(false);
    }
  }, [isFaucetAvailable, actualBalance, isLoadingBalance, currentAccount]);

  // Early returns only AFTER all hooks are called
  if (!accounts || !activeAccount || !activeNetwork || !currentAccount) {
    // This should be handled by AppLayout's PageLoadingOverlay instead
    return null;
  }

  return (
    <div className="h-full bg-bkg-3">
      {currentAccount && lastLogin && isUnlocked && (
        <>
          {/* Floating dots container wrapping both blue sections for continuity */}
          <div className="floating-dots-container">
            <WalletProviderDefaultModal />

            {shouldShowFaucet && (
              <>
                {shouldShowFaucetFirstModal ? (
                  <FaucetFirstAccessModal onClose={handleOnCloseFaucetModal} />
                ) : (
                  <FaucetAccessModal />
                )}
              </>
            )}

            <section className="flex flex-col gap-1 items-center pt-8 pb-24 text-brand-white bg-bkg-1">
              <div className="flex flex-col items-center justify-center text-center floating-dots-content">
                <BalanceDisplay
                  actualBalance={actualBalance}
                  moreThanMillion={moreThanMillion}
                  isLoadingBalance={isLoadingBalance}
                  currency={activeNetwork.currency}
                />
                <FiatDisplay
                  isLoadingBalance={isLoadingBalance}
                  formatFiatAmount={formatFiatAmount}
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
