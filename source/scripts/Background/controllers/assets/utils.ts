import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import maxBy from 'lodash/maxBy';
import uniqWith from 'lodash/uniqWith';

import store from 'state/store';

import { ISysTokensAssetReponse } from './types';

export const mergeArraysAndTreatValues = (
  assets: ISysTokensAssetReponse[]
): ISysTokensAssetReponse[] => {
  if (assets.length === 0) return [];

  const grouped = groupBy(assets, 'assetGuid');

  return uniqWith(
    flatMap(grouped, (items) => {
      const maxItem = maxBy(items, (item) => [
        parseFloat(item.balance) || 0,
        item.totalReceived,
        item.totalSent,
      ]);
      return maxItem ? [maxItem] : [];
    }).sort(
      (a, b) => (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0)
    ),
    (a, b) => a.assetGuid === b.assetGuid
  );
};

export const validateAndManageUserAssets = (
  fetchedAssets: ISysTokensAssetReponse[]
) => {
  if (fetchedAssets.length === 0) return [];

  const { accounts, activeAccount } = store.getState().vault;

  const {
    assets: { syscoin: sysUserAssets },
  } = accounts[activeAccount.type][activeAccount.id];

  const userClonedAssets = clone(compact(sysUserAssets));

  const mergedArrays = [...fetchedAssets, ...userClonedAssets];

  return mergeArraysAndTreatValues(mergedArrays);
};
