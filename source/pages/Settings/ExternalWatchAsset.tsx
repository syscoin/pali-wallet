import getSymbolFromCurrency from 'currency-symbol-map';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  LoadingComponent,
  PrimaryButton,
  SecondaryButton,
  NeutralButton,
} from 'components/index';
import { TokenIcon } from 'components/TokenIcon';
import { useQueryData, useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ITokenDetails } from 'types/tokens';
import { dispatchBackgroundEvent } from 'utils/browser';
import { formatCurrency } from 'utils/index';

const ExternalWatchAsset = () => {
  const { host, ...data } = useQueryData();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [assetInfo, setAssetInfo] = useState<ITokenDetails>();
  const [formatError, setFormatError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const { alert } = useUtils();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();

  // Get user's preferred currency and active network
  const { fiat } = useSelector((state: RootState) => state.price);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const userCurrency = (fiat.asset || 'usd').toLowerCase();
  const currencySymbol = getSymbolFromCurrency(userCurrency.toUpperCase());

  // Get adjusted explorer URL
  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  function formatAssetData(asset: any) {
    // Handle null/undefined asset
    if (!asset) {
      throw new Error('Asset parameter is required');
    }

    // Handle proper EIP-747 format: { type: "ERC20", options: { address: "0x..." } }
    if (typeof asset === 'object' && asset.options) {
      return {
        type: asset.type,
        options: asset.options,
      };
    }

    // Handle legacy array format: [{ type: "ERC20", options: { address: "0x..." } }]
    if (Array.isArray(asset) && asset.length > 0 && asset[0].options) {
      return {
        type: asset[0].type,
        options: asset[0].options,
      };
    }

    // Invalid format
    throw new Error(
      'Invalid asset format. Expected EIP-747 format: { type: "ERC20", options: { address: "0x..." } }'
    );
  }

  // Handle asset data formatting with error handling
  const [receivedAsset, setReceivedAsset] = useState(null);

  useEffect(() => {
    // Only validate if we have data.asset
    if (!data.asset) {
      setFormatError('Asset parameter is required');
      setReceivedAsset(null);
      return;
    }

    try {
      const asset = formatAssetData(data.asset);
      setReceivedAsset(asset);
      setFormatError(null);
      setAssetError(null);
    } catch (error) {
      setFormatError(error.message);
      setReceivedAsset(null);
      setAssetError(null);
    }
  }, [data.asset]);

  const onClose = () => {
    window.close();
  };

  const onSubmit = async () => {
    setLoading(true);

    try {
      // Pass the already-fetched assetInfo to avoid duplicate API calls
      await controllerEmitter(['wallet', 'handleWatchAsset'], [assetInfo]);

      const type = data.eventName;

      dispatchBackgroundEvent(`${type}.${host}`, true);

      setConfirmed(true);

      setLoading(false);
      alert.info(t('settings.tokenSuccessfullyAdded'));
      setTimeout(window.close, 2000);
    } catch (error: any) {
      alert.error(error.message);

      setLoading(false);
    }
  };

  useEffect(() => {
    if (!receivedAsset) return;

    const getAssetData = async () => {
      try {
        const { options: assetOptions } = receivedAsset;
        const currentAsset = (await controllerEmitter(
          ['wallet', 'getAssetInfo'],
          [assetOptions]
        )) as ITokenDetails;

        setAssetInfo(currentAsset);
      } catch (error) {
        // If asset info fetching fails, show asset error instead of loading forever
        setAssetError(error.message || 'Failed to fetch asset information');
        setAssetInfo(null);
        setFormatError(null);
      }
    };

    getAssetData();
  }, [receivedAsset]);

  return (
    <div className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto pb-20 remove-scrollbar">
        {formatError ? (
          <div className="flex flex-col items-center justify-start w-full p-6 pt-8">
            <div className="flex flex-col items-center justify-center max-w-md mx-auto text-center">
              <div className="w-16 h-16 mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-2xl">⚠️</span>
              </div>

              <h2 className="text-lg font-semibold text-brand-white mb-2">
                Invalid Request Format
              </h2>

              <p className="text-sm text-gray-400 mb-6">{formatError}</p>

              <div className="text-xs text-gray-500 mb-6 p-4 bg-gray-800/50 rounded-lg">
                <p className="mb-2">{t('components.expectedFormat')}</p>
                <code className="text-green-400">
                  {`// ERC-20 Token
{
  type: "ERC20",
  options: {
    address: "0x...",
    symbol: "TOKEN",
    decimals: 18
  }
}

// NFT Collection
{
  type: "ERC721",
  options: {
    address: "0x...",
    symbol: "NFT"
  }
}`}
                </code>
              </div>
            </div>
          </div>
        ) : assetError ? (
          <div className="flex flex-col items-center justify-start w-full p-6 pt-8">
            <div className="flex flex-col items-center justify-center max-w-md mx-auto text-center">
              <div className="w-16 h-16 mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-2xl">❌</span>
              </div>

              <h2 className="text-lg font-semibold text-brand-white mb-2">
                Asset Not Found
              </h2>

              <p className="text-sm text-gray-400 mb-6">{assetError}</p>

              <div className="text-xs text-gray-500 mb-6 p-4 bg-gray-800/50 rounded-lg">
                <p>{t('components.pleaseVerifyThat')}</p>
                <ul className="text-left mt-2 space-y-1">
                  <li>{t('components.contractAddressCorrect')}</li>
                  <li>{t('components.assetExistsOnNetwork')}</li>
                  <li>
                    • The contract is a valid ERC-20, ERC-721, or ERC-1155 token
                  </li>
                  <li>
                    • The asset type matches the contract (ERC20/ERC721/ERC1155)
                  </li>
                </ul>
              </div>
            </div>
          </div>
        ) : assetInfo ? (
          <div className="flex flex-col items-center justify-center w-full">
            <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
              <h2 className="text-center text-base">
                {t('send.allow')} {host} {t('settings.toAddAToken')}?
              </h2>
              <div className="flex flex-col mt-1 px-4 w-full text-center text-xs">
                <span>{t('settings.thisWillAllowToken')}</span>
                <span>
                  <b>{t('settings.paliDoesNotVerifyToken')}</b>
                </span>
              </div>
              <div className="flex flex-col items-center justify-center w-full">
                {/* Token Logo Display */}
                <div className="flex items-center justify-center mt-4 mb-2">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-bkg-2 border border-bkg-4 shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-110 hover:shadow-xl cursor-pointer">
                    <TokenIcon
                      logo={
                        assetInfo.image?.large ||
                        assetInfo.image?.small ||
                        assetInfo.image?.thumb
                      }
                      symbol={assetInfo.symbol}
                      contractAddress={receivedAsset?.options?.address}
                      isNft={
                        receivedAsset?.type === 'ERC721' ||
                        receivedAsset?.type === 'ERC1155'
                      }
                      size={64}
                      className={
                        receivedAsset?.type === 'ERC721' ||
                        receivedAsset?.type === 'ERC1155'
                          ? 'rounded-lg'
                          : 'rounded-full'
                      }
                    />
                  </div>
                  <div className="flex flex-col items-center gap-2 ml-2">
                    {assetInfo.isVerified && (
                      <div className="px-2 py-1 bg-green-500/20 border border-green-500 rounded-full">
                        <span className="text-green-400 text-xs font-medium">
                          ✓ {t('tokens.verifiedByCoinGecko')}
                        </span>
                      </div>
                    )}
                    {(receivedAsset?.type === 'ERC721' ||
                      receivedAsset?.type === 'ERC1155') && (
                      <div className="px-2 py-1 bg-purple-500/20 border border-purple-500 rounded-full">
                        <span className="text-purple-400 text-xs font-medium">
                          {receivedAsset?.type === 'ERC721'
                            ? 'NFT'
                            : 'Multi-Token'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
                  <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                    {t('settings.tokenName')}
                    <span className="text-brand-royalblue text-xs">
                      {assetInfo.name}
                    </span>
                  </p>

                  <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                    {t('settings.contractAddress')}
                    <button
                      onClick={() => {
                        const explorerUrl = `${adjustedExplorer}address/${assetInfo.contractAddress}`;
                        window.open(explorerUrl, '_blank');
                      }}
                      className="text-brand-royalblue text-xs hover:text-brand-deepPink100 cursor-pointer underline text-left transition-colors duration-200"
                    >
                      {assetInfo.contractAddress}
                    </button>
                  </p>

                  <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                    {t('settings.decimals')}
                    <span className="text-brand-royalblue text-xs">
                      {assetInfo.decimals}
                    </span>
                  </p>

                  <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                    {t('send.balance')}
                    <span className="text-brand-royalblue text-xs">
                      {assetInfo.balance}
                    </span>
                  </p>

                  <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                    {t('settings.tokenSymbol')}
                    <span className="text-brand-royalblue text-xs">
                      {assetInfo.symbol}
                    </span>
                  </p>

                  {/* Market Data Display */}
                  {assetInfo.market_data?.current_price?.[userCurrency] && (
                    <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                      Current Price
                      <span className="text-brand-royalblue text-xs">
                        {currencySymbol || ''}
                        {formatCurrency(
                          assetInfo.market_data.current_price[
                            userCurrency
                          ].toString(),
                          6
                        )}
                        {assetInfo.market_data?.price_change_percentage_24h !==
                          null && (
                          <span
                            className={`ml-2 ${
                              assetInfo.market_data
                                .price_change_percentage_24h >= 0
                                ? 'text-green-400'
                                : 'text-red-400'
                            }`}
                          >
                            {assetInfo.market_data
                              .price_change_percentage_24h >= 0
                              ? '+'
                              : ''}
                            {assetInfo.market_data.price_change_percentage_24h.toFixed(
                              2
                            )}
                            %
                          </span>
                        )}
                      </span>
                    </p>
                  )}

                  {assetInfo.market_data?.market_cap?.[userCurrency] && (
                    <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                      Market Cap
                      <span className="text-brand-royalblue text-xs">
                        {currencySymbol || ''}
                        {formatCurrency(
                          (
                            assetInfo.market_data.market_cap[userCurrency] /
                            1000000
                          ).toString(),
                          2
                        )}
                        M
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <LoadingComponent />
        )}
      </div>

      {/* Fixed button container at bottom of viewport */}
      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50 min-h-[76px]">
        <div className="max-w-md mx-auto">
          {formatError || assetError ? (
            <div className="flex justify-center">
              <NeutralButton type="button" onClick={onClose}>
                {t('buttons.close')}
              </NeutralButton>
            </div>
          ) : assetInfo ? (
            <div className="flex gap-6 justify-center">
              <SecondaryButton
                type="button"
                disabled={loading}
                onClick={window.close}
              >
                {t('buttons.cancel')}
              </SecondaryButton>

              <PrimaryButton
                type="submit"
                disabled={confirmed}
                loading={loading}
                onClick={() => onSubmit()}
              >
                {t('buttons.addToken')}
              </PrimaryButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ExternalWatchAsset;
