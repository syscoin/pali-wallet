import React from 'react';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';

import { EvmAssetsList, SyscoinAssetsList } from './components/Assets';

export const AssetsPanel = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const assets = Object.values(activeAccount.assets);

  const { navigate } = useUtils();

  const NoAssetsComponent = () => (
    <div className="flex items-center justify-center p-3 text-brand-white text-sm">
      <p>You have no tokens or NFTs.</p>
    </div>
  );

  return (
    <div className="pb-14 w-full">
      {assets.length === 0 ? (
        <NoAssetsComponent />
      ) : (
        <ul className="pt-4 px-4 w-full text-center text-white text-base bg-bkg-3">
          {isBitcoinBased ? <SyscoinAssetsList /> : <EvmAssetsList />}
        </ul>
      )}

      <p
        className="mb-3 mt-4 text-center hover:text-brand-deepPink100 text-brand-white text-xs cursor-pointer transition-all duration-300"
        onClick={() => navigate('/tokens/add')}
      >
        Import token
      </p>
      <Fullscreen />
    </div>
  );
};
