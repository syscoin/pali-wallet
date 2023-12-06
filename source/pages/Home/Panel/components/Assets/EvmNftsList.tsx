import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';

import { detectCollectibles } from '@pollum-io/sysweb3-utils';

import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const EvmNftsList = () => {
  const controller = getController();
  const { accounts, activeAccount, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const userAddress = accounts[activeAccount.type][activeAccount.id].address;

  const getUserNfts = async () => {
    await controller.wallet.fetchAndUpdateNftsState({
      activeAccount,
      activeNetwork,
    });
  };

  useEffect(() => {
    getUserNfts();
  }, [userAddress, activeNetwork.chainId]);

  return <p>Nfts here</p>;
};
