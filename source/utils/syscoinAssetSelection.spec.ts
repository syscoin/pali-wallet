import { getRefreshedSyscoinAssetSelection } from './syscoinAssetSelection';

describe('Syscoin selected asset refresh', () => {
  it('replaces stale NFT metadata even when the balance is unchanged', () => {
    const selectedAsset = {
      assetGuid: '4294967297',
      chainId: 5700,
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
      getRefreshedSyscoinAssetSelection(selectedAsset, [refreshedAsset], 5700)
    ).toBe(refreshedAsset);
  });

  it('does not replace an unchanged selection with an equivalent Redux copy', () => {
    const selectedAsset = {
      assetGuid: '4294967297',
      chainId: 5700,
      assetType: 'ERC721' as const,
      balance: '1',
      decimals: 0,
    };

    expect(
      getRefreshedSyscoinAssetSelection(
        selectedAsset,
        [{ ...selectedAsset }],
        5700
      )
    ).toBeNull();
  });

  it('ignores an earlier same-GUID asset from another network', () => {
    const selected = { assetGuid: '123', chainId: 5700, balance: '1' };
    const foreign = { ...selected, chainId: 57, balance: '900' };
    const current = { ...selected, balance: '2' };
    expect(
      getRefreshedSyscoinAssetSelection(selected, [foreign, current], 5700)
    ).toBe(current);
    expect(
      getRefreshedSyscoinAssetSelection(selected, [foreign], 5700)
    ).toBeNull();
  });

  it('does not migrate an explicitly foreign selection to the active network', () => {
    const selected = { assetGuid: '123', chainId: 57, balance: '1' };
    expect(
      getRefreshedSyscoinAssetSelection(
        selected,
        [{ ...selected, chainId: 5700 }],
        5700
      )
    ).toBeNull();
  });

  it('does not infer a network for an incomplete token selection', () => {
    const selected = { assetGuid: '123', balance: '1' };
    const current = { ...selected, chainId: 5700, balance: '2' };
    expect(
      getRefreshedSyscoinAssetSelection(
        selected,
        [{ ...selected, balance: '900' }],
        5700
      )
    ).toBeNull();
    expect(
      getRefreshedSyscoinAssetSelection(selected, [current], 5700)
    ).toBeNull();
  });

  it.each([undefined, null, '', ' '])(
    'replaces an unavailable balance %p when a known zero arrives',
    (balance) => {
      const selected = { assetGuid: '123', chainId: 5700, balance };
      const refreshed = { ...selected, balance: '0' };
      expect(
        getRefreshedSyscoinAssetSelection(selected, [refreshed], 5700)
      ).toBe(refreshed);
    }
  );

  it('retains number/string zero equivalence and notices when zero is lost', () => {
    const selected = { assetGuid: '123', chainId: 5700, balance: 0 };
    expect(
      getRefreshedSyscoinAssetSelection(
        selected,
        [{ ...selected, balance: '0' }],
        5700
      )
    ).toBeNull();
    const refreshed = { ...selected, balance: undefined };
    expect(getRefreshedSyscoinAssetSelection(selected, [refreshed], 5700)).toBe(
      refreshed
    );
  });
});
