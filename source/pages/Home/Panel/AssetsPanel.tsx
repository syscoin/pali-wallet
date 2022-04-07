import { Fullscreen } from 'components/Fullscreen';
import React, { FC } from 'react';
import { useStore, useUtils } from 'hooks/index';

import { PanelList } from './components/PanelList';

export const AssetsPanel: FC = () => {
  const { navigate } = useUtils();
  const { activeNetwork, networks, activeAccount } = useStore();
  const isSyscoinChain = networks.syscoin[activeNetwork.chainId];

  return (
    <>
      <ul className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {Object.values(activeAccount.assets) ? (
          <PanelList data={[]} activity={false} assets />
        ) : (
          <p
            onClick={() => navigate('/import-token')}
            className={`${
              isSyscoinChain ? 'text-brand-white' : 'text-brand-royalblue'
            } flex items-center justify-center text-sm`}
          >
            {isSyscoinChain ? 'You have no tokens or NFTs.' : 'Import token'}
          </p>
        )}
      </ul>

      <Fullscreen />
    </>
  );
};
