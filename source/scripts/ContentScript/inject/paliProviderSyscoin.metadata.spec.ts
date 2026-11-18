/** @jest-environment jsdom */
import { PaliInpageProviderSys } from './paliProviderSyscoin';

afterEach(() => jest.restoreAllMocks());
it('keeps selected-backend metadata calls working without disclosing or echoing a backend URL', async () => {
  const metadata = { assetGuid: '123', symbol: 'SPT' };
  const request = jest
    .spyOn(PaliInpageProviderSys.prototype, 'request')
    .mockImplementation(async ({ method }) => {
      if (method === 'wallet_getSysProviderState')
        return {
          accounts: [],
          xpub: null,
          blockExplorerURL: null,
          isUnlocked: true,
          isBitcoinBased: true,
        };
      if (method === 'wallet_getAccount')
        return {
          transactions: [
            {
              tokenType: 'assetallocationmint',
              tokenTransfers: [{ token: '123' }],
            },
          ],
        };
      if (method === 'wallet_getSysAssetMetadata') return metadata;
      throw Error('Unexpected provider method ' + method);
    });
  const provider = new PaliInpageProviderSys();
  await Promise.resolve();
  await Promise.resolve();
  await expect(provider._sys.getDataAsset('123')).resolves.toEqual(metadata);
  expect(request).toHaveBeenLastCalledWith({
    method: 'wallet_getSysAssetMetadata',
    params: ['123'],
  });
  const minted = await provider._sys.getUserMintedTokens();
  expect(minted).toHaveLength(1);
  expect(minted[0]).toMatchObject(metadata);
  expect(request).toHaveBeenLastCalledWith({
    method: 'wallet_getSysAssetMetadata',
    params: ['123'],
  });
});
