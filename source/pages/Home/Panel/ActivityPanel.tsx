import { Fullscreen } from 'components/Fullscreen';
import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';

import { PanelList } from './components/PanelList';

export const ActivityPanel: FC = () => {
  const { activeAccount } = useAccount();

  return (
    <>
      <div className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {activeAccount?.transactions &&
        activeAccount.transactions.length > 0 ? (
          <PanelList
            data={activeAccount?.transactions}
            activity
            assets={false}
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
