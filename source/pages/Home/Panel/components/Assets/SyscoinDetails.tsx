import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { FiCopy as CopyIcon } from 'react-icons/fi';
import { useSelector } from 'react-redux';

import { NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  formatCurrency,
  truncate,
  camelCaseToText,
  syscoinKeysOfInterest,
  adjustUrl,
} from 'utils/index';

export const SyscoinAssetDetais = ({ id }: { id: string }) => {
  const { navigate, useCopyClipboard, alert } = useUtils();
  const { controllerEmitter } = useController();
  const [isCopied, copy] = useCopyClipboard();
  const [isLoadingMarketData, setIsLoadingMarketData] = useState(false);
  const [marketData, setMarketData] = useState<any>(null);
  const [hasFetchedData, setHasFetchedData] = useState(false);

  // Use a ref to track if a request is in progress to prevent duplicates
  const fetchingRef = React.useRef(false);

  const { activeAccount, accountAssets, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const accountAssetData = accountAssets[activeAccount.type]?.[
    activeAccount.id
  ] || { ethereum: [], syscoin: [], nfts: [] };

  const { t } = useTranslation();

  const asset = accountAssetData.syscoin?.find(
    (sysAsset: any) => sysAsset.assetGuid === id
  );

  const formattedAsset = [];
  const hasContract =
    asset?.contract &&
    asset.contract !== '0x0000000000000000000000000000000000000000';

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
  const assetDecimals = formattedAsset.find((item) => item.key === 'Decimals');

  // Reset fetch state when asset changes
  useEffect(() => {
    if (asset?.assetGuid !== id) {
      setHasFetchedData(false);
      setMarketData(null);
      fetchingRef.current = false;
    }
  }, [asset?.assetGuid, id]);

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
          const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/${coinGeckoId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
          );

          if (response.ok) {
            const data = await response.json();
            setMarketData({
              id: data.id,
              name: data.name,
              symbol: data.symbol,
              image: data.image,
              currentPrice: data.market_data?.current_price?.usd || 0,
              marketCap: data.market_data?.market_cap?.usd || 0,
              marketCapRank: data.market_cap_rank,
              totalVolume: data.market_data?.total_volume?.usd || 0,
              priceChange24h:
                data.market_data?.price_change_percentage_24h || 0,
              circulatingSupply: data.market_data?.circulating_supply || 0,
              totalSupply: data.market_data?.total_supply || 0,
              categories: data.categories || [],
              description: data.description?.en || '',
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

  const renderMarketData = () => {
    if (!marketData || isLoadingMarketData) return null;

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
        {marketData.currentPrice && (
          <div className="mb-4">
            <span className="text-gray-400 text-xs block mb-1">
              {t('tokens.currentPrice')}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-white font-medium text-lg">
                ${formatCurrency(marketData.currentPrice.toString(), 6)}
              </span>
              {marketData.priceChange24h !== undefined && (
                <span
                  className={`text-sm ${
                    marketData.priceChange24h >= 0
                      ? 'text-green-500'
                      : 'text-red-500'
                  }`}
                >
                  {marketData.priceChange24h >= 0 ? '+' : ''}
                  {marketData.priceChange24h.toFixed(2)}% (24h)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Market Cap and Rank - Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {marketData.marketCapRank && (
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
                  #{marketData.marketCapRank}
                  <ExternalLinkIcon size={12} />
                </a>
              ) : (
                <span className="text-brand-royalblue font-medium">
                  #{marketData.marketCapRank}
                </span>
              )}
            </div>
          )}
          {marketData.marketCap && (
            <div className="text-right">
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.marketCap')}
              </span>
              <span className="text-white font-medium">
                ${formatCurrency(marketData.marketCap.toString(), 0)}
              </span>
            </div>
          )}
        </div>

        {/* Volume and Supply - Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {marketData.totalVolume && (
            <div>
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.volume24h')}
              </span>
              <span className="text-white font-medium">
                ${formatCurrency(marketData.totalVolume.toString(), 0)}
              </span>
            </div>
          )}
          {marketData.circulatingSupply && (
            <div className="text-right">
              <span className="text-gray-400 text-xs block mb-1">
                {t('tokens.circulatingSupply')}
              </span>
              <span className="text-white font-medium">
                {formatCurrency(marketData.circulatingSupply.toString(), 0)}
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
        {marketData.description && (
          <div className="pt-3 border-t border-gray-700">
            <span className="text-gray-400 text-xs block mb-1">
              {t('tokens.about')}
            </span>
            <p className="text-white text-xs leading-relaxed line-clamp-3">
              {marketData.description}
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
          {marketData?.image ? (
            <div className="group relative">
              <div
                className="w-12 h-12 rounded-full overflow-hidden bg-bkg-2 border-2 border-bkg-4 
                          shadow-md group-hover:shadow-xl group-hover:scale-110 
                          transition-all duration-300"
              >
                <img
                  src={
                    marketData.image.large ||
                    marketData.image.small ||
                    marketData.image.thumb
                  }
                  alt={`${assetSymbol?.value} Logo`}
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
                    {assetSymbol?.value?.charAt(0).toUpperCase()}
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
                  {assetSymbol?.value?.charAt(0).toUpperCase()}
                </span>
              </div>
              {/* Optional shine effect on hover */}
              <div
                className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-transparent 
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
                        title="Copy contract address"
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
                            String(item.value / 10 ** assetDecimals.value),
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
                href={`https://explorer.syscoin.org/address/${asset.contract}`}
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
                href={`https://explorer.tanenbaum.io/address/${asset.contract}`}
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
