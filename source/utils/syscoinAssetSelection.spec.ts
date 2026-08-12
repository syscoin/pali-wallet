import { getRefreshedSyscoinAssetSelection } from './syscoinAssetSelection';

describe('Syscoin selected asset refresh', () => {
  it('replaces stale NFT metadata even when the balance is unchanged', () => {
    const selectedAsset = {
      assetGuid: '4294967297',
      balance: '1',
      decimals: 8,
    };
    const refreshedAsset = {
      ...selectedAsset,
      assetType: 'ERC721' as const,
      decimals: 0,
      tokenId: '1',
    };

    expect(
      getRefreshedSyscoinAssetSelection(selectedAsset, [refreshedAsset])
    ).toBe(refreshedAsset);
  });

  it('does not replace an unchanged selection with an equivalent Redux copy', () => {
    const selectedAsset = {
      assetGuid: '4294967297',
      assetType: 'ERC721' as const,
      balance: '1',
      decimals: 0,
    };

    expect(
      getRefreshedSyscoinAssetSelection(selectedAsset, [{ ...selectedAsset }])
    ).toBeNull();
  });
});
