import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';
import { PanelList } from './components/PanelList';

export const ActivityPanel: FC = () => {
  const { activeAccount } = useAccount();

  return (
    <div className="h-full w-full p-4 text-white text-base bg-brand-navyborder">
      {activeAccount!.transactions ? (
        <PanelList
          data={activeAccount!.transactions}
          activity={true}
          assets={false}
        />
      ) : (
        <p className="justify-center items-center text-sm text-brand-gray">
          You have no transaction history.
        </p>
      )}
    </div>
  );
};
