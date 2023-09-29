import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DefaultModal,
  Layout,
  LoadingComponent,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { ITokenEthProps } from 'types/tokens';
import { dispatchBackgroundEvent, getController } from 'utils/browser';

const ExternalWatchAsset = () => {
  const { host, ...data } = useQueryData();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [assetInfo, setAssetInfo] = useState<ITokenEthProps>();
  const { alert } = useUtils();
  const controller = getController();
  const { t } = useTranslation();
  const wallet = controller.wallet;

  function formatAssetData(asset: any) {
    if (typeof asset === 'object') {
      return {
        type: asset.type,
        options: asset.options,
      };
    } else {
      return {
        type: asset[0].type,
        options: asset[0].options,
      };
    }
  }

  const receivedAsset = formatAssetData(data.asset);

  const onSubmit = async () => {
    setLoading(true);

    try {
      const { type: assetType, options: assetOptions } = receivedAsset;
      await wallet.handleWatchAsset(assetType, assetOptions);
      const type = data.eventName;
      dispatchBackgroundEvent(`${type}.${host}`, true);
      setConfirmed(true);
      setLoading(false);
    } catch (error: any) {
      alert.removeAll();
      alert.error(error.message);

      setLoading(false);
    }
  };

  useEffect(() => {
    const getAssetData = async () => {
      const { type: assetType, options: assetOptions } = receivedAsset;
      const currentAsset = await wallet.getAssetInfo(assetType, assetOptions);
      setAssetInfo(currentAsset);
    };

    getAssetData();
  }, []);

  return (
    <Layout canGoBack={false} title={t('settings.addNewToken')}>
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
              </div>
            </div>
          </div>

          <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
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
    </Layout>
  );
};

export default ExternalWatchAsset;
