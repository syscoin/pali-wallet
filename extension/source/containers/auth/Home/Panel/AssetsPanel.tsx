import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';
import { PanelList } from './components/PanelList';

interface IAssetsPanel {
  show: boolean;
  className: any
}

export const AssetsPanel: FC<IAssetsPanel> = ({ show, className }) => {
  const assets = useAccount().activeAccount!.assets || [];

  return (
    <ul className={className}>
      {show ? (
        <PanelList
          data={assets}
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
