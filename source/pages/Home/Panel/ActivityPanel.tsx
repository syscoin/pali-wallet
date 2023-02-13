import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { LoadingComponent } from 'components/Loading';
import { RootState } from 'state/store';

import { TransactionsList } from './components/Transactions';

export const TransactionsPanel = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { isLoadingTxs, accounts } = useSelector(
    (state: RootState) => state.vault
  );
  const [internalLoading, setInternalLoading] = useState<any>(isLoadingTxs);
  const transactions = Object.values(accounts[activeAccount].transactions);
  const seconds = 10000;

  const NoTransactionsComponent = () => (
    <div className="flex items-center justify-center p-3 text-brand-white text-sm">
      <p>You have no transaction history.</p>
    </div>
  );

  const validateTimeoutError = () => {
    if (isLoadingTxs) {
      setTimeout(() => {
        setInternalLoading(false);
      }, seconds);
    }
  };

  useEffect(() => {
    validateTimeoutError();
  }, [isLoadingTxs]);

  useEffect(() => {
    setInternalLoading(isLoadingTxs);
  }, [isLoadingTxs]);

  return transactions.length === 0 ? (
    <>
      <NoTransactionsComponent />
      <Fullscreen />
    </>
  ) : (
    <>
      <div className="p-4 w-full text-white text-base bg-bkg-3">
        {internalLoading ? <LoadingComponent /> : <TransactionsList />}
      </div>

      <Fullscreen />
    </>
  );
};
