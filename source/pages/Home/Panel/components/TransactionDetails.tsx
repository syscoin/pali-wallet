import React from 'react';
import { useSelector } from 'react-redux';

import type {
  IEvmTransactionResponse,
  ISysTransaction,
} from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';

import { SyscoinTransactionDetails } from './Transactions';
import { EvmTransactionDetailsEnhanced } from './Transactions/EVM/EvmDetailsEnhanced';

export type TransactionDetailsProps = {
  hash: string;
  tx: IEvmTransactionResponse | ISysTransaction;
};

export const TransactionDetails = ({ hash, tx }: TransactionDetailsProps) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  if (isBitcoinBased) {
    return <SyscoinTransactionDetails hash={hash} tx={tx as ISysTransaction} />;
  }

  // Use enhanced details for all EVM networks (handles both API and non-API cases)
  return (
    <EvmTransactionDetailsEnhanced
      hash={hash}
      tx={tx as IEvmTransactionResponse}
    />
  );
};
