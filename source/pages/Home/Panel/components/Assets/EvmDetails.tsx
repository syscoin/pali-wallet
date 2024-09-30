import { Disclosure } from '@headlessui/react';
import { uniqueId } from 'lodash';
import React, { Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { RiFileCopyLine as CopyIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { NeutralButton, Icon } from 'components/index';
import { useAdjustedExplorer, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { IERC1155Collection } from 'types/tokens';
import { ellipsis } from 'utils/index';

export const EvmAssetDetais = ({ id }: { id: string }) => {
  const { accounts, activeAccount, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { assets } = accounts[activeAccount.type][activeAccount.id];
  const { useCopyClipboard, alert, navigate } = useUtils();
  const { t } = useTranslation();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success(t('home.contractCopied'));
  }, [copied]);

  const currentAsset = assets.ethereum.find((asset) => asset.id === id);

  const { explorer } = activeNetwork;

  const adjustedExplorer = useAdjustedExplorer(explorer);

  const currentName = currentAsset?.is1155
    ? currentAsset.collectionName
    : currentAsset.name;

  const is1155 = !!currentAsset?.is1155;

  const hasImage = !is1155;

  const RenderCollectionItem: React.FC<{ currentNft: IERC1155Collection }> = ({
    currentNft,
  }) => (
    <>
      <Fragment key={uniqueId(id)}>
        <li className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
          <p>{t('send.balance')}</p>
          <span>
            <b>{currentNft.balance}</b>
          </span>
        </li>

        <li className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
          <p>{t('settings.tokenName')}</p>
          <span>
            <b>{currentNft.tokenSymbol}</b>
          </span>
        </li>
      </Fragment>
    </>
  );

  const renderAssetsDisclosure = (NFT: IERC1155Collection) => {
    const { tokenId } = NFT;
    return (
      <Disclosure>
        {({ open }) => (
          <>
            <div className="px-6">
              <Disclosure.Button
                className={`${
                  open ? 'rounded-t-md' : 'rounded-md'
                } mt-3 py-2 px-2 flex justify-between items-center  w-full border border-bkg-3 bg-bkg-1 cursor-pointer transition-all duration-300 text-xs`}
              >
                {`Token ID #${tokenId}`}
                <Icon
                  name="select-down"
                  className={`${
                    open ? 'transform rotate-180' : ''
                  } mb-1 text-brand-white`}
                />
              </Disclosure.Button>
            </div>

            <div className="px-6">
              <Disclosure.Panel>
                <div className="flex flex-col pb-2 px-2 w-full text-brand-white text-sm bg-bkg-3 border border-t-0 border-bkg-4 rounded-lg rounded-t-none transition-all duration-300">
                  <RenderCollectionItem currentNft={NFT} />
                </div>
              </Disclosure.Panel>
            </div>
          </>
        )}
      </Disclosure>
    );
  };

  const RenderAsset = () => (
    <>
      {currentAsset.contractAddress ? (
        <>
          <div className="w-full flex flex-col items-center justify-center gap-y-2">
            {hasImage && (
              <img
                style={{ maxWidth: '50px', maxHeight: '50px' }}
                src={currentAsset.logo}
                alt={`${currentAsset.name} Logo`}
              />
            )}
            <p className="flex flex-col items-center justify-center gap-y-0.5">
              <span className="text-xs font-light text-brand-gray200">
                {currentAsset.tokenSymbol}
              </span>
              <span className="font-normal text-base text-brand-white">
                {currentName} ({activeNetwork.label})
              </span>
            </p>
          </div>

          <div className="mt-4 mb-6">
            <li
              className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
              border-dashed border-bkg-white200 cursor-default transition-all duration-300"
            >
              <p className="font-normal text-xs">ID</p>
              <p className="flex items-center font-normal gap-x-1.5 text-xs">
                <span className="text-brand-white">
                  {ellipsis(currentAsset.id)}
                </span>

                <CopyIcon
                  size={15}
                  className="hover:text-brand-deepPink100 cursor-pointer"
                  color="text-brand-white"
                  onClick={() => copy(currentAsset.id ?? '')}
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
                  {ellipsis(currentAsset.contractAddress)}
                </span>

                <CopyIcon
                  size={15}
                  className="hover:text-brand-deepPink100 cursor-pointer"
                  color="text-brand-white"
                  onClick={() => copy(currentAsset.contractAddress ?? '')}
                />
              </p>
            </li>
          </div>

          <div className="w-full flex items-center justify-center text-brand-white hover:text-brand-deepPink100">
            <a
              href={`${adjustedExplorer}address/${id} `}
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
            <div className="w-full px-4 absolute bottom-12 md:static">
              <NeutralButton
                onClick={() => navigate('/home')}
                type="button"
                fullWidth={true}
              >
                {t('buttons.close')}
              </NeutralButton>
            </div>
          </div>
        </>
      ) : null}

      {is1155 &&
        currentAsset.collection.map((nft) => renderAssetsDisclosure(nft))}
    </>
  );

  return <RenderAsset />;
};
