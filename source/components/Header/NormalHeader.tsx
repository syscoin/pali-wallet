import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { ErrorModal } from 'components/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { NetworkMenu, GeneralMenu } from './Menus';

export const NormalHeader: React.FC = () => {
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
    <div className="relative flex items-center justify-between p-2 py-6 w-full text-gray-300 bg-bkg-1">
      <NetworkMenu />

      <GeneralMenu />

      <ErrorModal
        title="Error switching networks"
        description="There was an error while trying to switch network. Try again later."
        log={networkErrorStatus.description}
        show={networkErrorStatus.error}
        onClose={() =>
          setNetworkErrorStatus({ error: false, description: '', title: '' })
        }
      />
    </div>
  );
};
