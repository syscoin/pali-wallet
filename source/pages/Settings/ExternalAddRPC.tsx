import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DefaultModal, PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { dispatchBackgroundEvent } from 'utils/browser';
const CustomRPCExternal = () => {
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { alert, navigate } = useUtils();
  const { controllerEmitter } = useController();
  const onSubmit = async (customRpc: any) => {
    setLoading(true);

    try {
      const normalizedRpc = {
        ...customRpc,
        symbol: customRpc.symbol?.toUpperCase(),
      };

      await controllerEmitter(['wallet', 'addCustomRpc'], [normalizedRpc]).then(
        async (network) => {
          setConfirmed(true);
          setLoading(false);
          const type = data.eventName;
          dispatchBackgroundEvent(`${type}.${host}`, null);
          await controllerEmitter(['wallet', 'setActiveNetwork'], [network]);
          navigate('/home');
        }
      );
    } catch (error: any) {
      alert.error(error.message);

      setLoading(false);
    }
  };

  return (
    <>
      <DefaultModal
        show={confirmed}
        onClose={window.close}
        title={t('settings.rpcSuccessfullyAdded')}
        buttonText={t('settings.gotIt')}
      />

      <div className="flex flex-col items-center justify-center w-full">
        <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
          <h2 className="text-center text-lg">
            {t('send.allow')} {host} {t('settings.toAddNetwork')}?
          </h2>
          <div className="flex flex-col mt-1 px-4 w-full text-center text-xs">
            <span>{t('settings.thisWillAllow')}</span>
            <span>
              <b>{t('settings.paliDoesNotVerify')}</b>
            </span>
          </div>
          <div className="flex flex-col items-center justify-center w-full">
            <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.networkName')}
                <span className="text-brand-royalblue text-xs font-medium">
                  {data.label}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.networkUrl')}
                <span className="text-brand-royalblue text-xs font-mono break-all">
                  {data.url}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Chain ID
                <span className="text-brand-royalblue text-xs font-mono font-medium">
                  {data.chainId}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.currencySymbol')}
                <span className="text-brand-royalblue text-xs font-medium uppercase">
                  {data.symbol?.toUpperCase()}
                </span>
              </p>
              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.explorerUrl')}
                <span className="text-brand-royalblue text-xs font-mono break-all">
                  {data.explorer || data.apiUrl || '-'}
                </span>
              </p>
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
            onClick={() => onSubmit(data)}
          >
            {t('buttons.addNetwork')}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
};

export default CustomRPCExternal;
