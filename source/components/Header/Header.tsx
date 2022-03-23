import React from 'react';
import { useStore } from 'hooks/index';
import { Icon } from 'components/Icon';

import { AccountHeader, NormalHeader } from '.';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const { changingNetwork } = useStore();

  return (
    <div>
      <div className={`bg-bkg-6 w-full ${accountHeader ? 'h-32' : 'h-12'}`} />

      {changingNetwork && (
        <div className="fixed z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-brand-black bg-opacity-50">
          <Icon name="loading" className="ml-2 w-4 text-brand-white" />
        </div>
      )}

      <div className="fixed z-10 left-0 right-0 top-0 mx-auto w-full max-w-3xl">
        <NormalHeader />

        {accountHeader && <AccountHeader />}
      </div>
    </div>
  );
};
