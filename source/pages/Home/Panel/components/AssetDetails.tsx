import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import { EvmAssetDetais, SyscoinAssetDetais } from './Assets/index';

export const AssetDetails = ({ id }: { id: string }) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  return !isBitcoinBased ? (
    <EvmAssetDetais id={id} />
  ) : (
    <SyscoinAssetDetais id={id} />
  );
};
