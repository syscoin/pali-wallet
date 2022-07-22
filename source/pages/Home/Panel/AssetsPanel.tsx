import React, { FC } from 'react';

import { Fullscreen } from 'components/Fullscreen';
import { useStore, useUtils } from 'hooks/index';

import { PanelList } from './components/PanelList';

export const AssetsPanel: FC = () => {
  const { navigate } = useUtils();
  const { activeNetwork, networks, activeAccount } = useStore();
  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  return (
    <>
      <ul className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {activeAccount.assets &&
        Object.values(activeAccount.assets).length > 0 ? (
          <PanelList
            isSyscoinChain={isSyscoinChain}
            data={Object.values(activeAccount.assets)}
            activity={false}
            assets
          />
        ) : (
          <div className="flex items-center justify-center text-brand-white text-sm">
            {isSyscoinChain ? (
              'You have no tokens or NFTs.'
            ) : (
              <>
                <p
                  className="hover:text-brand-royalbluemedium cursor-pointer"
                  onClick={() => navigate('/import-token')}
                >
                  Import token
                </p>
              </>
            )}
          </div>
        )}
      </ul>

      <Fullscreen />
    </>
  );
};
