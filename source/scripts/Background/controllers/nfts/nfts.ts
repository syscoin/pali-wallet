import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEqual from 'lodash/isEqual';
import sortBy from 'lodash/sortBy';
import uniqWith from 'lodash/uniqWith';

import { INftsStructure, detectCollectibles } from '@pollum-io/sysweb3-utils';

import store from 'state/store';

const NftsController = () => {
  const getUserNfts = async (
    userAddress: string,
    chainId: number,
    rpcUrl: string
  ) => {
    const userNfts = await detectCollectibles(
      '0xEaA9eD27e5521A2721cBC6C5FE7B790CefEf520b',
      chainId,
      rpcUrl
    );

    return validateAndManagerUserNfts(userNfts);
  };

  const validateAndManagerUserNfts = (fetchedNfts: INftsStructure[]) => {
    if (fetchedNfts.length === 0) return [];

    const { accounts, activeAccount } = store.getState().vault;

    const { assets } = accounts[activeAccount.type][activeAccount.id];

    const nftsValueToUse = assets.nfts;

    const userClonedNfts = clone(compact(nftsValueToUse));

    const nftPropertyToUseAtGroupBy = ['address', 'token_id', 'chainId'];

    const validateIfNftsIsEquals = isEqual(
      sortBy(userClonedNfts, nftPropertyToUseAtGroupBy),
      sortBy(fetchedNfts, nftPropertyToUseAtGroupBy)
    );

    //Return a empty array to we don't need to dispatch something at the Polling
    if (validateIfNftsIsEquals) {
      return [];
    }

    return uniqWith(
      flatMap(fetchedNfts),
      (a, b) =>
        a[nftPropertyToUseAtGroupBy[0]] === b[nftPropertyToUseAtGroupBy[0]] &&
        a[nftPropertyToUseAtGroupBy[1]] === b[nftPropertyToUseAtGroupBy[1]] &&
        a[nftPropertyToUseAtGroupBy[2]] === b[nftPropertyToUseAtGroupBy[2]]
    );
  };

  return {
    getUserNfts,
    validateAndManagerUserNfts,
  };
};

export default NftsController;
