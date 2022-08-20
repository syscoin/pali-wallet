import React from 'react';
import { useLocation } from 'react-router-dom';

import { Layout, Button, Icon } from 'components/index';
import { useStore } from 'hooks/index';

import { AssetDetails } from './AssetDetails';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = () => {
  const { activeNetwork, networks } = useStore();

  const {
    state: { id, hash },
  }: any = useLocation();

  const isSyscoinChain =
    Boolean(networks.syscoin[activeNetwork.chainId]) &&
    activeNetwork.url.includes('blockbook');

  const isAsset = id && !hash;

  const openEthExplorer = () => {
    const { explorer } = activeNetwork;

    window.open(
      `${explorer}/${isAsset ? 'address' : 'tx'}/${isAsset ? id : hash}`
    );
  };

  const openSysExplorer = () => {
    window.open(
      `${activeNetwork.url}/${isAsset ? 'asset' : 'tx'}/${isAsset ? id : hash}`
    );
  };

  const isLoading = (isAsset && !id) || (!isAsset && !hash);

  return (
    <Layout title={`${isAsset ? 'ASSET DETAILS' : 'TRANSACTION DETAILS'}`}>
      {isLoading ? (
        <Icon name="loading" className="absolute left-1/2 top-1/2 w-3" />
      ) : (
        <>
          <ul className="scrollbar-styled md:max-h-max mt-4 w-full h-96 text-sm overflow-auto">
            {isAsset ? (
              <AssetDetails id={id} />
            ) : (
              <TransactionDetails hash={hash} />
            )}
          </ul>

          <div className="fixed bottom-0 left-0 right-0 flex gap-x-6 items-center justify-between mx-auto p-4 w-full text-xs bg-bkg-3 md:bottom-8 md:max-w-2xl">
            <p>
              Would you like to go to view {isAsset ? 'asset' : 'transaction'}{' '}
              on {isSyscoinChain ? 'SYS Block' : 'Etherscan'} Explorer?
            </p>

            <Button
              type="button"
              onClick={isSyscoinChain ? openSysExplorer : openEthExplorer}
              className="inline-flex justify-center px-6 py-1 hover:text-brand-royalblue text-brand-white text-sm font-medium hover:bg-button-popuphover bg-transparent border border-brand-white rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
            >
              Go
            </Button>
          </div>
        </>
      )}
    </Layout>
  );
};
