import { Fullscreen } from 'components/Fullscreen';
import React, { FC } from 'react';
import { useStore } from 'hooks/useStore';

import { PanelList } from './components/PanelList';

export const ActivityPanel: FC = () => {
  const { activeAccount, activeNetwork, networks } = useStore();

  const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

  return (
    <>
      <div className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {activeAccount && activeAccount.transactions.length > 0 ? (
          <PanelList
            data={activeAccount.transactions}
            activity
            assets={false}
            isSyscoinChain={isSyscoinChain}
          />
        ) : (
          <p className="flex items-center justify-center text-brand-white text-sm">
            You have no transaction history.
          </p>
        )}
      </div>

      <Fullscreen />
    </>
  );
};
