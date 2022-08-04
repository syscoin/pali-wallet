import React from 'react';

import { Fullscreen } from 'components/Fullscreen';
import { useStore } from 'hooks/index';

import { EvmAssetsList, SyscoinAssetsList } from './components/Assets';

export const AssetsPanel = () => {
  const { activeNetwork, networks, activeAccount } = useStore();
  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  const assets = Object.values(activeAccount.assets);

  const NoAssetsComponent = () => (
    <div className="flex items-center justify-center text-brand-white text-sm">
      {/* {isSyscoinChain ? (
        'You have no tokens or NFTs.'
      ) : (
        <>
          <p
            className="hover:text-brand-royalbluemedium cursor-pointer"
            onClick={() => navigate('/tokens/add/import')}
          >
            Import token
          </p>
        </>
      )} */}

      <p>You have no tokens or NFTs.</p>
    </div>
  );

  return assets.length === 0 ? (
    <>
      <NoAssetsComponent />
      <Fullscreen />
    </>
  ) : (
    <>
      <ul className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {isSyscoinChain ? <SyscoinAssetsList /> : <EvmAssetsList />}
      </ul>
    </>
  );
};
