import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

// import { Fullscreen } from 'components/Fullscreen';
import { LoadingComponent } from 'components/Loading';
import { RootState } from 'state/store';
import { TransactionsType } from 'state/vault/types';

import { TransactionsList } from './components/Transactions';

const SECONDS = 10000;

export const TransactionsPanel = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { url: networkUrl, chainId, explorer },
    isBitcoinBased,
    isLoadingTxs,
  } = useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const adjustedExplorer = useMemo(
    () => (explorer?.endsWith('/') ? explorer : `${explorer}/`),
    [explorer]
  );

  const [internalLoading, setInternalLoading] = useState<boolean>(isLoadingTxs);

  const [previousTransactions, setPreviousTransactions] = useState([]);

  const transactions = useMemo(() => {
    const accountTransactions =
      accounts[activeAccount.type][activeAccount.id].transactions;

    if (isBitcoinBased) {
      if (Array.isArray(accountTransactions)) return [];
      const sysTxs = accountTransactions[TransactionsType.Syscoin][chainId];

      if (sysTxs && sysTxs.length > 0) {
        return sysTxs;
      } else {
        return [];
      }
    } else {
      if (Array.isArray(accountTransactions)) return [];
      const ethTxs = accountTransactions[TransactionsType.Ethereum][chainId];

      if (ethTxs && ethTxs.length > 0) {
        return ethTxs;
      } else {
        return [];
      }
    }
  }, [accounts, activeAccount, chainId, isBitcoinBased]);

  const hasTransactions =
    transactions.length > 0 || previousTransactions.length > 0;

  useEffect(() => {
    if (
      !isLoadingTxs &&
      transactions.length === 0 &&
      previousTransactions.length > 0
    ) {
      setPreviousTransactions(transactions);
    } else if (transactions.length > 0) {
      setPreviousTransactions(transactions);
    }
  }, [isLoadingTxs, transactions, previousTransactions]);

  const NoTransactionsComponent = () => (
    <div className="flex items-center justify-center p-3 text-brand-white text-sm">
      <p>{t('home.youHaveNoTxs')}</p>
    </div>
  );

  const validateTimeoutError = () => {
    if (isLoadingTxs) {
      setTimeout(() => {
        setInternalLoading(false);
      }, SECONDS);
    }
  };

  const OpenTransactionExplorer = useCallback(() => {
    const { xpub, address: userAddress } =
      accounts[activeAccount.type][activeAccount.id];
    const openExplorer = () =>
      window.open(
        `${isBitcoinBased ? networkUrl : adjustedExplorer}${
          isBitcoinBased ? 'xpub' : 'address'
        }/${isBitcoinBased ? xpub : userAddress}`,
        '_blank'
      );

    return (
      <button
        type="button"
        className="pb-16 w-full underline text-sm font-semibold bg-transparent border-none cursor-pointer"
        onClick={openExplorer}
      >
        {t('home.seeAllTxs')}
      </button>
    );
  }, [networkUrl, adjustedExplorer, chainId, isBitcoinBased, activeAccount]);

  useEffect(() => {
    validateTimeoutError();
    setInternalLoading(isLoadingTxs);
    return () => {
      setInternalLoading(false);
    };
  }, [isLoadingTxs]);

  return (
    <>
      {internalLoading && !hasTransactions && <LoadingComponent />}
      {!internalLoading && !hasTransactions && (
        <div className="w-full mt-8 text-white">
          <NoTransactionsComponent />
          <OpenTransactionExplorer />
          {/* <Fullscreen /> */}
        </div>
      )}
      {hasTransactions && (
        <div className="p-4 mt-8 w-full text-white text-base bg-bkg-3">
          <TransactionsList
            userTransactions={
              hasTransactions ? transactions : previousTransactions
            }
          />
          <OpenTransactionExplorer />
        </div>
      )}
      {/* <Fullscreen /> */}
    </>
  );
};
