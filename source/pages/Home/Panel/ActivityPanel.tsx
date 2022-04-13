import { Fullscreen } from 'components/Fullscreen';
import React, { FC } from 'react';
import { useStore } from 'hooks/useStore';

import { PanelList } from './components/PanelList';

export const ActivityPanel: FC = () => {
  const { activeAccount, activeNetwork, accounts } = useStore();

  return (
    <>
      <div className="p-4 w-full h-full text-white text-base bg-bkg-3">
        {activeNetwork.chainId === 1 || activeNetwork.chainId === 4 ? (
          accounts[0].ethTransactions === [] ? (
            <p className="flex items-center justify-center text-brand-white text-sm">
              You have no transaction history.
            </p>
          ) : (
            <PanelList
              data={accounts[0].ethTransactions}
              activity
              isSyscoinChain={false}
              assets={false}
            />
          )
        ) : activeAccount &&
          activeAccount.transactions &&
          Object.values(activeAccount.transactions).length > 0 ? (
          <PanelList data={[]} activity assets={false} />
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
