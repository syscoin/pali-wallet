import { uniqueId } from 'lodash';
import React, { Fragment, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiDownload as ImportIcon } from 'react-icons/fi';
import { RiShareForward2Line as DetailsIcon } from 'react-icons/ri';

import { IconButton } from 'components/index';
import { TokenIcon } from 'components/TokenIcon';
import { Tooltip } from 'components/Tooltip';
import { truncate, formatCurrency } from 'utils/index';
import { getTokenTypeBadgeColor } from 'utils/tokens';

interface IImportableAsset {
  // EVM
  assetGuid?: string;
  balance: number;
  // UTXO
  chainId?: number;
  contractAddress?: string;
  decimals?: number;
  id: string;
  isNft?: boolean;
  logo?: string;
  name?: string;
  symbol: string;
  tokenStandard?: string;
  type?: string; // For UTXO
}

interface IImportableAssetsListProps {
  assetType: 'evm' | 'utxo';
  assets: IImportableAsset[];
  currentlyImporting: string | null;
  fetchingLogos?: Set<string>;
  importedAssetIds: Set<string>;
  isLoading: boolean;
  onDetailsClick: (asset: IImportableAsset) => void;
  onImport: (asset: IImportableAsset) => Promise<void>;
}

export const ImportableAssetsList: React.FC<IImportableAssetsListProps> = ({
  assets,
  isLoading,
  onImport,
  onDetailsClick,
  importedAssetIds,
  currentlyImporting,
  fetchingLogos = new Set(),
  assetType,
}) => {
  const { t } = useTranslation();
  const [localImportedIds, setLocalImportedIds] = useState<Set<string>>(
    new Set(importedAssetIds)
  );

  // Update local imported IDs when prop changes
  useEffect(() => {
    setLocalImportedIds(new Set(importedAssetIds));
  }, [importedAssetIds]);

  const handleImport = useCallback(
    async (asset: IImportableAsset) => {
      try {
        await onImport(asset);
        // Immediately add to local imported set for instant UI feedback
        setLocalImportedIds((prev) => new Set(prev).add(asset.id));
      } catch (error) {
        // Error handling is done in parent component
      }
    },
    [onImport]
  );

  const isAssetImported = (assetId: string) =>
    localImportedIds.has(assetId) || importedAssetIds.has(assetId);

  const getAssetLogo = (asset: IImportableAsset) => {
    const isFetchingLogo = fetchingLogos.has(asset.id);

    return (
      <TokenIcon
        logo={asset.logo}
        contractAddress={asset.contractAddress}
        assetGuid={asset.assetGuid}
        symbol={asset.symbol}
        size={24}
        className={`hover:shadow-md hover:scale-110 transition-all duration-200 ${
          isFetchingLogo ? 'opacity-50' : ''
        }`}
      />
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="relative inline-block mb-4">
          <div className="absolute inset-0 bg-brand-royalblue/20 blur-3xl rounded-full"></div>
          <div
            className="relative w-16 h-16 mx-auto bg-bkg-2 
                        rounded-full flex items-center justify-center"
          >
            <ImportIcon
              size={32}
              className="text-brand-royalblue hover:text-brand-royalbluemedium transition-colors duration-200"
            />
          </div>
        </div>
        <h3 className="text-brand-white font-rubik font-medium text-lg mb-1">
          {t('tokens.noTokensFound')}
        </h3>
        <p className="text-brand-gray200 text-sm font-poppins max-w-xs mx-auto">
          {t('tokens.youDontHaveTokensYet')}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {assets.map((asset: IImportableAsset) => {
        const isImported = isAssetImported(asset.id);
        const isImporting = currentlyImporting === asset.id;
        const identifier =
          assetType === 'evm' ? asset.contractAddress : asset.assetGuid;

        return (
          <Fragment key={uniqueId(asset.id)}>
            <li className="flex items-center justify-between py-3 px-4 text-xs border border-bkg-4 rounded-lg bg-bkg-2 hover:bg-bkg-3 transition-all duration-200">
              <div className="flex gap-3 items-center justify-start flex-1 min-w-0">
                {getAssetLogo(asset)}

                <div className="flex flex-col flex-1 min-w-0">
                  <p className="flex items-center gap-x-2">
                    <span className="text-brand-white font-medium">
                      {asset.tokenStandard === 'ERC-1155' && asset.balance === 0
                        ? '—'
                        : formatCurrency(
                            String(asset.balance || 0),
                            Math.min(asset.decimals || 8, 4) // Limit displayed decimals
                          )}
                    </span>
                    <span
                      className="text-brand-royalbluemedium hover:text-brand-deepPink100 cursor-pointer underline transition-colors duration-200"
                      onClick={() => onDetailsClick(asset)}
                    >
                      {truncate(asset.symbol, 10).toUpperCase()}
                    </span>
                  </p>
                  {identifier && (
                    <p className="text-brand-gray200 text-xs mt-0.5">
                      {assetType === 'evm'
                        ? truncate(identifier, 8, true)
                        : `${t('tokens.assetGuid')}: ${identifier}`}
                    </p>
                  )}
                </div>

                {/* Token type badge */}
                {asset.tokenStandard && (
                  <div
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 mr-4
                                ${getTokenTypeBadgeColor(asset.tokenStandard)}`}
                  >
                    {asset.tokenStandard}
                  </div>
                )}
                {asset.type && assetType === 'utxo' && (
                  <div
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 mr-4 ${getTokenTypeBadgeColor(
                      asset.type
                    )}`}
                  >
                    SPT
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between flex-shrink-0">
                <Tooltip content={t('tooltip.assetDetails')}>
                  <IconButton
                    onClick={() => onDetailsClick(asset)}
                    className="p-2 hover:bg-brand-royalbluemedium/20 rounded-full transition-colors duration-200"
                    aria-label={`View details for ${asset.symbol} token`}
                  >
                    <DetailsIcon
                      size={16}
                      className="text-brand-white hover:text-brand-royalbluemedium transition-colors"
                    />
                  </IconButton>
                </Tooltip>

                <Tooltip
                  content={
                    isImported
                      ? t('tokens.tokenAlreadyImported')
                      : t('home.importToken')
                  }
                >
                  <div
                    className={`relative ${
                      isImported || isImporting
                        ? 'cursor-not-allowed'
                        : 'cursor-pointer'
                    }`}
                  >
                    <IconButton
                      onClick={() => {
                        if (!isImported && !isImporting) {
                          handleImport(asset);
                        }
                      }}
                      className={`p-2 rounded-full transition-colors duration-200 ${
                        isImported
                          ? 'cursor-not-allowed'
                          : isImporting
                          ? 'cursor-not-allowed'
                          : 'hover:bg-brand-royalblue/20'
                      }`}
                      aria-label={`Import ${asset.symbol} token`}
                      disabled={isImported || isImporting}
                    >
                      <ImportIcon
                        className={`transition-all duration-200 ${
                          isImported
                            ? 'text-gray-500'
                            : isImporting
                            ? 'text-brand-royalblue animate-pulse'
                            : 'text-brand-white hover:text-brand-royalblue'
                        }`}
                        size={16}
                      />
                    </IconButton>
                    {isImporting && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-brand-royalblue"></div>
                      </div>
                    )}
                  </div>
                </Tooltip>
              </div>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
};
