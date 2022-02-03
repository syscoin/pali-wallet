import { Fullscreen } from 'components/Fullscreen';
import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';

import { PanelList } from './components/PanelList';

export const AssetsPanel: FC = () => {
  const { activeAccount } = useAccount();

  return (
    <>
      <ul className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {activeAccount?.assets && activeAccount?.assets.length > 0 ? (
          <PanelList data={activeAccount?.assets} activity={false} assets />
        ) : (
          <p className="flex items-center justify-center text-brand-white text-sm">
            You have no tokens or NFTs.
          </p>
        )}
      </ul>

      <Fullscreen />
    </>
  );
};
