import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { LoadingComponent } from 'components/Loading';
import { RootState } from 'state/store';

import { TransactionsList } from './components/Transactions';

export const TransactionsPanel = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { url: networkUrl, chainId, explorer },
    isBitcoinBased,
    isLoadingTxs,
  } = useSelector((state: RootState) => state.vault);

  const adjustedExplorer = useMemo(
    () => (explorer?.endsWith('/') ? explorer : `${explorer}/`),
    [explorer]
  );

  const [previousTransactions, setPreviousTransactions] = useState([]);

  const transactions = useMemo(() => {
    const accountTransactions =
      accounts[activeAccount.type][activeAccount.id].transactions ?? {};
    return Object.values(accountTransactions);
  }, [accounts, activeAccount]);

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
      <p>You have no transaction history.</p>
    </div>
  );

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
        See all your transactions
      </button>
    );
  }, [networkUrl, adjustedExplorer, chainId, isBitcoinBased, activeAccount]);

  return (
    <>
      {isLoadingTxs && <LoadingComponent />}
      {!isLoadingTxs && !hasTransactions && (
        <div className="w-full text-white">
          <NoTransactionsComponent />
          <OpenTransactionExplorer />
          <Fullscreen />
        </div>
      )}
      {!isLoadingTxs && hasTransactions && (
        <div className="p-4 w-full text-white text-base bg-bkg-3">
          <TransactionsList
            userTransactions={
              hasTransactions ? transactions : previousTransactions
            }
          />
          <OpenTransactionExplorer />
        </div>
      )}
      <Fullscreen />
    </>
  );
};
