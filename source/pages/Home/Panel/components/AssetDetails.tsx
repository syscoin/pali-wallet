import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';

import { EvmAssetDetais, SyscoinAssetDetais } from './Assets/index';

export const AssetDetails = ({ id }: { id: string }) => {
  const { activeNetwork, networks }: IVaultState = useSelector(
    (state: RootState) => state.vault
  );

  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  return !isSyscoinChain ? (
    <EvmAssetDetais id={id} />
  ) : (
    <SyscoinAssetDetais id={id} />
  );
};
