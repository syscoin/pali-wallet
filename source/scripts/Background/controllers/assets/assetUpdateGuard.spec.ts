import { IAccountAssets } from 'state/vault/types';
import { INetworkType } from 'types/network';

import { canCommitAssetUpdate } from './utils';

const network = {
  chainId: 57,
  kind: INetworkType.Syscoin,
  slip44: 57,
  url: 'https://blockbook.syscoin.org/',
} as any;
const account = {
  address: 'sys1qaccount',
  xpub: 'zpub-account',
} as any;
const assets: IAccountAssets = {
  ethereum: [],
  syscoin: [{ assetGuid: '123', chainId: 57, symbol: 'ONE' } as any],
};

const canCommit = (overrides: Record<string, any> = {}) =>
  canCommitAssetUpdate({
    account,
    assets,
    latestAccount: account,
    latestAssets: assets,
    latestNetwork: network,
    latestRequestId: 4,
    network,
    requestId: 4,
    ...overrides,
  });

describe('asset update commit guard', () => {
  it('allows a refresh when its account, network, and base assets are unchanged', () => {
    expect(canCommit()).toBe(true);
  });

  it('allows an explicit non-active target refresh when the target is unchanged', () => {
    expect(
      canCommit({
        // The requested target is resolved directly from its account bucket;
        // committing must not depend on which account the UI currently shows.
        latestAccount: { ...account },
      })
    ).toBe(true);
  });

  it('rejects a stale SPT refresh after an imported asset is appended', () => {
    expect(
      canCommit({
        latestAssets: {
          ...assets,
          syscoin: [
            ...assets.syscoin,
            { assetGuid: '456', chainId: 57, symbol: 'TWO' },
          ],
        },
      })
    ).toBe(false);
  });

  it('rejects a stale EVM refresh after an imported token is appended', () => {
    const evmAssets = {
      ethereum: [
        {
          chainId: 570,
          contractAddress: '0x0000000000000000000000000000000000000001',
        },
      ],
      syscoin: [],
    } as IAccountAssets;

    expect(
      canCommit({
        assets: evmAssets,
        latestAssets: {
          ...evmAssets,
          ethereum: [
            ...evmAssets.ethereum,
            {
              chainId: 570,
              contractAddress: '0x0000000000000000000000000000000000000002',
            },
          ],
        },
      })
    ).toBe(false);
  });

  it('rejects an update invalidated by a network round trip', () => {
    expect(canCommit({ latestRequestId: 6 })).toBe(false);
  });
});
