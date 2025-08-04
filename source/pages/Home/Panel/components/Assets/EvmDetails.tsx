import getSymbolFromCurrency from 'currency-symbol-map';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { RiFileCopyLine as CopyIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { NeutralButton, Icon } from 'components/index';
import { TokenIcon } from 'components/TokenIcon';
import { useAdjustedExplorer, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  ellipsis,
  formatCurrency,
  formatFullPrecisionBalance,
} from 'utils/index';
import { navigateWithContext } from 'utils/navigationState';
import { navigateBack } from 'utils/navigationState';
import { getTokenTypeBadgeColor } from 'utils/tokens';

interface IEvmAssetDetailsProps {
  id: string;
  navigationState?: any;
}

export const EvmAssetDetails = ({
  id,
  navigationState,
}: IEvmAssetDetailsProps) => {
  const { controllerEmitter } = useController();
  const location = useLocation();
  const { activeAccount, accountAssets, activeNetwork, accounts } = useSelector(
    (state: RootState) => state.vault
  );
  const { fiat } = useSelector((state: RootState) => state.price);
  const accountAssetData = accountAssets?.[activeAccount.type]?.[
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

  // Get the full account object
  const fullAccount = accounts?.[activeAccount.type]?.[activeAccount.id];

  // Use navigation state directly for import preview, otherwise find in store
  const currentAsset = navigationState?.isImportPreview
    ? navigationState
    : accountAssetData.ethereum.find((asset) => asset.id === id);

  // All hooks must be called before any early returns
  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  // Define variables that will be used in hooks
  const is1155 = currentAsset?.tokenStandard === 'ERC-1155';

  useEffect(() => {
    if (!isCopied) return;

    alert.info(t('home.contractCopied'));
  }, [isCopied, alert, t]);

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
      // Skip if already fetched
      if (!currentAsset || hasFetchedData) {
        return;
      }

      // Check if we already have market data
      const hasMarketData =
        currentAsset.market_data?.current_price?.usd !== undefined ||
        currentAsset.market_data?.market_cap?.usd !== undefined;

      if (hasMarketData) {
        setEnhancedData(currentAsset);
        setHasFetchedData(true);
        return;
      }

      // Fetch market data if we don't have it
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
  }, [
    currentAsset?.contractAddress,
    is1155,
    controllerEmitter,
    navigationState?.isImportPreview,
    fullAccount?.address,
  ]);

  // If still no current asset, return null (after all hooks have been called)
  if (!currentAsset) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-brand-gray200">Asset not found</p>
      </div>
    );
  }

  const currentName = currentAsset?.name;

  const isNft = !!currentAsset?.isNft;
  const isErc721 = isNft && currentAsset?.tokenStandard === 'ERC-721';

  // Get the actual token standard from the saved data
  const tokenStandard =
    currentAsset?.tokenStandard ||
    (isNft ? (is1155 ? 'ERC-1155' : 'ERC-721') : 'ERC-20');

  // Use enhanced data from token or fetched data
  const tokenData = enhancedData;

  // Get user's preferred currency
  const userCurrency = (fiat.asset || 'usd').toLowerCase();
  const currencySymbol = getSymbolFromCurrency(userCurrency.toUpperCase());

  const hasEnhancedData =
    !!tokenData?.market_data?.current_price?.[userCurrency];

  const renderEnhancedMarketData = () => {
    if (!hasEnhancedData || isNft) return null;

    return (
      <div className="mt-4 mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
        <h4 className="text-white font-medium mb-3 text-sm flex items-center justify-between">
          {t('tokens.marketInformation')}
          {/* CoinGecko Logo Link */}
          {tokenData.id && (
            <a
              href="https://www.coingecko.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-brand-royalblue transition-colors duration-200"
            >
              <span className="flex items-center gap-1">
                <img
                  src="https://www.coingecko.com/favicon-96x96.png"
                  alt="CoinGecko"
                  className="w-4 h-4"
                />
                CoinGecko
              </span>
            </a>
          )}
        </h4>

        {/* Price and Change - Full Width */}
        {tokenData.market_data?.current_price?.[userCurrency] !== undefined && (
          <div className="mb-4">
            <span className="text-gray-400 text-xs block mb-1">
              {t('tokens.currentPrice')}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-white font-medium text-lg">
                {currencySymbol || ''}
                {formatCurrency(
                  tokenData.market_data.current_price[userCurrency].toString(),
                  6
                )}
              </span>
              {tokenData.market_data?.price_change_percentage_24h !== null && (
                <span
                  className={`text-sm ${
                    tokenData.market_data.price_change_percentage_24h >= 0
                      ? 'text-green-500'
                      : 'text-red-500'
                  }`}
                >
                  {tokenData.market_data.price_change_percentage_24h >= 0
                    ? '+'
                    : ''}
                  {tokenData.market_data.price_change_percentage_24h.toFixed(2)}
                  % (24h)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Market Cap and Rank - Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {tokenData.market_cap_rank !== undefined && (
            <div>
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.rank')}
              </span>
              {tokenData.id ? (
                <a
                  href={`https://www.coingecko.com/en/coins/${tokenData.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-royalblue font-medium hover:text-brand-deepPink100 transition-colors duration-200 flex items-center gap-1"
                >
                  #{tokenData.market_cap_rank}
                  <ExternalLinkIcon size={12} />
                </a>
              ) : (
                <span className="text-brand-royalblue font-medium">
                  #{tokenData.market_cap_rank}
                </span>
              )}
            </div>
          )}
          {tokenData.market_data?.market_cap?.[userCurrency] !== undefined && (
            <div className="text-right">
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.marketCap')}
              </span>
              <span className="text-white font-medium">
                {currencySymbol || ''}
                {formatCurrency(
                  tokenData.market_data.market_cap[userCurrency].toString(),
                  0
                )}
              </span>
            </div>
          )}
        </div>

        {/* Volume and Supply - Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {tokenData.market_data?.total_volume?.[userCurrency] !==
            undefined && (
            <div>
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.volume24h')}
              </span>
              <span className="text-white font-medium">
                {currencySymbol || ''}
                {formatCurrency(
                  tokenData.market_data.total_volume[userCurrency].toString(),
                  0
                )}
              </span>
            </div>
          )}
          {tokenData.market_data?.circulating_supply !== undefined && (
            <div className="text-right">
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.circulatingSupply')}
              </span>
              <span className="text-white font-medium">
                {formatCurrency(
                  tokenData.market_data.circulating_supply.toString(),
                  0
                )}
              </span>
            </div>
          )}
        </div>

        {/* Categories */}
        {tokenData.categories && tokenData.categories.length > 0 && (
          <div className="mb-4">
            <span className="text-gray-400 text-xs block mb-2">
              {t('tokens.categories')}
            </span>
            <div className="flex flex-wrap gap-1">
              {tokenData.categories.map((category, index) => {
                // Create URL-friendly category slug
                const categorySlug = category
                  .toLowerCase()
                  .replace(/\s+/g, '-');
                return (
                  <a
                    key={index}
                    href={`https://www.coingecko.com/en/categories/${categorySlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 bg-brand-royalblue bg-opacity-20 text-brand-royalblue text-xs rounded hover:bg-opacity-30 transition-all duration-200 flex items-center gap-1 group"
                  >
                    {category}
                    <ExternalLinkIcon
                      size={10}
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    />
                  </a>
                );
              })}
              {tokenData.categories.length > 5 && (
                <span className="px-2 py-1 bg-gray-700 bg-opacity-20 text-gray-400 text-xs rounded">
                  +{tokenData.categories.length - 5} {t('tokens.more')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* CoinGecko Links Section */}
        {tokenData.id && (
          <div className="mb-4 pt-3 border-t border-gray-700">
            <span className="text-gray-400 text-xs block mb-2">
              {t('tokens.viewOnCoinGecko')}
            </span>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://www.coingecko.com/en/coins/${tokenData.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-green-600 bg-opacity-20 text-green-500 text-xs rounded hover:bg-opacity-30 transition-all duration-200 flex items-center gap-1"
              >
                <img
                  src="https://www.coingecko.com/favicon-96x96.png"
                  alt="CoinGecko"
                  className="w-3 h-3"
                />
                {t('tokens.tokenPage')}
                <ExternalLinkIcon size={12} />
              </a>
              <a
                href={`https://www.coingecko.com/en/coins/${tokenData.id}/historical_data`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-blue-600 bg-opacity-20 text-blue-500 text-xs rounded hover:bg-opacity-30 transition-all duration-200 flex items-center gap-1"
              >
                {t('tokens.historicalData')}
                <ExternalLinkIcon size={12} />
              </a>
            </div>
          </div>
        )}

        {/* Verification Status */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-400 text-xs">
            {t('tokens.verification')}
          </span>
          {tokenData.isVerified ? (
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
        {tokenData.description?.en && (
          <div className="pt-3 border-t border-gray-700">
            <span className="text-gray-400 text-xs block mb-1">
              {t('tokens.about')}
            </span>
            <p className="text-white text-xs leading-relaxed line-clamp-3">
              {tokenData.description.en}
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
            className={`px-2 py-1 bg-opacity-80 text-xs rounded ${getTokenTypeBadgeColor(
              tokenStandard
            )}`}
          >
            {tokenStandard}
          </span>
        </div>

        <div className="space-y-3">
          {/* Token Standard */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-gray-400 text-xs block">Standard</span>
              <span className="text-white font-medium text-xs">
                {tokenStandard}
              </span>
            </div>
            {isErc721 && (
              <div className="text-right">
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

          {/* View Collection Button for NFTs */}
          {isNft && (
            <div className="pt-3">
              <button
                onClick={() => {
                  // Create recursive return context
                  const returnContext = {
                    returnRoute: '/home/details',
                    state: navigationState || { id },
                    // Include existing return context to make it recursive
                    returnContext: location.state?.returnContext,
                  };

                  navigateWithContext(
                    navigate,
                    '/home/details',
                    {
                      nftCollection: true,
                      nftData: currentAsset, // Just pass the full asset data
                    },
                    returnContext
                  );
                }}
                className="w-full py-2 px-4 bg-brand-royalblue bg-opacity-20 text-brand-royalblue 
                          text-sm font-medium rounded-lg hover:bg-opacity-30 transition-all duration-200
                          flex items-center justify-center gap-2"
              >
                <Icon name="eye" size={16} />
                {t('send.viewCollectionItems')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const RenderAsset = () => (
    <div className="flex flex-col h-full">
      {currentAsset.contractAddress ? (
        <div className="flex-1 overflow-y-auto remove-scrollbar pb-20">
          <div className="w-full flex flex-col items-center justify-center gap-y-2">
            {(enhancedData?.image?.large ||
              enhancedData?.image?.small ||
              enhancedData?.image?.thumb ||
              currentAsset.logo) && (
              <div className="group relative p-2">
                <TokenIcon
                  logo={
                    enhancedData?.image?.large ||
                    enhancedData?.image?.small ||
                    enhancedData?.image?.thumb ||
                    currentAsset.logo
                  }
                  contractAddress={currentAsset.contractAddress}
                  symbol={currentAsset.tokenSymbol || currentAsset.symbol}
                  isNft={isNft}
                  size={48}
                  className="shadow-md group-hover:shadow-xl group-hover:scale-110 transition-all duration-300"
                  fallbackClassName="rounded-full"
                />
                {/* Optional shine effect on hover */}
                <div
                  className="absolute inset-2 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-transparent 
                              opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                ></div>
              </div>
            )}
            <div className="flex flex-col items-center justify-center gap-y-0.5">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-light text-brand-gray200">
                  {currentAsset.tokenSymbol || currentAsset.symbol}
                </span>
                {(isNft || tokenStandard !== 'ERC-20') && (
                  <span
                    className={`px-2 py-1 bg-opacity-80 text-xs rounded border ${getTokenTypeBadgeColor(
                      tokenStandard
                    )}`}
                  >
                    {tokenStandard}
                  </span>
                )}
              </div>
              {/* Display tokenId for ERC-1155 tokens */}
              {is1155 && currentAsset.tokenId && (
                <div className="text-[10px] text-brand-gray300 flex items-center">
                  <span>
                    #
                    {currentAsset.tokenId.length > 20
                      ? ellipsis(currentAsset.tokenId, 12, 8)
                      : currentAsset.tokenId}
                  </span>
                </div>
              )}
              {/* Only show full name if it's meaningfully different from symbol */}
              {(() => {
                const symbol =
                  (
                    currentAsset.tokenSymbol || currentAsset.symbol
                  )?.toLowerCase() || '';
                const name = currentName?.toLowerCase()?.trim() || '';
                // Check if name exists and is significantly different from symbol (not just case or minor differences)
                const isSignificantlyDifferent =
                  name && // Name must exist and not be empty
                  name !== symbol && // Not the same as symbol
                  !name.includes(symbol) && // Name doesn't contain symbol
                  !symbol.includes(name) && // Symbol doesn't contain name
                  name.length > 0; // Name has actual content

                return isSignificantlyDifferent ? (
                  <span className="font-normal text-base text-brand-white">
                    {currentName} ({activeNetwork.label})
                  </span>
                ) : null;
              })()}
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

          {/* Only show balance/owned section for non-NFT tokens since NFTs show this in the NFT Information panel */}
          {!isNft && (
            <div className="mt-4 mb-6">
              <li
                className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
                border-dashed border-bkg-white200 cursor-default transition-all duration-300"
              >
                <p className="font-normal text-xs">{t('send.balance')}</p>
                <p className="flex items-center font-normal gap-x-1.5 text-xs">
                  <span className="text-brand-white">
                    {formatFullPrecisionBalance(currentAsset.balance, 4)}{' '}
                    {currentAsset.tokenSymbol || currentAsset.symbol}
                  </span>
                </p>
              </li>

              <li
                className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs  cursor-default transition-all duration-300 
                 border-none"
              >
                <p className="font-normal text-xs">
                  {t('settings.contractAddress')}
                </p>
                <div className="flex items-center font-normal gap-x-1.5 text-xs">
                  <span className="text-brand-white">
                    {ellipsis(currentAsset.contractAddress)}
                  </span>

                  <CopyIcon
                    size={15}
                    className="hover:text-brand-deepPink100 cursor-pointer"
                    color="text-brand-white"
                    onClick={() => copy(currentAsset.contractAddress ?? '')}
                  />
                </div>
              </li>
            </div>
          )}

          {/* Contract Address for NFTs (since we removed the duplicate owned section) */}
          {isNft && (
            <div className="mt-4 mb-6">
              <li
                className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs cursor-default transition-all duration-300 
                 border-none"
              >
                <p className="font-normal text-xs">
                  {t('settings.contractAddress')}
                </p>
                <div className="flex items-center font-normal gap-x-1.5 text-xs">
                  <span className="text-brand-white">
                    {ellipsis(currentAsset.contractAddress)}
                  </span>

                  <CopyIcon
                    size={15}
                    className="hover:text-brand-deepPink100 cursor-pointer"
                    color="text-brand-white"
                    onClick={() => copy(currentAsset.contractAddress ?? '')}
                  />
                </div>
              </li>
            </div>
          )}

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

      {/* Close button - Fixed at bottom */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <NeutralButton
          onClick={() => navigateBack(navigate, location)}
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
