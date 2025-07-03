import { ITokenEthProps } from 'types/tokens';

/**
 * Extract NFT assets from ethereum assets array
 * NFTs are stored as regular assets with isNft: true
 */
export const getNftAssetsFromEthereum = (
  ethereumAssets: ITokenEthProps[],
  chainId: number
): ITokenEthProps[] => {
  if (!ethereumAssets || !Array.isArray(ethereumAssets)) {
    return [];
  }
  return ethereumAssets.filter(
    (asset) => asset.isNft === true && asset.chainId === chainId
  );
};

/**
 * Get all non-NFT tokens from ethereum assets array
 */
export const getTokenAssetsFromEthereum = (
  ethereumAssets: ITokenEthProps[],
  chainId: number
): ITokenEthProps[] => {
  if (!ethereumAssets || !Array.isArray(ethereumAssets)) {
    return [];
  }
  return ethereumAssets.filter(
    (asset) => !asset.isNft && asset.chainId === chainId
  );
};
