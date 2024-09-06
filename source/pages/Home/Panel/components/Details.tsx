import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import explorerImg from 'assets/icons/externalExplorer.svg';
import { Layout, Icon } from 'components/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { RootState } from 'state/store';

import { AssetDetails } from './AssetDetails';
import { NftsDetails } from './Nfts';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = () => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { t } = useTranslation();

  const {
    state: { id, hash, nftId, nftAddress },
  }: any = useLocation();

  const isAsset = id && !hash;

  const isNft = Boolean(nftId && nftAddress);

  const { explorer } = activeNetwork;

  const adjustedExplorer = useAdjustedExplorer(explorer);

  const openEthExplorer = () => {
    const url = `${adjustedExplorer}${isAsset ? 'address' : 'tx'}/${
      isAsset ? id : hash
    }`;
    window.open(url, '_blank');
  };

  const openSysExplorer = () => {
    window.open(
      `${activeNetwork.url}${isAsset ? '/asset' : '/tx'}/${
        isAsset ? id : hash
      }`,
      '_blank'
    );
  };

  const isLoading = (isAsset && !id) || (!isAsset && !hash);

  return (
    <Layout
      title={`${
        isNft
          ? 'NFT DETAILS'
          : isAsset
          ? t('titles.assetDetails')
          : t('titles.transactionDetails')
      }`}
    >
      {isLoading && !isNft ? (
        <Icon name="loading" className="absolute left-1/2 top-1/2 w-3" />
      ) : (
        <>
          <ul className="scrollbar-styled md:max-h-max w-full text-sm overflow-auto">
            {isAsset ? (
              <AssetDetails id={id} />
            ) : (
              <TransactionDetails hash={hash} />
            )}
            {isNft ? (
              <NftsDetails nftId={nftId} nftAddress={nftAddress} />
            ) : null}
          </ul>

          {!isAsset && !isNft ? (
            <div
              className="mt-6 flex items-center justify-center gap-2 cursor-pointer transition-all duration-300 hover:opacity-60"
              onClick={isBitcoinBased ? openSysExplorer : openEthExplorer}
            >
              <img className="w-4 h-4" src={explorerImg} />
              <p className="text-sm text-white underline">View on Explorer</p>
            </div>
          ) : null}
        </>
      )}
    </Layout>
  );
};
