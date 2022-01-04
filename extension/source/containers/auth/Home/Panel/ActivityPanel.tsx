import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';
import { PanelList } from './components/PanelList';

export const ActivityPanel: FC = () => {
  const { activeAccount } = useAccount();

  return (
    <div className="h-full w-full p-4 text-white text-base bg-bkg-3">
      {activeAccount?.transactions && activeAccount!.transactions.length > 0 ? (
        <PanelList
          data={activeAccount?.transactions}
          activity={true}
          assets={false}
        />
      ) : (
        <p className="flex justify-center items-center text-sm text-brand-white">
          You have no transaction history.
        </p>
      )}
    </div>
  );
};
