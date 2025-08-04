import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEqual from 'lodash/isEqual';
import sortBy from 'lodash/sortBy';
import uniqWith from 'lodash/uniqWith';

import store from 'state/store';
import { ITokenEthProps } from 'types/tokens';

import { ISysTokensAssetReponse } from './types';

export const validateAndManageUserAssets = (
  isForEvm: boolean,
  fetchedAssetsOrTokens: ISysTokensAssetReponse[] | ITokenEthProps[]
) => {
  if (fetchedAssetsOrTokens.length === 0) return [];

  const { activeAccount, accountAssets } = store.getState().vault;

  const assets = accountAssets[activeAccount.type]?.[activeAccount.id];

  const assetsValueToUse = isForEvm ? assets?.ethereum : assets?.syscoin;
  //@ts-ignore
  const userClonedAssets = clone(compact(assetsValueToUse));

  const tokenPropertyToUseAtGroupBy = isForEvm
    ? 'contractAddress'
    : 'assetGuid';

  const validateIfTokensIsEquals = isEqual(
    sortBy(userClonedAssets, (asset) => {
      // For ERC-1155, create a composite key with contractAddress and tokenId
      if (isForEvm && asset.tokenStandard === 'ERC-1155' && asset.tokenId) {
        return `${(asset.contractAddress || '').toLowerCase()}-${
          asset.tokenId
        }`;
      }
      return asset[tokenPropertyToUseAtGroupBy];
    }),
    sortBy(fetchedAssetsOrTokens, (asset) => {
      // For ERC-1155, create a composite key with contractAddress and tokenId
      if (isForEvm && asset.tokenStandard === 'ERC-1155' && asset.tokenId) {
        return `${(asset.contractAddress || '').toLowerCase()}-${
          asset.tokenId
        }`;
      }
      return asset[tokenPropertyToUseAtGroupBy];
    })
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
        const sameContract =
          (a.contractAddress || '').toLowerCase() ===
          (b.contractAddress || '').toLowerCase();
        const sameTokenId = a.tokenId === b.tokenId;
        // For ERC-1155, both contractAddress and tokenId must match
        // For other tokens, just contractAddress needs to match
        return a.tokenStandard === 'ERC-1155' || b.tokenStandard === 'ERC-1155'
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
