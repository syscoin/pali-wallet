import getSymbolFromCurrency from 'currency-symbol-map';
import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { FiCopy as CopyIcon } from 'react-icons/fi';
import { useSelector } from 'react-redux';

import { retryableFetch } from '@pollum-io/sysweb3-network';

import { NeutralButton } from 'components/index';
import { TokenIcon } from 'components/TokenIcon';
import { useUtils } from 'hooks/index';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import {
  formatCurrency,
  truncate,
  camelCaseToText,
  syscoinKeysOfInterest,
  adjustUrl,
  getTokenLogo,
} from 'utils/index';

interface ISyscoinAssetDetailsProps {
  id: string;
  navigationState?: any;
}

export const SyscoinAssetDetails = ({
  id,
  navigationState,
}: ISyscoinAssetDetailsProps) => {
  const { navigate, useCopyClipboard, alert } = useUtils();
  const [isCopied, copy] = useCopyClipboard();
  const [isLoadingMarketData, setIsLoadingMarketData] = useState(false);
  const [marketData, setMarketData] = useState<any>(null);
  const [hasFetchedData, setHasFetchedData] = useState(false);

  // Use a ref to track if a request is in progress to prevent duplicates
  const fetchingRef = React.useRef(false);

  const { activeAccount, accountAssets, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { fiat } = useSelector((state: RootState) => state.price);
  const accountAssetData = accountAssets[activeAccount.type]?.[
    activeAccount.id
  ] || { ethereum: [], syscoin: [], nfts: [] };

  const { t } = useTranslation();

  // Get asset from store or navigation state (for import preview)
  let asset = accountAssetData.syscoin?.find(
    (sysAsset: any) => sysAsset.assetGuid === id
  );

  // If asset not found in store and this is an import preview, create a temporary asset object
  if (!asset && navigationState?.isImportPreview) {
    // Create a temporary asset object for preview
    asset = {
      assetGuid: navigationState.assetGuid || id,
      symbol: navigationState.symbol || 'Unknown',
      name: navigationState.name || navigationState.symbol || 'Unknown Token',
      balance: navigationState.balance || 0,
      decimals: navigationState.decimals || 8,
      chainId: activeNetwork.chainId,
      type: navigationState.type || 'SPTAllocated',
      image: navigationState.logo,
    };
  }

  // All hooks must be called before any early returns
  // Calculate formattedAsset and assetSymbol before using them in hooks
  const formattedAsset = [];
  if (asset) {
    for (const [key, value] of Object.entries(asset)) {
      // Check if the key is one of the keys of interest
      if (!syscoinKeysOfInterest.includes(key)) continue;

      const formattedKey = camelCaseToText(key);
      const isValid =
        typeof value !== 'object' && value !== null && value !== '';

      if (isValid) {
        // Create an object with the key and value and unshift it into the array
        const keyValueObject = {
          key: formattedKey,
          value: value,
          originalKey: key,
        };

        formattedAsset.unshift(keyValueObject);
      }
    }
  }

  const assetSymbol = formattedAsset.find((item) => item.key === 'Symbol');

  // Reset fetch state when asset changes
  useEffect(() => {
    if (asset?.assetGuid !== id) {
      setHasFetchedData(false);
      setMarketData(null);
      fetchingRef.current = false;
    }
  }, [asset?.assetGuid, id]);

  // Trigger fresh data fetch for newly imported assets
  useEffect(() => {
    const fetchCompleteAssetData = async () => {
      // Check if we have a real asset (not preview) that might be missing complete data
      if (
        asset &&
        !navigationState?.isImportPreview &&
        asset.assetGuid &&
        // Check if totalSent/totalReceived are missing (indicating incomplete data)
        (asset.totalSent === undefined || asset.totalReceived === undefined)
      ) {
        console.log(
          '[SyscoinDetails] Triggering fresh fetch for newly imported asset',
          asset.assetGuid
        );

        // Trigger a background update to fetch complete asset data
        try {
          await controllerEmitter(
            ['wallet', 'updateAssetsFromCurrentAccount'],
            [
              {
                isBitcoinBased: true,
                activeNetwork,
                activeAccount,
                isPolling: false,
              },
            ]
          );
        } catch (error) {
          console.error(
            '[SyscoinDetails] Error fetching complete asset data:',
            error
          );
        }
      }
    };

    fetchCompleteAssetData();
  }, [
    asset?.assetGuid,
    navigationState?.isImportPreview,
    activeNetwork.chainId,
    activeAccount.id,
  ]);

  // Try to fetch CoinGecko data for known Syscoin assets
  useEffect(() => {
    const fetchMarketData = async () => {
      if (!asset || !assetSymbol || hasFetchedData || fetchingRef.current)
        return;

      // Set the ref to prevent duplicate calls
      fetchingRef.current = true;
      setHasFetchedData(true);
      setIsLoadingMarketData(true);

      try {
        // Map known Syscoin assets to CoinGecko IDs
        const symbolToCoinGeckoId: Record<string, string> = {
          SYSX: 'syscoin', // SYSX token maps to syscoin on CoinGecko
          SYS: 'syscoin', // Native SYS
          BTC: 'bitcoin',
          // Add more mappings as needed
        };

        const coinGeckoId = symbolToCoinGeckoId[assetSymbol.value];

        if (coinGeckoId) {
          console.log(
            `[SyscoinAssetDetails] Fetching CoinGecko data for ${coinGeckoId}`
          );

          // Fetch token details from CoinGecko
          const response = await retryableFetch(
            `https://api.coingecko.com/api/v3/coins/${coinGeckoId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
          );

          if (response.ok) {
            const data = await response.json();
            setMarketData({
              ...data,
              isVerified: true,
            });

            console.log(
              `[SyscoinAssetDetails] Successfully fetched data for ${coinGeckoId}`
            );
          } else {
            console.warn(
              `[SyscoinAssetDetails] Failed to fetch data for ${coinGeckoId}: ${response.status}`
            );
          }
        } else {
          console.log(
            `[SyscoinAssetDetails] No CoinGecko mapping found for symbol: ${assetSymbol.value}`
          );
        }
      } catch (error) {
        console.error(
          '[SyscoinAssetDetails] Error fetching market data:',
          error
        );
        // Reset on error so it can be retried
        setHasFetchedData(false);
      } finally {
        setIsLoadingMarketData(false);
        // Reset the ref after the request completes
        fetchingRef.current = false;
      }
    };

    fetchMarketData();
  }, [asset, assetSymbol, hasFetchedData]);

  useEffect(() => {
    if (!isCopied) return;

    alert.info(t('home.contractCopied'));
  }, [isCopied, alert, t]);

  // If still no asset, return error message (after all hooks have been called)
  if (!asset) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-brand-gray200">Asset not found</p>
      </div>
    );
  }

  const hasContract =
    asset?.contract &&
    asset.contract !== '0x0000000000000000000000000000000000000000';

  const assetDecimals = formattedAsset.find((item) => item.key === 'Decimals');

  const renderMarketData = () => {
    if (!marketData || isLoadingMarketData) return null;

    // Get user's preferred currency
    const userCurrency = (fiat.asset || 'usd').toLowerCase();
    const currencySymbol = getSymbolFromCurrency(userCurrency.toUpperCase());

    return (
      <div className="mt-4 mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
        <h4 className="text-white font-medium mb-3 text-sm flex items-center justify-between">
          {t('tokens.marketInformation')}
          {/* CoinGecko Logo Link */}
          {marketData.id && (
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
        {marketData.market_data?.current_price?.[userCurrency] && (
          <div className="mb-4">
            <span className="text-gray-400 text-xs block mb-1">
              {t('tokens.currentPrice')}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-white font-medium text-lg">
                {currencySymbol || ''}
                {formatCurrency(
                  marketData.market_data.current_price[userCurrency].toString(),
                  6
                )}
              </span>
              {marketData.market_data?.price_change_percentage_24h !== null && (
                <span
                  className={`text-sm ${
                    marketData.market_data.price_change_percentage_24h >= 0
                      ? 'text-green-500'
                      : 'text-red-500'
                  }`}
                >
                  {marketData.market_data.price_change_percentage_24h >= 0
                    ? '+'
                    : ''}
                  {marketData.market_data.price_change_percentage_24h.toFixed(
                    2
                  )}
                  % (24h)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Market Cap and Rank - Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {marketData.market_cap_rank && (
            <div>
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.rank')}
              </span>
              {marketData.id ? (
                <a
                  href={`https://www.coingecko.com/en/coins/${marketData.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-royalblue font-medium hover:text-brand-deepPink100 transition-colors duration-200 flex items-center gap-1"
                >
                  #{marketData.market_cap_rank}
                  <ExternalLinkIcon size={12} />
                </a>
              ) : (
                <span className="text-brand-royalblue font-medium">
                  #{marketData.market_cap_rank}
                </span>
              )}
            </div>
          )}
          {marketData.market_data?.market_cap?.[userCurrency] && (
            <div className="text-right">
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.marketCap')}
              </span>
              <span className="text-white font-medium">
                {currencySymbol || ''}
                {formatCurrency(
                  marketData.market_data.market_cap[userCurrency].toString(),
                  0
                )}
              </span>
            </div>
          )}
        </div>

        {/* Volume and Supply - Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {marketData.market_data?.total_volume?.[userCurrency] && (
            <div>
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.volume24h')}
              </span>
              <span className="text-white font-medium">
                {currencySymbol || ''}
                {formatCurrency(
                  marketData.market_data.total_volume[userCurrency].toString(),
                  0
                )}
              </span>
            </div>
          )}
          {marketData.market_data?.circulating_supply && (
            <div className="text-right">
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.circulatingSupply')}
              </span>
              <span className="text-white font-medium">
                {formatCurrency(
                  marketData.market_data.circulating_supply.toString(),
                  0
                )}
              </span>
            </div>
          )}
        </div>

        {/* Categories */}
        {marketData.categories && marketData.categories.length > 0 && (
          <div className="mb-4">
            <span className="text-gray-400 text-xs block mb-2">
              {t('tokens.categories')}
            </span>
            <div className="flex flex-wrap gap-1">
              {marketData.categories.map((category: string, index: number) => {
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
              {marketData.categories.length > 5 && (
                <span className="px-2 py-1 bg-gray-700 bg-opacity-20 text-gray-400 text-xs rounded">
                  +{marketData.categories.length - 5} {t('tokens.more')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* CoinGecko Links Section */}
        {marketData.id && (
          <div className="mb-4 pt-3 border-t border-gray-700">
            <span className="text-gray-400 text-xs block mb-2">
              {t('tokens.viewOnCoinGecko')}
            </span>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://www.coingecko.com/en/coins/${marketData.id}`}
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
                href={`https://www.coingecko.com/en/coins/${marketData.id}/historical_data`}
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
          {marketData.isVerified ? (
            <span className="px-2 py-1 bg-green-500 bg-opacity-20 text-green-500 text-xs rounded flex items-center">
              ✓ {t('tokens.verifiedByCoinGecko')}
            </span>
          ) : (
            <span className="px-2 py-1 bg-gray-500 bg-opacity-20 text-gray-400 text-xs rounded">
              {t('tokens.notOnCoinGecko')}
            </span>
          )}
        </div>

        {/* Description */}
        {marketData.description?.en && (
          <div className="pt-3 border-t border-gray-700">
            <span className="text-gray-400 text-xs block mb-1">
              {t('tokens.about')}
            </span>
            <p className="text-white text-xs leading-relaxed line-clamp-3">
              {marketData.description.en}
            </p>
          </div>
        )}
      </div>
    );
  };

  const RenderAsset = () => (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scrollbar-styled pb-20">
        <div className="w-full flex flex-col items-center justify-center gap-y-2">
          {/* Token Icon */}
          {(marketData?.image?.large ||
            marketData?.image?.small ||
            marketData?.image?.thumb ||
            asset?.image ||
            getTokenLogo(assetSymbol?.value, false)) && (
            <div className="group relative p-2">
              <TokenIcon
                logo={
                  asset?.image ||
                  getTokenLogo(assetSymbol?.value, false) ||
                  marketData?.image?.large ||
                  marketData?.image?.small ||
                  marketData?.image?.thumb ||
                  ''
                }
                assetGuid={String(asset?.assetGuid || id)}
                symbol={assetSymbol?.value}
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
            <span className="text-xs font-light text-brand-gray200">
              {assetSymbol?.value}
            </span>
            <span className="font-normal text-base text-brand-white">
              {assetSymbol?.value} ({activeNetwork.label})
            </span>
          </div>
        </div>

        {/* Loading spinner for market data */}
        {isLoadingMarketData && (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-brand-royalblue"></div>
          </div>
        )}

        {/* Market Data Section */}
        {renderMarketData()}

        <div className="mt-4 mb-6">
          {formattedAsset
            .filter((item) => item.key !== 'Symbol' && item.key !== 'Decimals')
            .map((item, index, totalArray) => (
              <Fragment key={uniqueId(id)}>
                <li
                  className={`flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
                border-dashed border-bkg-white200 cursor-default transition-all duration-300 ${
                  index + 1 === totalArray.length && 'border-none'
                } `}
                >
                  <p className="font-normal text-xs">{item.key}</p>
                  {item.originalKey === 'contract' ? (
                    <div className="flex items-center gap-x-2">
                      <span className="text-brand-white text-xs">
                        {truncate(item.value, 10, true)}
                      </span>
                      <button
                        onClick={() => copy(item.value)}
                        className="text-brand-royalbluemedium hover:text-brand-deepPink100 transition-colors"
                        title={t('send.copyContractAddress')}
                      >
                        <CopyIcon size={14} />
                      </button>
                    </div>
                  ) : item.originalKey === 'metaData' ? (
                    <p className="text-brand-white text-xs max-w-[200px] truncate">
                      {item.value}
                    </p>
                  ) : (
                    <p className="flex items-center font-normal gap-x-1.5 text-xs">
                      <span className="text-brand-white">
                        {truncate(
                          formatCurrency(
                            String(item.value),
                            assetDecimals.value
                          ),
                          5,
                          false
                        )}
                      </span>

                      <span className="text-brand-royalbluemedium">
                        {assetSymbol.value}
                      </span>
                    </p>
                  )}
                </li>
              </Fragment>
            ))}
        </div>

        <div className="w-full flex flex-col items-center justify-center gap-y-2 mb-6">
          <div className="text-brand-white hover:text-brand-deepPink100">
            <a
              href={`${adjustUrl(activeNetwork.url)}asset/${id}`}
              target="_blank"
              className="flex items-center justify-center gap-x-2"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={16} />
              <span className="font-normal font-poppins underline text-sm">
                View on Syscoin Explorer
              </span>
            </a>
          </div>
          {hasContract && activeNetwork.url.includes('syscoin.org') && (
            <div className="text-brand-white hover:text-brand-deepPink100">
              <a
                href={`https://explorer.syscoin.org/token/${asset.contract}`}
                target="_blank"
                className="flex items-center justify-center gap-x-2"
                rel="noreferrer"
              >
                <ExternalLinkIcon size={16} />
                <span className="font-normal font-poppins underline text-sm">
                  View on NEVM Explorer
                </span>
              </a>
            </div>
          )}
          {hasContract && activeNetwork.url.includes('tanenbaum') && (
            <div className="text-brand-white hover:text-brand-deepPink100">
              <a
                href={`https://explorer.tanenbaum.io/token/${asset.contract}`}
                target="_blank"
                className="flex items-center justify-center gap-x-2"
                rel="noreferrer"
              >
                <ExternalLinkIcon size={16} />
                <span className="font-normal font-poppins underline text-sm">
                  View on Tanenbaum Explorer
                </span>
              </a>
            </div>
          )}
        </div>
      </div>

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
