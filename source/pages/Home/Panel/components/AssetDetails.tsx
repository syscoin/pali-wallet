import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { RootState } from 'state/store';

import { EvmAssetDetails, SyscoinAssetDetails } from './Assets/index';

export const AssetDetails = ({ id }: { id: string }) => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  // Get navigation state for import preview
  const { state } = useLocation();

  return !isBitcoinBased ? (
    <EvmAssetDetails id={id} navigationState={state} />
  ) : (
    <SyscoinAssetDetails id={id} navigationState={state} />
  );
};
