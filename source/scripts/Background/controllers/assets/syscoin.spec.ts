const fetchBackendAccountCachedMock = jest.fn();

jest.mock('../utils/fetchBackendAccountWrapper', () => ({
  fetchBackendAccountCached: (...args: any[]) =>
    fetchBackendAccountCachedMock(...args),
}));

import SysAssetsController from './syscoin';

describe('SysAssetsController imported asset refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes chain values without dropping imported metadata', async () => {
    fetchBackendAccountCachedMock.mockResolvedValue({
      tokensAsset: [
        {
          assetGuid: '123',
          balance: '250',
          decimals: 2,
          name: 'Backend name',
          path: 'm/0/0',
          symbol: 'TOK',
          totalReceived: '250',
          totalSent: '0',
          transfers: 1,
          type: 'SPTAllocated',
        },
      ],
    });

    const importedAsset = {
      assetGuid: '123',
      balance: 0,
      chainId: 57,
      decimals: 2,
      description: 'user metadata',
      image: 'ipfs://token-image',
      name: 'Imported name',
      symbol: 'TOK',
      type: 'SPTAllocated',
    } as any;

    const result = await SysAssetsController().getSysAssetsByXpub(
      'zpub-account',
      'https://blockbook.syscoin.org',
      57,
      [importedAsset]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      assetGuid: '123',
      balance: '2.5',
      chainId: 57,
      description: 'user metadata',
      image: 'ipfs://token-image',
    });
  });

  it('retains a zero-balance imported asset missing from Blockbook', async () => {
    fetchBackendAccountCachedMock.mockResolvedValue({ tokensAsset: [] });
    const importedAsset = {
      assetGuid: '456',
      balance: 9,
      chainId: 5700,
      decimals: 8,
      description: 'durable metadata',
      image: 'ipfs://durable-image',
      name: 'Offline token',
      symbol: 'OFF',
      type: 'SPTAllocated',
    } as any;

    const result = await SysAssetsController().getSysAssetsByXpub(
      'vpub-account',
      'https://blockbook-dev.syscoin.org/',
      5700,
      [importedAsset]
    );

    expect(result[0]).toMatchObject({
      assetGuid: '456',
      balance: '0',
      chainId: 5700,
      description: 'durable metadata',
      image: 'ipfs://durable-image',
    });
  });

  it('preserves zero-decimal NFT and ERC-1155 balances', async () => {
    fetchBackendAccountCachedMock.mockResolvedValue({
      tokensAsset: [
        {
          assetGuid: '4294967297',
          balance: '2',
          decimals: 0,
          symbol: 'NFT',
          totalReceived: '2',
          totalSent: '0',
          transfers: 1,
          type: 'SPTAllocated',
        },
      ],
    });

    const result = await SysAssetsController().getSysAssetsByXpub(
      'zpub-account',
      'https://blockbook.syscoin.org',
      57,
      [
        {
          assetGuid: '4294967297',
          balance: 0,
          chainId: 57,
          decimals: 0,
          name: 'NFT',
          symbol: 'NFT',
          type: 'SPTAllocated',
        } as any,
      ]
    );

    expect(result[0]).toMatchObject({
      assetGuid: '4294967297',
      balance: '2',
      decimals: 0,
      totalReceived: '2',
    });
  });
});
