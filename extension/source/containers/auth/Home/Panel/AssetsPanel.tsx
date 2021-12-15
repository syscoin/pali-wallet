import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';
import { PanelList } from './components/PanelList';

export const AssetsPanel: FC = () => {
  const { activeAccount } = useAccount(); 

  return (
    <ul className="h-full w-full p-4 text-white text-base bg-brand-navyborder">
      {activeAccount?.assets ? (
        <PanelList
          data={activeAccount?.assets}
          activity={false}
          assets={true}
        />
      ) : (
        <p className="flex justify-center items-center text-sm text-brand-gray">
          You have no tokens or NFTs.
        </p>
      )}
    </ul>
  )
}
