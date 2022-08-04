import { IAssets } from 'types/transactions';

export const getAssetBalance = (
  selectedAsset: IAssets | null,
  activeAccount
) => {
  if (selectedAsset) {
    const value = Number(
      selectedAsset.symbol === 'ETH'
        ? activeAccount.balances.ethereum
        : selectedAsset.balance
    );

    return `${value.toFixed(8)} ${selectedAsset.symbol}`;
  }

  return `${activeAccount?.balance.toFixed(8)} SYS`;
};
