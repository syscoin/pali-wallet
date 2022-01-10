import { Fullscreen } from 'components/Fullscreen';
import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';
import { PanelList } from './components/PanelList';

export const AssetsPanel: FC = () => {
  const { activeAccount } = useAccount();

  return (
    <>
      <ul className="h-full w-full p-4 text-white text-base bg-bkg-3">
        {activeAccount?.assets && activeAccount?.assets.length > 0 ? (
          <PanelList
            data={activeAccount?.assets}
            activity={false}
            assets={true}
          />
        ) : (
          <p className="flex justify-center items-center text-sm text-brand-white">
            You have no tokens or NFTs.
          </p>
        )}
      </ul>

      <Fullscreen />
    </>
  )
}
