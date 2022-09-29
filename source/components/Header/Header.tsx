import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { ErrorModal } from '..';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { AccountHeader } from '.';
import { GeneralMenu, NetworkMenu } from './Menus';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const { wallet } = getController();

  const error = useSelector((state: RootState) => state.vault.error);

  const isPendingBalances = useSelector(
    (state: RootState) => state.vault.isPendingBalances
  );

  const [networkErrorStatus, setNetworkErrorStatus] = useState({
    error: false,
    description: '',
    title: '',
  });

  useEffect(() => {
    if (!isPendingBalances && error) {
      setNetworkErrorStatus({
        error: true,
        description:
          'There was an error while trying to switch network. Try again later.',
        title: 'Error switching networks',
      });

      wallet.resolveError();
    }
  }, [isPendingBalances, error]);

  return (
    <div className={accountHeader ? 'pb-32' : 'pb-12'}>
      <div className="fixed z-10 w-full md:max-w-2xl">
        <div className="relative flex items-center justify-between p-2 py-6 w-full text-gray-300 bg-bkg-1">
          <NetworkMenu />

          <GeneralMenu />

          <ErrorModal
            title="Error switching networks"
            description="There was an error while trying to switch network. Try again later."
            log={networkErrorStatus.description}
            show={networkErrorStatus.error}
            onClose={() =>
              setNetworkErrorStatus({
                error: false,
                description: '',
                title: '',
              })
            }
          />
        </div>

        {accountHeader && <AccountHeader />}
      </div>
    </div>
  );
};
