import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import { EvmAssetDetails, SyscoinAssetDetails } from './Assets/index';

export const AssetDetails = ({ id }: { id: string }) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  return !isBitcoinBased ? (
    <EvmAssetDetails id={id} />
  ) : (
    <SyscoinAssetDetails id={id} />
  );
};
