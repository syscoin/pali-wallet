import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';

import { detectCollectibles } from '@pollum-io/sysweb3-utils';

import { RootState } from 'state/store';

export const EvmNftsList = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { chainId, url },
  } = useSelector((state: RootState) => state.vault);

  const userAddress = accounts[activeAccount.type][activeAccount.id].address;

  const getUserNfts = async () => {
    const nfts = await detectCollectibles(userAddress, chainId, url);

    console.log('nfts', nfts);
  };

  useEffect(() => {
    getUserNfts();
  }, [userAddress, chainId]);

  return <p>Nfts here</p>;
};
