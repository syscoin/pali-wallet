const getSysAssetsByXpubMock = jest.fn();

jest.mock('./syscoin', () => ({
  __esModule: true,
  default: () => ({
    getSysAssetsByXpub: (...args: any[]) => getSysAssetsByXpubMock(...args),
  }),
}));

jest.mock('./evm', () => ({
  __esModule: true,
  default: () => ({
    updateAllEvmTokens: jest.fn().mockResolvedValue([]),
  }),
}));

import AssetsManager from './index';

const ACCOUNT = { xpub: 'zpub-test', address: 'sys1q...' } as any;
const CURRENT_ASSETS = {
  ethereum: [],
  syscoin: [{ assetGuid: '123', balance: 1 }],
} as any;

describe('AssetsManager SPT gating by chain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSysAssetsByXpubMock.mockResolvedValue([
      { assetGuid: '123', balance: 2 },
    ]);
  });

  it('fetches SPT assets on Syscoin mainnet (57)', async () => {
    const result = await AssetsManager().utils.updateAssetsFromCurrentAccount(
      ACCOUNT,
      true,
      'https://blockbook.syscoin.org/',
      57,
      undefined as any,
      CURRENT_ASSETS
    );

    expect(getSysAssetsByXpubMock).toHaveBeenCalledTimes(1);
    expect(result.syscoin).toEqual([{ assetGuid: '123', balance: 2 }]);
  });

  it('fetches SPT assets on Syscoin testnet (5700)', async () => {
    await AssetsManager().utils.updateAssetsFromCurrentAccount(
      ACCOUNT,
      true,
      'https://blockbook-dev.syscoin.org/',
      5700,
      undefined as any,
      CURRENT_ASSETS
    );

    expect(getSysAssetsByXpubMock).toHaveBeenCalledTimes(1);
  });

  it('skips the SPT Blockbook call on non-Syscoin UTXO chains (e.g. BTC)', async () => {
    const result = await AssetsManager().utils.updateAssetsFromCurrentAccount(
      ACCOUNT,
      true,
      'https://btc1.trezor.io/',
      0,
      undefined as any,
      CURRENT_ASSETS
    );

    expect(getSysAssetsByXpubMock).not.toHaveBeenCalled();
    // Existing assets are preserved untouched
    expect(result).toEqual(CURRENT_ASSETS);
  });
});
