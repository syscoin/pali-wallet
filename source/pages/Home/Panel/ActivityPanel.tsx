import React, { useCallback } from 'react';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { RootState } from 'state/store';

import { TransactionsList } from './components/Transactions';

export const TransactionsPanel = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { url: networkUrl, chainId, explorer },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);

  const { xpub, address: userAddress } =
    accounts[activeAccount.type][activeAccount.id];

  const transactions = Object.values(
    accounts[activeAccount.type][activeAccount.id].transactions ?? {}
  );

  const NoTransactionsComponent = () => (
    <div className="flex items-center justify-center p-3 text-brand-white text-sm">
      <p>You have no transaction history.</p>
    </div>
  );

  const OpenTransactionExplorer = useCallback(() => {
    const openExplorer = () =>
      window.open(
        `${isBitcoinBased ? networkUrl : explorer}${
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
  }, [networkUrl, chainId, isBitcoinBased]);

  return transactions.length === 0 ? (
    <div className="w-full text-white">
      <NoTransactionsComponent />
      <OpenTransactionExplorer />
      <Fullscreen />
    </div>
  ) : (
    <>
      <div className="p-4 w-full text-white text-base bg-bkg-3">
        <TransactionsList />
        <OpenTransactionExplorer />
      </div>

      <Fullscreen />
    </>
  );
};
