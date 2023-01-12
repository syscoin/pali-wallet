import React from 'react';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { LoadingComponent } from 'components/Loading';
import { RootState } from 'state/store';

import { TransactionsList } from './components/Transactions';

export const TransactionsPanel = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { isLoadingTxs } = useSelector((state: RootState) => state.vault);
  const transactions = Object.values(activeAccount.transactions);

  const NoTransactionsComponent = () => (
    <div className="flex items-center justify-center p-3 text-brand-white text-sm">
      <p>You have no transaction history.</p>
    </div>
  );

  return transactions.length === 0 ? (
    <>
      <NoTransactionsComponent />
      <Fullscreen />
    </>
  ) : (
    <>
      <div className="p-4 w-full text-white text-base bg-bkg-3">
        {isLoadingTxs ? <LoadingComponent /> : <TransactionsList />}
      </div>

      <Fullscreen />
    </>
  );
};
