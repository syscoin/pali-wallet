import { Disclosure } from '@headlessui/react';
import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { RiFileCopyLine as CopyIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { NeutralButton, Icon } from 'components/index';
import { useAdjustedExplorer, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { IERC1155Collection } from 'types/tokens';
import { ellipsis, formatCurrency } from 'utils/index';

export const EvmAssetDetais = ({ id }: { id: string }) => {
  const { controllerEmitter } = useController();
  const { activeAccount, accountAssets, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const accountAssetData = accountAssets[activeAccount.type]?.[
    activeAccount.id
  ] || { ethereum: [], syscoin: [], nfts: [] };
  const { useCopyClipboard, alert, navigate } = useUtils();
  const { t } = useTranslation();

  const [isCopied, copy] = useCopyClipboard();
  const [isLoadingEnhancedData, setIsLoadingEnhancedData] = useState(false);
  const [enhancedData, setEnhancedData] = useState<any>(null);
  const [hasFetchedData, setHasFetchedData] = useState(false);

  // Use a ref to track if a request is in progress to prevent duplicates
  const fetchingRef = React.useRef(false);

  // Get badge color based on token type
  const getTokenTypeBadgeColor = (type: string | undefined) => {
    switch (type) {
      case 'ERC-20':
        return 'bg-blue-600 text-blue-100';
      case 'ERC-721':
        return 'bg-purple-600 text-purple-100';
      case 'ERC-1155':
        return 'bg-pink-600 text-pink-100';
      case 'ERC-777':
        return 'bg-green-600 text-green-100';
      case 'ERC-4626':
        return 'bg-orange-600 text-orange-100';
      default:
        return 'bg-gray-600 text-gray-100';
    }
  };

  useEffect(() => {
    if (!isCopied) return;

    alert.info(t('home.contractCopied'));
  }, [isCopied, alert, t]);

  const currentAsset = accountAssetData.ethereum.find(
    (asset) => asset.id === id
  );

  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  const currentName = currentAsset?.is1155
    ? currentAsset.collectionName
    : currentAsset.name;

  const is1155 = !!currentAsset?.is1155;
  const isNft = !!currentAsset?.isNft;
  const isErc721 = isNft && !is1155;
  const hasImage = !is1155;

  // Get the actual token standard from the saved data
  const tokenStandard =
    currentAsset?.tokenStandard ||
    (isNft ? (is1155 ? 'ERC-1155' : 'ERC-721') : 'ERC-20');

  // Check if we have enhanced data stored, if not try to fetch it
  useEffect(() => {
    // Reset fetch state when asset changes
    if (currentAsset?.contractAddress !== id) {
      setHasFetchedData(false);
      setEnhancedData(null);
      fetchingRef.current = false; // Reset the ref when asset changes
    }
  }, [currentAsset?.contractAddress, id]);

  useEffect(() => {
    const loadEnhancedData = async () => {
      // Skip for NFTs or if already fetched
      if (!currentAsset || currentAsset.isNft || is1155 || hasFetchedData) {
        return;
      }

      // Try to fetch market data only (no blockchain calls)
      if (currentAsset.contractAddress && !fetchingRef.current) {
        // Set the ref to prevent duplicate calls
        fetchingRef.current = true;
        setIsLoadingEnhancedData(true);
        setHasFetchedData(true);

        try {
          const marketData = (await controllerEmitter(
            ['wallet', 'getOnlyMarketData'],
            [currentAsset.contractAddress]
          )) as any;

          // Use market data if available
          if (marketData) {
            setEnhancedData(marketData);
          }
        } catch (error) {
          console.error('Error fetching market data:', error);
          // Reset on error so it can be retried
          setHasFetchedData(false);
        } finally {
          setIsLoadingEnhancedData(false);
          // Reset the ref after the request completes
          fetchingRef.current = false;
        }
      }
    };

    loadEnhancedData();
  }, [currentAsset?.contractAddress, is1155, controllerEmitter]);

  // Use enhanced data from token or fetched data
  const tokenData = enhancedData;
  const hasEnhancedData = !!tokenData?.currentPrice;

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

  const renderEnhancedMarketData = () => {
    if (!hasEnhancedData || isNft) return null;

    return (
      <div className="mt-4 mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
        <h4 className="text-white font-medium mb-3 text-sm">
          Market Information
        </h4>

        {/* Price and Change */}
        {tokenData.currentPrice && (
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-400 text-xs">Current Price</span>
            <div className="text-right">
              <div className="text-white font-medium">
                ${formatCurrency(tokenData.currentPrice.toString(), 6)}
              </div>
              {tokenData.priceChange24h !== undefined && (
                <div
                  className={`text-xs ${
                    tokenData.priceChange24h >= 0
                      ? 'text-green-500'
                      : 'text-red-500'
                  }`}
                >
                  {tokenData.priceChange24h >= 0 ? '+' : ''}
                  {tokenData.priceChange24h.toFixed(2)}% (24h)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Market Cap and Rank */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          {tokenData.marketCapRank && (
            <div>
              <span className="text-gray-400 text-xs block">Rank</span>
              <span className="text-brand-royalblue font-medium">
                #{tokenData.marketCapRank}
              </span>
            </div>
          )}
          {tokenData.marketCap && (
            <div>
              <span className="text-gray-400 text-xs block">Market Cap</span>
              <span className="text-white font-medium text-xs">
                ${formatCurrency(tokenData.marketCap.toString(), 0)}
              </span>
            </div>
          )}
        </div>

        {/* Volume and Supply */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          {tokenData.totalVolume && (
            <div>
              <span className="text-gray-400 text-xs block">24h Volume</span>
              <span className="text-white font-medium text-xs">
                ${formatCurrency(tokenData.totalVolume.toString(), 0)}
              </span>
            </div>
          )}
          {tokenData.circulatingSupply && (
            <div>
              <span className="text-gray-400 text-xs block">
                Circulating Supply
              </span>
              <span className="text-white font-medium text-xs">
                {formatCurrency(tokenData.circulatingSupply.toString(), 0)}
              </span>
            </div>
          )}
        </div>

        {/* Categories */}
        {tokenData.categories && tokenData.categories.length > 0 && (
          <div className="mb-3">
            <span className="text-gray-400 text-xs block mb-1">Categories</span>
            <div className="flex flex-wrap gap-1">
              {tokenData.categories.slice(0, 2).map((category, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-brand-royalblue bg-opacity-20 text-brand-royalblue text-xs rounded"
                >
                  {category}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Verification Status */}
        <div className="flex items-center justify-between">
          <span className="text-gray-400 text-xs">Verification</span>
          {tokenData.coingeckoId || tokenData.isVerified ? (
            <span className="px-2 py-1 bg-green-500 bg-opacity-20 text-green-500 text-xs rounded flex items-center">
              ✓ {t('tokens.verifiedByCoinGecko')}
            </span>
          ) : (
            <span className="px-2 py-1 bg-yellow-500 bg-opacity-20 text-yellow-500 text-xs rounded">
              ⚠ {t('tokens.unverifiedToken')}
            </span>
          )}
        </div>

        {/* Description */}
        {tokenData.description && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <span className="text-gray-400 text-xs block mb-1">About</span>
            <p className="text-white text-xs leading-relaxed line-clamp-3">
              {tokenData.description}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderNftMetadata = () => {
    if (!isNft) return null;

    return (
      <div className="mt-4 mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-white font-medium text-sm">NFT Information</h4>
          <span
            className={`px-2 py-1 bg-opacity-20 text-xs rounded ${getTokenTypeBadgeColor(
              tokenStandard
            )}`}
          >
            {tokenStandard}
          </span>
        </div>

        <div className="space-y-3">
          {/* Collection Name */}
          {(currentAsset.collectionName || currentAsset.name) && (
            <div>
              <span className="text-gray-400 text-xs block">Collection</span>
              <span className="text-white font-medium text-sm">
                {currentAsset.collectionName || currentAsset.name}
              </span>
            </div>
          )}

          {/* Token Standard */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-gray-400 text-xs block">Standard</span>
              <span className="text-white font-medium text-xs">
                {tokenStandard}
              </span>
            </div>
            {isErc721 && (
              <div>
                <span className="text-gray-400 text-xs block">Owned</span>
                <span className="text-white font-medium text-xs">
                  {currentAsset.balance}{' '}
                  {currentAsset.balance === 1 ? 'NFT' : 'NFTs'}
                </span>
              </div>
            )}
          </div>

          {/* Contract Verification */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-700">
            <span className="text-gray-400 text-xs">Contract Status</span>
            <span className="px-2 py-1 bg-gray-500 bg-opacity-20 text-gray-400 text-xs rounded">
              {t('tokens.standardContract')}
            </span>
          </div>

          {/* ERC-1155 Collection Note */}
          {is1155 &&
            currentAsset.collection &&
            currentAsset.collection.length > 0 && (
              <div className="pt-2 border-t border-gray-700">
                <p className="text-gray-400 text-xs">
                  💡 {t('tokens.individualTokensShownBelow')}
                </p>
              </div>
            )}
        </div>
      </div>
    );
  };

  const RenderAsset = () => (
    <div className="flex flex-col h-full">
      {currentAsset.contractAddress ? (
        <div className="flex-1 overflow-y-auto scrollbar-styled pb-4">
          <div className="w-full flex flex-col items-center justify-center gap-y-2">
            {hasImage &&
              (currentAsset.logo ? (
                <div className="group relative">
                  <div
                    className="w-12 h-12 rounded-full overflow-hidden bg-bkg-2 border-2 border-bkg-4 
                                  shadow-md group-hover:shadow-xl group-hover:scale-110 
                                  transition-all duration-300"
                  >
                    <img
                      src={currentAsset.logo}
                      alt={`${currentAsset.name} Logo`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove(
                          'hidden'
                        );
                      }}
                    />
                    <div
                      className="hidden w-full h-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                                    flex items-center justify-center"
                    >
                      <span className="text-white text-lg font-bold font-rubik">
                        {currentAsset.tokenSymbol.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>
                  {/* Optional shine effect on hover */}
                  <div
                    className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  ></div>
                </div>
              ) : (
                <div className="group relative">
                  <div
                    className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                                  flex items-center justify-center shadow-md group-hover:shadow-xl 
                                  group-hover:scale-110 transition-all duration-300"
                  >
                    <span className="text-white text-lg font-bold font-rubik">
                      {currentAsset.tokenSymbol.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  {/* Optional shine effect on hover */}
                  <div
                    className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-transparent 
                                  opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  ></div>
                </div>
              ))}
            <div className="flex flex-col items-center justify-center gap-y-0.5">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-light text-brand-gray200">
                  {currentAsset.tokenSymbol}
                </span>
                {(isNft || tokenStandard !== 'ERC-20') && (
                  <span
                    className={`px-2 py-1 bg-opacity-20 text-xs rounded ${getTokenTypeBadgeColor(
                      tokenStandard
                    )}`}
                  >
                    {tokenStandard}
                  </span>
                )}
              </div>
              <span className="font-normal text-base text-brand-white">
                {currentName} ({activeNetwork.label})
              </span>
            </div>
          </div>

          {/* Enhanced Market Data Section */}
          {isLoadingEnhancedData && (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-brand-royalblue"></div>
            </div>
          )}

          {renderEnhancedMarketData()}
          {renderNftMetadata()}

          <div className="mt-4 mb-6">
            <li
              className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
              border-dashed border-bkg-white200 cursor-default transition-all duration-300"
            >
              <p className="font-normal text-xs">
                {isNft ? 'Owned' : 'Balance'}
              </p>
              <p className="flex items-center font-normal gap-x-1.5 text-xs">
                <span className="text-brand-white">
                  {isNft
                    ? `${currentAsset.balance} ${
                        currentAsset.balance === 1 ? 'NFT' : 'NFTs'
                      }`
                    : `${currentAsset.balance} ${currentAsset.tokenSymbol}`}
                </span>
              </p>
            </li>

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

          <div className="w-full flex items-center justify-center text-brand-white hover:text-brand-deepPink100 mb-6">
            <a
              href={`${adjustedExplorer}token/${id} `}
              target="_blank"
              className="flex items-center justify-center gap-x-2"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={16} />
              <span className="font-normal font-poppins underline text-sm">
                {isNft
                  ? t('home.viewCollectionOnExplorer')
                  : t('home.viewOnExplorer')}
              </span>
            </a>
          </div>
        </div>
      ) : null}

      {is1155 &&
        currentAsset.collection.map((nft) => renderAssetsDisclosure(nft))}

      {/* Close button - Fixed at bottom */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <NeutralButton
          onClick={() => navigate('/home')}
          type="button"
          fullWidth={true}
        >
          {t('buttons.close')}
        </NeutralButton>
      </div>
    </div>
  );

  return <RenderAsset />;
};
