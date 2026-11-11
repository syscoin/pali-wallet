export const getTransactionDisplayCacheKey = ({
  accountAddress,
  chainId,
  currency,
  transaction,
  tokenMeta,
}: {
  accountAddress?: string;
  chainId: number;
  currency: string;
  tokenMeta?: any;
  transaction: any;
}): string =>
  JSON.stringify([
    chainId,
    accountAddress?.toLowerCase(),
    currency,
    transaction.hash,
    transaction.value,
    transaction.to,
    transaction.input,
    transaction.data,
    transaction.historySource,
    transaction.tokenRecipient,
    transaction.tokenTransfer,
    transaction.collectibleTransfer,
    tokenMeta?.contractAddress,
    tokenMeta?.decimals,
    tokenMeta?.tokenSymbol ?? tokenMeta?.symbol,
    tokenMeta?.isNft,
    tokenMeta?.tokenStandard,
  ]);
