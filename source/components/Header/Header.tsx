import React from 'react';
import { useStore } from 'hooks/index';
import { Loading } from 'components/index';

import { AccountHeader, NormalHeader } from '.';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const { isPendingBalances } = useStore();

  const headerStyle = accountHeader ? 'pb-32' : 'pb-12';

  return (
    <div className={headerStyle}>
      {isPendingBalances && <Loading opacity={50} />}

      <div className="fixed z-10 w-full md:max-w-2xl">
        <>
          <NormalHeader />

          {accountHeader && <AccountHeader />}
        </>
      </div>
    </div>
  );
};
