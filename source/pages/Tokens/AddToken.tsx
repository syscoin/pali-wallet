import { Switch } from '@headlessui/react';
import React from 'react';
import { useState, FC } from 'react';
import { useSelector } from 'react-redux';

import { Layout } from 'components/index';
import { RootState } from 'state/store';

import { CustomToken } from './CustomToken';
import { ImportToken } from './ImportToken';
import { SyscoinImportToken } from './SyscoinImport';

export const AddToken: FC = () => {
  const [importCustom, setImportCustom] = useState(false);

  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  return (
    <Layout title="IMPORT TOKEN">
      {isBitcoinBased ? (
        <SyscoinImportToken />
      ) : (
        <>
          <div className="flex gap-x-2 mb-4 text-xs">
            <p className="text-brand-royalblue">Search</p>

            <Switch
              checked={importCustom}
              onChange={() => setImportCustom(!importCustom)}
              className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
            >
              <span className="sr-only">Search or custom token</span>
              <span
                className={`${
                  importCustom
                    ? 'translate-x-6 bg-brand-royalblue'
                    : 'translate-x-1 bg-brand-deepPink100'
                } inline-block w-2 h-2 transform rounded-full`}
              />
            </Switch>

            <p className="text-brand-deepPink100">Custom token</p>
          </div>

          {importCustom ? <CustomToken /> : <ImportToken />}
        </>
      )}
    </Layout>
  );
};
