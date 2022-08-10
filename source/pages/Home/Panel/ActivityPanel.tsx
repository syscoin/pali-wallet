import React from 'react';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';

import { TransactionsList } from './components/Transactions';

export const TransactionsPanel = () => {
  const { activeNetwork, networks, activeAccount }: IVaultState = useSelector(
    (state: RootState) => state.vault
  );
  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

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
      <div className="p-4 w-full h-full text-white text-base bg-bkg-3">
        <TransactionsList isSyscoinChain={isSyscoinChain} />
      </div>

      <Fullscreen />
    </>
  );
};
