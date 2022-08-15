import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import {
  EvmTransactionDetails,
  SyscoinTransactionDetails,
} from './Transactions';

export const TransactionDetails = ({ hash }: { hash: string }) => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networks = useSelector((state: RootState) => state.vault.networks);

  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  return isSyscoinChain ? (
    <SyscoinTransactionDetails hash={hash} />
  ) : (
    <EvmTransactionDetails hash={hash} />
  );
};
