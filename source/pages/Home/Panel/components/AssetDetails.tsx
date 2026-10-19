import React from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import { EvmAssetDetails, SyscoinAssetDetails } from './Assets/index';

export const AssetDetails = ({
  id,
  navigationState,
}: {
  id: string;
  navigationState?: any;
}) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  return !isBitcoinBased ? (
    <EvmAssetDetails id={id} navigationState={navigationState} />
  ) : (
    <SyscoinAssetDetails id={id} navigationState={navigationState} />
  );
};
