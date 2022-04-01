import { Fullscreen } from 'components/Fullscreen';
import React, { FC } from 'react';
import { useStore } from 'hooks/useStore';

import { PanelList } from './components/PanelList';

export const AssetsPanel: FC = () => {
  const { activeAccount } = useStore();

  return (
    <>
      <ul className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {activeAccount?.tokens ? (
          <PanelList data={[]} activity={false} assets />
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
