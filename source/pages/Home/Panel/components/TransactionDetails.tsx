import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';

import {
  EvmTransactionDetails,
  SyscoinTransactionDetails,
} from './Transactions';

export const TransactionDetails = ({ hash }: { hash: string }) => {
  const { activeNetwork, networks }: IVaultState = useSelector(
    (state: RootState) => state.vault
  );

  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  return isSyscoinChain ? (
    <SyscoinTransactionDetails hash={hash} />
  ) : (
    <EvmTransactionDetails hash={hash} />
  );
};
