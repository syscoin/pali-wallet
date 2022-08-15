import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import { EvmAssetDetais, SyscoinAssetDetais } from './Assets/index';

export const AssetDetails = ({ id }: { id: string }) => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networks = useSelector((state: RootState) => state.vault.networks);

  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  return !isSyscoinChain ? (
    <EvmAssetDetais id={id} />
  ) : (
    <SyscoinAssetDetais id={id} />
  );
};
