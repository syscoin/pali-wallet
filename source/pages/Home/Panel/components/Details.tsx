import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { ExternalLinkSvg, LoadingSvg } from 'components/Icon/Icon';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { RootState } from 'state/store';
import { adjustUrl } from 'utils/index';

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
      `${adjustUrl(activeNetwork.url)}${isAsset ? 'asset' : 'tx'}/${
        isAsset ? id : hash
      }`,
      '_blank'
    );
  };

  const isLoading = (isAsset && !id) || (!isAsset && !hash);

  return (
    <>
      {isLoading && !isNft ? (
        <LoadingSvg className="absolute left-1/2 top-1/2 w-3 animate-spin" />
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

            {!isAsset && !isNft ? (
              <li className="mt-6 mb-4 flex items-center justify-center">
                <div
                  className="flex items-center justify-center gap-2 cursor-pointer transition-all duration-300 hover:opacity-60 py-3 px-4 rounded-lg border border-dashed border-[#FFFFFF29]"
                  onClick={isBitcoinBased ? openSysExplorer : openEthExplorer}
                >
                  <ExternalLinkSvg className="w-4 h-4" />
                  <p className="text-sm text-white underline">
                    View on Explorer
                  </p>
                </div>
              </li>
            ) : null}
          </ul>
        </>
      )}
    </>
  );
};
