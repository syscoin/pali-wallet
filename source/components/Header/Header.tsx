import React from 'react';
import { useStore } from 'hooks/index';
import { Icon } from 'components/Icon';

import { AccountHeader, NormalHeader } from '.';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const { changingNetwork } = useStore();

  const headerStyle = accountHeader ? 'pb-32' : 'pb-12';

  return (
    <div>
      <div className="w-full h-28" />

      {changingNetwork && (
        <div className="fixed z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-brand-black bg-opacity-50">
          <Icon name="loading" className="ml-2 w-4 text-brand-white" />
        </div>
      )}

      <div className="fixed z-10 top-0 w-full">
        <NormalHeader />

        {accountHeader && <AccountHeader />}
      </div>
    </div>
  );
};
