import React from 'react';

import { useStore } from 'hooks/index';

import {
  EvmTransactionDetails,
  SyscoinTransactionDetails,
} from './Transactions';

export const TransactionDetails = ({ hash }: { hash: string }) => {
  const { activeNetwork, networks } = useStore();
  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  return isSyscoinChain ? (
    <SyscoinTransactionDetails hash={hash} />
  ) : (
    <EvmTransactionDetails hash={hash} />
  );
};
