import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ExternalLinkSvg } from 'components/Icon/Icon';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { RootState } from 'state/store';
import { TransactionsType } from 'state/vault/types';

import { EvmTransactionsList } from './components/Transactions/EVM/EvmList';
import { UtxoTransactionsList } from './components/Transactions/UTXO/UtxoList';

export const TransactionsPanel = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { url: networkUrl, chainId, explorer },
    isBitcoinBased,
    isLoadingTxs,
    isSwitchingAccount,
  } = useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const networkExplorer = useAdjustedExplorer(explorer);
  const adjustedNetworkUrl = useAdjustedExplorer(networkUrl);
  const adjustedExplorer = isBitcoinBased
    ? adjustedNetworkUrl
    : networkExplorer;

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
    <div className="flex items-center justify-center pt-3 pb-6 text-brand-white text-sm">
      <p>{t('home.youHaveNoTxs')}</p>
    </div>
  );

  const TransactionSkeleton = () => (
    <div className="p-4 mt-8 w-full mb-9 text-white text-base bg-brand-blue600">
      <div className="space-y-3">
        {[...Array(3)].map((_, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-3 bg-brand-blue500 rounded-lg"
          >
            <div className="flex items-center space-x-3">
              <SkeletonLoader width="40px" height="40px" />
              <div className="space-y-1">
                <SkeletonLoader width="120px" height="16px" />
                <SkeletonLoader width="80px" height="12px" />
              </div>
            </div>
            <div className="text-right space-y-1">
              <SkeletonLoader width="100px" height="16px" />
              <SkeletonLoader width="60px" height="12px" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const OpenTransactionExplorer = useMemo(() => {
    const { xpub, address: userAddress } =
      accounts[activeAccount.type][activeAccount.id];

    const explorerUrl = `${adjustedExplorer}${
      isBitcoinBased ? 'xpub' : 'address'
    }/${isBitcoinBased ? xpub : userAddress}`;

    const openExplorer = () => window.open(explorerUrl, '_blank');

    return (
      <div className="flex mt-5 items-center justify-center gap-2">
        <ExternalLinkSvg />
        <button
          type="button"
          className="w-max underline text-sm font-normal bg-transparent border-none cursor-pointer"
          onClick={openExplorer}
        >
          {t('home.seeAllTxs')}
        </button>
      </div>
    );
  }, [networkUrl, adjustedExplorer, chainId, isBitcoinBased, activeAccount]);

  const isLoading = isLoadingTxs || isSwitchingAccount;

  const allTransactions = useMemo(
    () => (hasTransactions ? transactions : previousTransactions),
    [hasTransactions, transactions, previousTransactions]
  );

  return (
    <>
      {isLoading && !hasTransactions && <TransactionSkeleton />}
      {!isLoading && !hasTransactions && (
        <div className="w-full mt-8 text-white bg-brand-blue600">
          <NoTransactionsComponent />
          {OpenTransactionExplorer}
          {/* <Fullscreen /> */}
        </div>
      )}

      {hasTransactions && (
        <div className="p-4 mt-8 w-full  mb-9 text-white text-base bg-brand-blue600">
          {isBitcoinBased ? (
            <UtxoTransactionsList userTransactions={allTransactions} />
          ) : (
            <EvmTransactionsList userTransactions={allTransactions} />
          )}
          {OpenTransactionExplorer}
        </div>
      )}
    </>
  );
};
