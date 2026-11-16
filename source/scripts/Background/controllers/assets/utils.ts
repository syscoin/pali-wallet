import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEqual from 'lodash/isEqual';
import omit from 'lodash/omit';
import sortBy from 'lodash/sortBy';
import uniqWith from 'lodash/uniqWith';

import { ensureEvmDisplayIdentity } from '../providers/evmDisplayIdentity';
import store from 'state/store';
import { IAccountAssets } from 'state/vault/types';
import { IKeyringAccountState, INetwork, INetworkType } from 'types/network';
import { ITokenEthProps } from 'types/tokens';

import { ISysTokensAssetReponse, type AssetReadOwner } from './types';
import type { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

/** Keep contract reads attached to this refresh without retiring the shared provider. */
export const ownedAssetProvider = (
  provider: CustomJsonRpcProvider,
  owner?: AssetReadOwner
): CustomJsonRpcProvider => {
  if (!owner) return provider;
  const read = async <T>(work: () => Promise<T>): Promise<T> => {
    owner.assertCurrent();
    const { chainId } = await provider.getNetwork();
    await ensureEvmDisplayIdentity(
      provider,
      chainId,
      owner.signal,
      owner.identityContext
    );
    owner.assertCurrent();
    const result = await work();
    await ensureEvmDisplayIdentity(
      provider,
      chainId,
      owner.signal,
      owner.identityContext
    );
    owner.assertCurrent();
    return result;
  };
  const request = (method: string, params: any[]) =>
    read(async () => {
      const [result] = await provider.readMany([{ method, params }], {
        signal: owner.signal,
      });
      if (!result) throw new Error('Asset response unavailable');
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  return new Proxy(provider, {
    get(target, key) {
      if (key === 'signal') return owner.signal;
      if (key === 'call')
        return (transaction: Parameters<CustomJsonRpcProvider['call']>[0]) =>
          request('eth_call', [
            target.getRpcTransaction(transaction),
            transaction.blockTag ?? 'latest',
          ]);
      if (key === 'getCode')
        return (address: string) => request('eth_getCode', [address, 'latest']);
      if (key === 'readMany')
        return (requests: Parameters<CustomJsonRpcProvider['readMany']>[0]) =>
          read(() => target.readMany(requests, { signal: owner.signal }));
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

/** Collect independent Contract calls in this refresh through the owned reader. */
export const batchAssetCalls = (
  provider: CustomJsonRpcProvider
): CustomJsonRpcProvider => {
  if (
    typeof provider.readMany !== 'function' ||
    typeof provider.getRpcTransaction !== 'function'
  )
    return provider;
  let pending: Array<{
    params: unknown[];
    reject(error: unknown): void;
    resolve(value: unknown): void;
  }> = [];
  const flush = async () => {
    const calls = pending;
    pending = [];
    if (!calls.length) return;
    try {
      const results = await provider.readMany(
        calls.map(({ params }) => ({ method: 'eth_call', params }))
      );
      if (results.length !== calls.length)
        throw new Error('Asset response unavailable');
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') calls[index].resolve(result.value);
        else calls[index].reject(result.reason);
      });
    } catch (error) {
      calls.forEach((call) => call.reject(error));
    }
  };
  return new Proxy(provider, {
    get(target, key) {
      if (key === 'call')
        return (transaction: Parameters<CustomJsonRpcProvider['call']>[0]) =>
          new Promise((resolve, reject) => {
            pending.push({
              params: [
                target.getRpcTransaction(transaction),
                transaction.blockTag ?? 'latest',
              ],
              resolve,
              reject,
            });
            if (pending.length === 1) queueMicrotask(() => void flush());
            // Bound each collection wave using the existing reader's normal size.
            if (pending.length === 40) void flush();
          });
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

export const canCommitAssetUpdate = ({
  account,
  allowBalanceChanges = false,
  assets,
  latestAccount,
  latestAssets,
  latestNetwork,
  latestRequestId,
  network,
  requestId,
}: {
  account: IKeyringAccountState;
  allowBalanceChanges?: boolean;
  assets: IAccountAssets;
  latestAccount?: IKeyringAccountState;
  latestAssets?: IAccountAssets;
  latestNetwork: INetwork;
  latestRequestId: number;
  network: INetwork;
  requestId: number;
}): boolean =>
  requestId === latestRequestId &&
  latestNetwork.chainId === network.chainId &&
  latestNetwork.kind === network.kind &&
  latestNetwork.url === network.url &&
  latestNetwork.slip44 === network.slip44 &&
  latestAccount?.address === account.address &&
  latestAccount?.xpub === account.xpub &&
  // Redux/Immer preserves this nested reference until that account's asset
  // state changes. This O(1) snapshot check catches imports/deletes without a
  // second deep comparison on every polling cycle.
  (latestAssets === assets ||
    // SYSCOIN: Receipt reads may update balances during a later regular poll.
    // Only that narrow change is safe; imports, deletion, order and metadata
    // changes still invalidate the snapshot, as does every context check above.
    (allowBalanceChanges &&
      network.kind === INetworkType.Ethereum &&
      !!latestAssets &&
      latestAssets.syscoin === assets.syscoin &&
      latestAssets.ethereum.length === assets.ethereum.length &&
      assets.ethereum.every((token, index) =>
        isEqual(
          omit(token, ['balance', 'rawBalance']),
          omit(latestAssets.ethereum[index], ['balance', 'rawBalance'])
        )
      )));

export const validateAndManageUserAssets = (
  isForEvm: boolean,
  fetchedAssetsOrTokens: ISysTokensAssetReponse[] | ITokenEthProps[],
  currentAssets?: ISysTokensAssetReponse[] | ITokenEthProps[]
) => {
  if (fetchedAssetsOrTokens.length === 0) return [];

  const assetsValueToUse =
    currentAssets ||
    (() => {
      const { activeAccount, accountAssets } = store.getState().vault;
      const assets = accountAssets[activeAccount.type]?.[activeAccount.id];
      return isForEvm ? assets?.ethereum : assets?.syscoin;
    })();
  const userClonedAssets = isForEvm
    ? (clone(compact(assetsValueToUse as ITokenEthProps[])) as ITokenEthProps[])
    : (clone(
        compact(assetsValueToUse as ISysTokensAssetReponse[])
      ) as ISysTokensAssetReponse[]);

  const tokenPropertyToUseAtGroupBy = isForEvm
    ? 'contractAddress'
    : 'assetGuid';

  const validateIfTokensIsEquals = isEqual(
    sortBy(
      userClonedAssets,
      (asset: ISysTokensAssetReponse | ITokenEthProps) => {
        // For ERC-1155, create a composite key with contractAddress and tokenId
        if (
          isForEvm &&
          'tokenStandard' in asset &&
          asset.tokenStandard === 'ERC-1155' &&
          asset.tokenId
        ) {
          return `${(asset.contractAddress || '').toLowerCase()}-${
            asset.tokenId
          }`;
        }
        return asset[tokenPropertyToUseAtGroupBy];
      }
    ),
    sortBy(
      fetchedAssetsOrTokens,
      (asset: ISysTokensAssetReponse | ITokenEthProps) => {
        // For ERC-1155, create a composite key with contractAddress and tokenId
        if (
          isForEvm &&
          'tokenStandard' in asset &&
          asset.tokenStandard === 'ERC-1155' &&
          asset.tokenId
        ) {
          return `${(asset.contractAddress || '').toLowerCase()}-${
            asset.tokenId
          }`;
        }
        return asset[tokenPropertyToUseAtGroupBy];
      }
    )
  );

  //Return a empty array to we don't need to dispatch something at the Polling
  if (validateIfTokensIsEquals) {
    return [];
  }

  //If the arrays is not equal, we have only to trust in the new fetchedValue because the assets can be
  //With a bigger os smaller value from balance, we can't use maxBy to validate it. So we filter by assetGuid or contractAddres
  //And order / sort it by balance value, to keep the biggests ones at first positions
  return uniqWith(
    flatMap(fetchedAssetsOrTokens).sort((a, b) => {
      // Handle null/undefined balance values safely
      const balanceA = a?.balance ? parseFloat(a.balance) : 0;
      const balanceB = b?.balance ? parseFloat(b.balance) : 0;
      return balanceB - balanceA;
    }),
    (a, b) => {
      // For EVM, compare contractAddress and tokenId (for ERC-1155)
      if (isForEvm) {
        const aEvm = a as ITokenEthProps;
        const bEvm = b as ITokenEthProps;
        // SYSCOIN: Never collapse the same deployment address across chains.
        if (aEvm.chainId !== bEvm.chainId) return false;
        const sameContract =
          (aEvm.contractAddress || '').toLowerCase() ===
          (bEvm.contractAddress || '').toLowerCase();
        const sameTokenId = aEvm.tokenId === bEvm.tokenId;
        // For ERC-1155, both contractAddress and tokenId must match
        // For other tokens, just contractAddress needs to match
        return aEvm.tokenStandard === 'ERC-1155' ||
          bEvm.tokenStandard === 'ERC-1155'
          ? sameContract && sameTokenId
          : sameContract;
      }
      // For UTXO, use assetGuid
      return a[tokenPropertyToUseAtGroupBy] === b[tokenPropertyToUseAtGroupBy];
    }
  );
};

export const ensureTrailingSlash = (url: string): string => {
  // Check the last character using charAt
  if (url && url.charAt(url.length - 1) !== '/') {
    url += '/';
  }
  return url;
};
