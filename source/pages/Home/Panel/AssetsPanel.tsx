import React from 'react';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { RootState } from 'state/store';

import { EvmAssetsList, SyscoinAssetsList } from './components/Assets';

export const AssetsPanel = () => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networks = useSelector((state: RootState) => state.vault.networks);
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  const assets = Object.values(activeAccount.assets);

  const NoAssetsComponent = () => (
    <div className="flex items-center justify-center p-3 text-brand-white text-sm">
      <p>You have no tokens or NFTs.</p>
    </div>
  );

  return (
    <>
      {assets.length === 0 ? (
        <NoAssetsComponent />
      ) : (
        <ul className="pb-14 pt-4 px-4 w-full text-center text-white text-base bg-bkg-3">
          {isSyscoinChain ? <SyscoinAssetsList /> : <EvmAssetsList />}
        </ul>
      )}

      <Fullscreen />
    </>
  );
};
