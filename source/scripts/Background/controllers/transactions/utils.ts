import { ethers } from 'ethers';

import { ITransactionResponse } from './types';

export const getTransactionTimestamp = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  transaction: ITransactionResponse
) => {
  const { timestamp } = await provider.getBlock(
    Number(transaction.blockNumber)
  );

  return {
    ...transaction,
    timestamp,
  } as ITransactionResponse;
};

export const getFormattedTransactionResponse = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  transaction: ITransactionResponse
) => {
  const tx = await provider.getTransaction(transaction.hash);

  if (!tx) {
    return await getTransactionTimestamp(provider, transaction);
  }
  return await getTransactionTimestamp(provider, tx);
};
