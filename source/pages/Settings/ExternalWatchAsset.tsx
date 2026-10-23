import getSymbolFromCurrency from 'currency-symbol-map';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button, LoadingComponent } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { TokenIcon } from 'components/TokenIcon';
import { getControllerStatus } from 'hooks/controllerStatus';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ITokenDetails } from 'types/tokens';
import { dispatchBackgroundEvent } from 'utils/browser';
import { formatCurrency } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';
import { buildExplorerUrl } from 'utils/strings';

const DETAIL_FIELD_CLASS =
  'flex flex-col pt-2 w-full text-brand-white font-poppins font-thin';
const DETAIL_VALUE_CLASS = 'text-brand-royalblue text-xs';

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
  const scope = useSelector(() => JSON.stringify(getWalletNavigationScope()));
  const [approvalScope] = useState(scope);
  const contextChanged = useRef(false);
  if (scope !== approvalScope) contextChanged.current = true;
  const mounted = useRef(true);
  const submitted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = () =>
    mounted.current &&
    !contextChanged.current &&
    JSON.stringify(getWalletNavigationScope()) === approvalScope;
  const canApprove = () => {
    const status = getControllerStatus();
    return (
      isCurrent() &&
      status.isUnlocked &&
      !status.isLoading &&
      !status.connectionUnavailable
    );
  };

  // Get user's preferred currency and active network
  const { fiat } = useSelector((state: RootState) => state.price);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const userCurrency = (fiat.asset || 'usd').toLowerCase();
  const currencySymbol = getSymbolFromCurrency(userCurrency.toUpperCase());

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
      setFormatError('settings.assetParameterRequired');
      setReceivedAsset(null);
      return;
    }

    try {
      const asset = formatAssetData(data.asset);
      setReceivedAsset(asset);
      setFormatError(null);
      setAssetError(null);
    } catch (error) {
      setFormatError('settings.invalidAssetRequestFormat');
      setReceivedAsset(null);
      setAssetError(null);
    }
  }, [data.asset]);

  const onClose = () => {
    window.close();
  };

  const onSubmit = async () => {
    if (
      !assetInfo ||
      submitted.current ||
      loading ||
      confirmed ||
      !canApprove()
    )
      return;
    submitted.current = true;
    const responseEvent = `${data.eventName}.${host}`;
    setLoading(true);

    try {
      // Pass the already-fetched assetInfo to avoid duplicate API calls
      await controllerEmitter(
        ['wallet', 'handleWatchAsset'],
        [assetInfo, JSON.parse(approvalScope)]
      );
      // The controller checks the reviewed context before its synchronous
      // mutation. Once persisted, settle that originating request even if the
      // account changed while persistence was pending; only UI feedback is stale.
      dispatchBackgroundEvent(responseEvent, true);
      if (!mounted.current) return;

      setConfirmed(true);

      setLoading(false);
      if (isCurrent()) alert.info(t('settings.tokenSuccessfullyAdded'));
      // Keep settlement and close together: releasing the request coordinator
      // while this external window stays open would block its next approval.
      window.close();
    } catch (error: any) {
      submitted.current = false;
      if (!isCurrent()) return;
      alert.error(error.message);

      setLoading(false);
    }
  };

  useEffect(() => {
    if (!receivedAsset) return;
    let current = true;
    setAssetInfo(undefined);

    const getAssetData = async () => {
      try {
        const { options: assetOptions } = receivedAsset;
        const currentAsset = (await controllerEmitter(
          ['wallet', 'getAssetInfo'],
          [assetOptions, receivedAsset.type, JSON.parse(approvalScope)]
        )) as ITokenDetails;

        if (current && isCurrent()) setAssetInfo(currentAsset);
      } catch (error) {
        if (!current || !isCurrent()) return;
        // If asset info fetching fails, show asset error instead of loading forever
        setAssetError(error.message || 'settings.assetInfoLoadFailed');
        setAssetInfo(null);
        setFormatError(null);
      }
    };

    getAssetData();
    return () => {
      current = false;
    };
  }, [receivedAsset]);

  return (
    <div className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto pb-20 remove-scrollbar">
        {!contextChanged.current && formatError ? (
          <div className="flex flex-col items-center justify-start w-full p-6 pt-8">
            <div className="flex flex-col items-center justify-center max-w-md mx-auto text-center">
              <div className="w-16 h-16 mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-2xl">⚠️</span>
              </div>

              <h2 className="text-lg font-semibold text-brand-white mb-2">
                {t('settings.invalidRequestFormat')}
              </h2>

              <p className="text-sm text-gray-400 mb-6">{t(formatError)}</p>

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
        ) : contextChanged.current || assetError ? (
          <div className="flex flex-col items-center justify-start w-full p-6 pt-8">
            <div className="flex flex-col items-center justify-center max-w-md mx-auto text-center">
              <div className="w-16 h-16 mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-2xl">❌</span>
              </div>

              <h2 className="text-lg font-semibold text-brand-white mb-2">
                {t('settings.assetNotFound')}
              </h2>

              <p className="text-sm text-gray-400 mb-6">
                {contextChanged.current
                  ? t('transactions.psbtSigningContextChanged')
                  : assetError === 'settings.assetInfoLoadFailed'
                  ? t('settings.assetInfoLoadFailed')
                  : assetError}
              </p>

              <div className="text-xs text-gray-500 mb-6 p-4 bg-gray-800/50 rounded-lg">
                <p>{t('components.pleaseVerifyThat')}</p>
                <ul className="text-left mt-2 space-y-1">
                  <li>{t('components.contractAddressCorrect')}</li>
                  <li>{t('components.assetExistsOnNetwork')}</li>
                  <li>{t('settings.validTokenContract')}</li>
                  <li>{t('settings.matchingTokenType')}</li>
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
                  <p className={DETAIL_FIELD_CLASS}>
                    {t('settings.tokenName')}
                    <span className={DETAIL_VALUE_CLASS}>{assetInfo.name}</span>
                  </p>

                  <p className={DETAIL_FIELD_CLASS}>
                    {t('settings.contractAddress')}
                    <button
                      onClick={() => {
                        const explorerUrl = buildExplorerUrl(
                          activeNetwork.explorer,
                          'address',
                          assetInfo.contractAddress
                        );
                        window.open(explorerUrl, '_blank');
                      }}
                      className="text-brand-royalblue text-xs hover:text-brand-deepPink100 cursor-pointer underline text-left transition-colors duration-200"
                    >
                      {assetInfo.contractAddress}
                    </button>
                  </p>

                  <p className={DETAIL_FIELD_CLASS}>
                    {t('settings.decimals')}
                    <span className={DETAIL_VALUE_CLASS}>
                      {assetInfo.decimals}
                    </span>
                  </p>

                  {assetInfo.tokenStandard === 'ERC-1155' && (
                    <p className={DETAIL_FIELD_CLASS}>
                      {t('send.tokenId')}
                      <span className="text-brand-royalblue text-xs break-all">
                        {assetInfo.tokenId}
                      </span>
                    </p>
                  )}

                  <p className={DETAIL_FIELD_CLASS}>
                    {t('send.balance')}
                    <span className="text-brand-royalblue text-xs break-all">
                      {assetInfo.tokenStandard === 'ERC-1155'
                        ? assetInfo.rawBalance
                        : assetInfo.tokenStandard === 'ERC-721' &&
                          assetInfo.balance === undefined
                        ? t('settings.unavailable')
                        : assetInfo.balance}
                    </span>
                  </p>

                  <p className={DETAIL_FIELD_CLASS}>
                    {t('settings.tokenSymbol')}
                    <span className={DETAIL_VALUE_CLASS}>
                      {assetInfo.symbol}
                    </span>
                  </p>

                  {/* Market Data Display */}
                  {assetInfo.market_data?.current_price?.[userCurrency] && (
                    <p className={DETAIL_FIELD_CLASS}>
                      {t('tokens.currentPrice')}
                      <span className={DETAIL_VALUE_CLASS}>
                        {currencySymbol || ''}
                        {formatCurrency(
                          assetInfo.market_data.current_price[
                            userCurrency
                          ].toString(),
                          6
                        )}
                        {Number.isFinite(
                          assetInfo.market_data?.price_change_percentage_24h
                        ) && (
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
                    <p className={DETAIL_FIELD_CLASS}>
                      {t('tokens.marketCap')}
                      <span className={DETAIL_VALUE_CLASS}>
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
      <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50 min-h-[76px]">
        <div className="max-w-md mx-auto">
          {contextChanged.current || formatError || assetError ? (
            <div className="flex justify-center">
              <Button
                variant="neutral"
                className="text-sm text-brand-royalblue"
                type="button"
                onClick={onClose}
              >
                {t('buttons.close')}
              </Button>
            </div>
          ) : assetInfo ? (
            <div className="flex gap-6 justify-center">
              <Button
                variant="secondary"
                type="button"
                disabled={loading}
                onClick={window.close}
              >
                {t('buttons.cancel')}
              </Button>

              <Button
                variant="primary"
                type="submit"
                disabled={confirmed || loading || !canApprove()}
                loading={loading}
                onClick={() => onSubmit()}
              >
                {t('buttons.addToken')}
              </Button>
            </div>
          ) : null}
        </div>
      </ToastActionFooter>
    </div>
  );
};

export default ExternalWatchAsset;
