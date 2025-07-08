import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import { SyscoinTransactionDetails } from './Transactions';
import { EvmTransactionDetailsEnhanced } from './Transactions/EVM/EvmDetailsEnhanced';

export const TransactionDetails = ({ hash }: { hash: string }) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  if (isBitcoinBased) {
    return <SyscoinTransactionDetails hash={hash} />;
  }

  // Use enhanced details for all EVM networks (handles both API and non-API cases)
  return <EvmTransactionDetailsEnhanced hash={hash} />;
};
