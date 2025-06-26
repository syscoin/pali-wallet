import { ethers } from 'ethers';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { RiFileCopyLine as CopyIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import { Button, NeutralButton } from 'components/index';
import { useUtils, useAdjustedExplorer } from 'hooks/index';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import { ellipsis } from 'utils/index';
import { NFT_FALLBACK_IMAGE } from 'utils/nftFallback';

export const NftsDetails = ({
  nftId,
  nftAddress,
}: {
  nftAddress: string;
  nftId: string;
}) => {
  const {
    activeNetwork: { label, explorer },
  } = useSelector((state: RootState) => state.vault);

  // Use proper selector for assets
  const accountAssets = useSelector(selectActiveAccountAssets);

  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  const { t } = useTranslation();

  const currentNft = accountAssets.nfts.find(
    (nft) => nft.token_id === nftId && nft.address === nftAddress
  );

  const adjustedExplorer = useAdjustedExplorer(explorer);

  const openOnLuxy = () => {
    const defaultUrl = 'https://luxy.io/collections';

    const collectionNameTransformed = currentNft.collection.name
      .toLowerCase()
      .replaceAll(' ', '-');

    return window.open(
      `${defaultUrl}/${collectionNameTransformed}/${label}/${Number(
        currentNft.token_id
      )}`,
      '_blank',
      'noopener, noreferrer'
    );
  };

  useEffect(() => {
    if (!copied) return;

    setTimeout(() => {
      alert.removeAll();
      alert.info(t('home.contractCopied'));
    }, 0);
  }, [copied, alert, t]);

  return (
    <>
      {currentNft.address ? (
        <div className="pb-6">
          <div className="w-full flex flex-col items-center justify-center gap-y-4">
            <div>
              <img
                id={`${currentNft.name}`}
                className="rounded-[10px] w-[153px] h-[153px]"
                src={currentNft?.image_preview_url || NFT_FALLBACK_IMAGE}
              />
            </div>

            <div className="w-full flex items-center justify-evenly h-14 font-poppins">
              <p className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                {ethers.BigNumber.from(currentNft.balanceOf).toNumber()}
                <span className="text-sm font-normal text-brand-gray200">
                  Amount
                </span>
              </p>
              <p className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                {currentNft.last_sale?.total_price
                  ? currentNft.last_sale.total_price
                  : 'No info'}
                <span className="text-sm font-normal text-brand-gray200">
                  Last Price
                </span>
              </p>
              <p className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                <ChainIcon
                  chainId={Number(currentNft.chainId)}
                  size={28}
                  className=""
                />
                <span className="text-sm font-normal text-brand-gray200">
                  Network
                </span>
              </p>
            </div>
          </div>

          <div className="w-full flex flex-col gap-y-4 my-4">
            <div
              className="w-full bg-brand-blue800 flex flex-col items-start gap-y-3"
              style={{ borderRadius: '20px', padding: '17px 16px' }}
            >
              <p className="font-poppins font-bold text-base">About</p>

              <p className="text-xs font-normal">{currentNft.description}</p>

              <div className="w-full flex items-center text-xs font-normal gap-x-1.5">
                <p className="text-brand-gray200">Created by:</p>

                <img
                  className="w-6 h-6 rounded-full"
                  src={
                    currentNft.creator?.profile_img_url || NFT_FALLBACK_IMAGE
                  }
                  alt={currentNft.creator?.user?.username}
                />

                <span
                  className="text-ellipsis overflow-hidden text-brand-white"
                  style={{ maxWidth: '60%' }}
                >
                  {currentNft.creator?.user?.username || 'Luxy User'}
                </span>
              </div>
            </div>

            <div
              className="w-full bg-brand-blue800 flex flex-col items-start gap-y-3"
              style={{ borderRadius: '20px', padding: '17px 16px' }}
            >
              <p className="font-poppins font-bold text-base">
                Collection Intro
              </p>

              <div className="w-full flex items-center text-xs font-normal gap-x-1.5">
                <img
                  className="w-6 h-6 rounded-full"
                  src={currentNft.collection?.image_url || NFT_FALLBACK_IMAGE}
                  alt={currentNft.collection?.name}
                />

                <span className="text-brand-gray200">
                  {currentNft.collection.name}
                </span>
              </div>

              <p className="text-xs font-normal">
                {currentNft.collection?.description}
              </p>
            </div>

            <div
              className="w-full bg-brand-blue800 flex flex-col items-start gap-y-3"
              style={{ borderRadius: '20px', padding: '17px 16px' }}
            >
              <p className="font-poppins font-bold text-base">Technical Info</p>

              <ul className="w-full">
                <li
                  className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
                  border-dashed border-bkg-white200 cursor-default transition-all duration-300"
                >
                  <p className="font-normal text-xs">Token ID</p>
                  <p className="flex items-center font-normal gap-x-1.5 text-xs">
                    <span className="text-brand-white">
                      {currentNft.token_id.length > 9
                        ? ellipsis(currentNft.token_id)
                        : currentNft.token_id}
                    </span>

                    <CopyIcon
                      size={15}
                      className="hover:text-brand-deepPink100 cursor-pointer"
                      color="text-brand-white"
                      onClick={() => copy(currentNft.token_id ?? '')}
                    />
                  </p>
                </li>

                <li
                  className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs  cursor-default transition-all duration-300 
                  border-none"
                >
                  <p className="font-normal text-xs">Contract Address</p>
                  <p className="flex items-center font-normal gap-x-1.5 text-xs">
                    <span className="text-brand-white">
                      {ellipsis(currentNft.address)}
                    </span>

                    <CopyIcon
                      size={15}
                      className="hover:text-brand-deepPink100 cursor-pointer"
                      color="text-brand-white"
                      onClick={() => copy(currentNft.address ?? '')}
                    />
                  </p>
                </li>
              </ul>
            </div>
          </div>

          <div className="w-full flex items-center justify-center text-brand-white hover:text-brand-deepPink100 my-6">
            <a
              href={`${adjustedExplorer}address/${currentNft.address}`}
              target="_blank"
              className="flex items-center justify-center gap-x-2"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={16} />
              <span className="font-normal font-poppins underline text-sm">
                View on Explorer
              </span>
            </a>
          </div>

          <div className="flex flex-col items-center justify-center w-full">
            <div className="w-full flex justify-between items-center">
              <Button
                type="button"
                className="h-10 py-2.5 border rounded-full"
                onClick={() => openOnLuxy()}
              >
                See on LUXY
              </Button>

              <NeutralButton type="button">{t('buttons.send')}</NeutralButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
