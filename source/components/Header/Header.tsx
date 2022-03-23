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
    <div className={headerStyle}>
      {changingNetwork && (
        <div className="fixed z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-brand-black bg-opacity-50">
          <Icon name="loading" className="ml-2 w-4 text-brand-white" />
        </div>
      )}

      <div className="fixed z-10 w-full md:max-w-2xl">
        <>
          <NormalHeader />
          {accountHeader && <AccountHeader />}
        </>
      </div>
    </div>
  );
};
