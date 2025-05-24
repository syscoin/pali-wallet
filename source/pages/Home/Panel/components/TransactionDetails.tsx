import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import {
  EvmTransactionDetails,
  SyscoinTransactionDetails,
} from './Transactions';
import { EvmTransactionDetailsEnhanced } from './Transactions/EVM/EvmDetailsEnhanced';

export const TransactionDetails = ({ hash }: { hash: string }) => {
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  if (isBitcoinBased) {
    return <SyscoinTransactionDetails hash={hash} />;
  }

  // Use enhanced details if network has API URL configured
  if (activeNetwork?.apiUrl) {
    return <EvmTransactionDetailsEnhanced hash={hash} />;
  }

  return <EvmTransactionDetails hash={hash} />;
};
