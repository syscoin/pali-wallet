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
import { useNetworkChangeHandler } from 'hooks/useNetworkChangeHandler';
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
    currency,
  }: {
    actualBalance: number;
    currency: string;
    isNetworkChanging: boolean;
    moreThanMillion: boolean;
  }) => {
    if (isNetworkChanging) {
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
    formatFiatAmount,
  }: {
    formatFiatAmount: string | null;
    isNetworkChanging: boolean;
  }) => {
    if (isNetworkChanging) {
      return <SkeletonLoader width="80px" height="30px" margin="10px 0 0 0" />;
    }

    if (!formatFiatAmount) return null;

    return <p className="text-sm text-brand-graylight">{formatFiatAmount}</p>;
  }
);

FiatDisplay.displayName = 'FiatDisplay';

export const Home = () => {
  const { getFiatAmount } = usePrice();
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const { state } = useLocation();
  const { controllerEmitter, isUnlocked } = useController();
  useNetworkChangeHandler();

  const { asset: fiatAsset } = useSelector(
    (priceState: RootState) => priceState.price.fiat
  );
  const isWalletImported = state?.isWalletImported;
  const {
    accounts,
    networkStatus,
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

  const isNetworkChanging = networkStatus === 'switching';
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

  const closeModal = useCallback(() => {
    setShowModalCongrats(false);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModalHardWallet(false);
    setShowModalCongrats(true);
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;

    verifyIfIsTestnet(url, isBitcoinBased, isInCooldown, activeNetwork).then(
      (_isTestnet) => setIsTestnet(_isTestnet)
    );
  }, [isUnlocked, url, isBitcoinBased, isInCooldown, activeNetwork]);

  const fiatPriceValue = useMemo(
    () =>
      getFiatAmount(
        actualBalance > 0 ? actualBalance : 0,
        4,
        String(fiatAsset).toUpperCase(),
        true,
        true
      ),
    [getFiatAmount, actualBalance, fiatAsset]
  );

  const formatFiatAmount = useMemo(() => {
    if (isTestnet) return null;

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
  }, [activeNetwork.chainId]);

  const shouldShowFaucetFirstModal = useMemo(
    () => !!isOpenFaucetModal?.[chainId],
    [isOpenFaucetModal, chainId]
  );

  const isFaucetAvailable = useMemo(
    () => !isBitcoinBased && Object.values(FaucetChainIds).includes(chainId),
    [isBitcoinBased, chainId]
  );

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
                <BalanceDisplay
                  actualBalance={actualBalance}
                  moreThanMillion={moreThanMillion}
                  isNetworkChanging={isNetworkChanging}
                  currency={activeNetwork.currency}
                />
                <FiatDisplay
                  isNetworkChanging={isNetworkChanging}
                  formatFiatAmount={formatFiatAmount}
                />
              </div>

              <div className="flex items-center justify-center pt-8 w-3/4 max-w-md">
                <Button
                  type="button"
                  className="xl:p-18 h-8 font-medium flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-l-full transition-all duration-300 xl:flex-none"
                  id="send-btn"
                  onClick={() =>
                    isBitcoinBased
                      ? navigate('/send/sys')
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

Home.displayName = 'Home';
