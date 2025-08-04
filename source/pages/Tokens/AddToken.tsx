import React, { FC } from 'react';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

import { ImportToken } from './ImportToken';
import { SyscoinImport } from './SyscoinImport';

export const AddToken: FC = () => {
  const { isBitcoinBased } = useSelector(
    (paliState: RootState) => paliState.vault
  );

  return <>{isBitcoinBased ? <SyscoinImport /> : <ImportToken />}</>;
};
