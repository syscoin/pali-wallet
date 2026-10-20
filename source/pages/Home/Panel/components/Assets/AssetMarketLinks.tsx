import React from 'react';

import { FiExternalLink as ExternalLinkIcon } from 'components/Icon/Icon';

export const AssetMarketLinks = ({
  marketData,
  t,
}: {
  marketData: { categories?: unknown; id?: string };
  t: (key: string) => string;
}) => {
  const categories = Array.isArray(marketData.categories)
    ? marketData.categories.filter(
        (category): category is string => typeof category === 'string'
      )
    : [];
  return (
    <>
      {/* Categories */}
      {categories.length > 0 && (
        <div className="mb-4">
          <span className="text-gray-400 text-xs block mb-2">
            {t('tokens.categories')}
          </span>
          <div className="flex flex-wrap gap-1">
            {categories.map((category, index) => {
              const categorySlug = category.toLowerCase().replace(/\s+/g, '-');
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
            {categories.length > 5 && (
              <span className="px-2 py-1 bg-gray-700 bg-opacity-20 text-gray-400 text-xs rounded">
                +{categories.length - 5} {t('tokens.more')}
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
    </>
  );
};
