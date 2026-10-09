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

  it('allows only EVM balance changes while preserving metadata, inventory and context guards', () => {
    const token = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      chainId: 1,
      tokenId: '2',
      balance: 5,
      rawBalance: '5',
      decimals: 0,
      metadata: { label: 'same' },
    };
    const before = { ethereum: [token], syscoin: [] };
    const evmNetwork = { ...network, kind: INetworkType.Ethereum };
    const changed = {
      ...before,
      ethereum: [{ ...token, balance: 9, rawBalance: '9' }],
    };
    const check = (latestAssets: any, extra: any = {}) =>
      canCommit({
        assets: before,
        latestAssets,
        network: evmNetwork,
        latestNetwork: evmNetwork,
        allowBalanceChanges: true,
        ...extra,
      });
    expect(check(changed)).toBe(true);
    expect(check(changed, { allowBalanceChanges: false })).toBe(false);
    expect(check(changed, { network, latestNetwork: network })).toBe(false);
    expect(check(undefined)).toBe(false);
    expect(check({ ...changed, ethereum: [] })).toBe(false);
    expect(check({ ...changed, ethereum: [...changed.ethereum, token] })).toBe(
      false
    );
    expect(check({ ...changed, syscoin: [] })).toBe(false);
    const twoTokens = {
      ...before,
      ethereum: [token, { ...token, contractAddress: 'other' }],
    };
    expect(
      check(
        { ...twoTokens, ethereum: [...twoTokens.ethereum].reverse() },
        { assets: twoTokens }
      )
    ).toBe(false);
    expect(check(changed, { latestRequestId: 5 })).toBe(false);
    expect(
      check(changed, { latestAccount: { ...account, address: 'other' } })
    ).toBe(false);
    expect(
      check(changed, { latestNetwork: { ...evmNetwork, url: 'other' } })
    ).toBe(false);
    for (const difference of [
      { contractAddress: 'other' },
      { chainId: 2 },
      { tokenId: '3' },
      { decimals: 6 },
      { metadata: { label: 'changed' } },
    ]) {
      expect(
        check({
          ...changed,
          ethereum: [{ ...changed.ethereum[0], ...difference }],
        })
      ).toBe(false);
    }
  });
});
