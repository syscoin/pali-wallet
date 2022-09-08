import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import {
  EvmTransactionDetails,
  SyscoinTransactionDetails,
} from './Transactions';

export const TransactionDetails = ({ hash }: { hash: string }) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  return isBitcoinBased ? (
    <SyscoinTransactionDetails hash={hash} />
  ) : (
    <EvmTransactionDetails hash={hash} />
  );
};
