import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { browser } from 'webextension-polyfill-ts';

import { Layout, Button, Icon } from 'components/index';
import { RootState } from 'state/store';

import { AssetDetails } from './AssetDetails';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = () => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const {
    state: { id, hash },
  }: any = useLocation();

  const isAsset = id && !hash;

  const openEthExplorer = () => {
    browser.windows.create({
      url: `${activeNetwork.explorer}${isAsset ? 'address' : 'tx'}/${
        isAsset ? id : hash
      }`,
    });
  };

  const openSysExplorer = () => {
    browser.windows.create({
      url: `${activeNetwork.url}${isAsset ? 'asset' : 'tx'}/${
        isAsset ? id : hash
      }`,
    });
  };

  const isLoading = (isAsset && !id) || (!isAsset && !hash);

  return (
    <Layout title={`${isAsset ? 'ASSET DETAILS' : 'TRANSACTION DETAILS'}`}>
      {isLoading ? (
        <Icon name="loading" className="absolute left-1/2 top-1/2 w-3" />
      ) : (
        <>
          <ul className="scrollbar-styled md:max-h-max w-full h-96 text-sm overflow-auto">
            {isAsset ? (
              <AssetDetails id={id} />
            ) : (
              <TransactionDetails hash={hash} />
            )}
          </ul>

          <div className="fixed bottom-0 left-0 right-0 flex gap-x-6 items-center justify-between mx-auto p-4 w-full text-xs bg-bkg-4 md:bottom-8 md:max-w-2xl">
            <p className="font-normal" style={{ lineHeight: '18px' }}>
              View this {isAsset ? 'asset' : 'transaction'} on{' '}
              {isBitcoinBased ? 'Syscoin' : ''} Explorer?
            </p>

            <Button
              type="button"
              onClick={isBitcoinBased ? openSysExplorer : openEthExplorer}
              className="inline-flex justify-center px-1.5 py-2 text-bkg-blue200 text-base font-semibold bg-bkg-white850 hover:bg-transparent border border-bkg-white850 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
            >
              Ok
            </Button>
          </div>
        </>
      )}
    </Layout>
  );
};
