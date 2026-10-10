import React, { FC } from 'react';
import { useSelector } from 'react-redux';

import { getHomeBrowsingScope } from '../Home/useHomeBrowsingState';
import { RootState } from 'state/store';

import { ImportToken } from './ImportToken';
import { SyscoinImport } from './SyscoinImport';

export const AddToken: FC = () => {
  const { isBitcoinBased, activeAccount, activeNetwork, accounts } =
    useSelector((paliState: RootState) => paliState.vault);

  const account = accounts[activeAccount.type]?.[activeAccount.id];
  const scope = getHomeBrowsingScope(
    { ...account, ...activeAccount },
    activeNetwork,
    isBitcoinBased
  );
  return (
    <>
      {isBitcoinBased ? (
        <SyscoinImport key={scope} />
      ) : (
        <ImportToken key={scope} />
      )}
    </>
  );
};
