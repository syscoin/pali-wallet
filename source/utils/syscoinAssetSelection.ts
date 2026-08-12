import { ITokenSysProps } from 'types/tokens';

export const getRefreshedSyscoinAssetSelection = (
  selectedAsset: ITokenSysProps,
  accountAssets: ITokenSysProps[]
): ITokenSysProps | null => {
  const refreshedAsset = accountAssets.find(
    (asset) => String(asset.assetGuid) === String(selectedAsset.assetGuid)
  );

  if (!refreshedAsset) return null;

  const fields = new Set([
    ...Object.keys(selectedAsset),
    ...Object.keys(refreshedAsset),
  ]);
  const hasChanged = [...fields].some((field) => {
    const selectedValue = (selectedAsset as Record<string, unknown>)[field];
    const refreshedValue = (refreshedAsset as Record<string, unknown>)[field];

    return field === 'balance'
      ? String(selectedValue ?? 0) !== String(refreshedValue ?? 0)
      : selectedValue !== refreshedValue;
  });

  return hasChanged ? refreshedAsset : null;
};
