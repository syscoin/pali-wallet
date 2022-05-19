import React from 'react';

import { AccountHeader, NormalHeader } from '.';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const headerStyle = accountHeader ? 'pb-32' : 'pb-12';

  return (
    <div className={headerStyle}>
      <div className="fixed z-10 w-full md:max-w-2xl">
        <>
          <NormalHeader />

          {accountHeader && <AccountHeader />}
        </>
      </div>
    </div>
  );
};
