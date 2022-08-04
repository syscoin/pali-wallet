import React from 'react';

import { useStore } from 'hooks/index';

import { EvmAssetDetais, SyscoinAssetDetais } from './Assets/index';

export const AssetDetails = ({ id }: { id: string }) => {
  const { activeNetwork, networks } = useStore();

  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  return !isSyscoinChain ? (
    <EvmAssetDetais id={id} />
  ) : (
    <SyscoinAssetDetais id={id} />
  );
};
