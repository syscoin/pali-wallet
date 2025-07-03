import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DefaultModal,
  LoadingComponent,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { IAssetPreview } from 'types/tokens';
import { dispatchBackgroundEvent } from 'utils/browser';

const ExternalWatchAsset = () => {
  const { host, ...data } = useQueryData();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [assetInfo, setAssetInfo] = useState<IAssetPreview>();
  const { alert } = useUtils();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();

  function formatAssetData(asset: any) {
    if (typeof asset === 'object') {
      return {
        options: asset.options,
      };
    } else {
      return {
        options: asset[0].options,
      };
    }
  }

  const receivedAsset = formatAssetData(data.asset);

  const onSubmit = async () => {
    setLoading(true);

    try {
      // Pass the already-fetched assetInfo to avoid duplicate API calls
      await controllerEmitter(['wallet', 'handleWatchAsset'], [assetInfo]);

      const type = data.eventName;

      dispatchBackgroundEvent(`${type}.${host}`, true);

      setConfirmed(true);

      setLoading(false);
    } catch (error: any) {
      alert.error(error.message);

      setLoading(false);
    }
  };

  useEffect(() => {
    const getAssetData = async () => {
      const { options: assetOptions } = receivedAsset;
      const currentAsset = (await controllerEmitter(
        ['wallet', 'getAssetInfo'],
        [assetOptions]
      )) as IAssetPreview;

      setAssetInfo(currentAsset);
    };

    getAssetData();
  }, []);

  return (
    <>
      <DefaultModal
        show={confirmed}
        onClose={window.close}
        title={t('settings.tokenSuccessfullyAdded')}
        buttonText={t('settings.gotIt')}
      />

      {assetInfo ? (
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
              {assetInfo.logo && (
                <div className="flex items-center justify-center mt-4 mb-2">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-bkg-2 border border-bkg-4 shadow-lg">
                    <img
                      src={assetInfo.logo}
                      alt={assetInfo.tokenSymbol}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                  {assetInfo.isVerified && (
                    <div className="ml-2 px-2 py-1 bg-green-500/20 border border-green-500 rounded-full">
                      <span className="text-green-400 text-xs font-medium">
                        ✓ {t('tokens.verifiedByCoinGecko')}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
                <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                  {t('settings.tokenName')}
                  <span className="text-brand-royalblue text-xs">
                    {assetInfo.name}
                  </span>
                </p>

                <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                  {t('settings.contractAddress')}
                  <span className="text-brand-royalblue text-xs">
                    {assetInfo.contractAddress}
                  </span>
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
                    {assetInfo.tokenSymbol}
                  </span>
                </p>

                {/* Market Data Display */}
                {assetInfo.currentPrice && (
                  <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                    Current Price
                    <span className="text-brand-royalblue text-xs">
                      ${assetInfo.currentPrice.toFixed(6)}
                      {assetInfo.priceChange24h && (
                        <span
                          className={`ml-2 ${
                            assetInfo.priceChange24h >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}
                        >
                          {assetInfo.priceChange24h >= 0 ? '+' : ''}
                          {assetInfo.priceChange24h.toFixed(2)}%
                        </span>
                      )}
                    </span>
                  </p>
                )}

                {assetInfo.marketCap && (
                  <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                    Market Cap
                    <span className="text-brand-royalblue text-xs">
                      ${(assetInfo.marketCap / 1000000).toFixed(2)}M
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="w-full px-4 absolute bottom-12 md:static flex items-center justify-between">
            <SecondaryButton type="button" onClick={window.close}>
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
        </div>
      ) : (
        <LoadingComponent />
      )}
    </>
  );
};

export default ExternalWatchAsset;
