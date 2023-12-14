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
      `${activeNetwork.url}${isAsset ? 'asset' : 'tx'}/${isAsset ? id : hash}`,
      '_blank'
    );
  };

  const isLoading = (isAsset && !id) || (!isAsset && !hash);

  const getTxStatusIcons = (txLabel: string) => {
    let icon = '';

    switch (txLabel) {
      case 'Sent':
        icon = '/assets/icons/ArrowUp.svg';
        break;
      case 'Received':
        icon = '/assets/icons/receivedArrow.svg';
        break;
    }

    return (
      <div className="relative w-[36px] h-[36px] bg-brand-whiteAlpaBlue rounded-[100px] mr-2 flex items-center justify-center">
        <img className="relative" src={icon} alt="Icon" />
      </div>
    );
  };
  console.log(hash);
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
      {/* <div className="flex flex-col justify-center items-center w-full mb-2">
        {isBitcoinBased && getTxStatusIcons(getTxType(tx, isTxSent))}
        <p className="text-brand-gray200 text-xs font-light">Transaction</p>
        <p className="text-white text-base">55,000.00 SYS</p>
        <p className="text-xs font-normal text-brand-green">Confirmed</p>
      </div> */}
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
