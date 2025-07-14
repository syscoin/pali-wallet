import { ethErrors } from 'helpers/errors';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  PrimaryButton,
  SecondaryButton,
  LoadingComponent,
  DefaultModal,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { dispatchBackgroundEvent } from 'utils/browser';
import cleanErrorStack from 'utils/cleanErrorStack';
import { getNetworkChain } from 'utils/network';

const SwitchNeworkUtxoEvm: React.FC = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { newNetwork, newChainValue } = data;
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { t } = useTranslation();
  const { navigate } = useUtils();

  // Safety check: if required data is missing, show error or redirect
  if (!newNetwork || !newChainValue) {
    console.error('[SwitchNetworkUtxoEvm] Missing required data:', {
      newNetwork,
      newChainValue,
      data,
    });
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <p className="text-brand-white text-center">
          {t('settings.networkSwitchError')}
        </p>
        <div className="mt-4">
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            {t('buttons.goHome')}
          </SecondaryButton>
        </div>
      </div>
    );
  }

  const isNewChainBtcBased = newChainValue === 'syscoin';

  const previousChain = getNetworkChain(!isNewChainBtcBased); // if the new chain isBtcBased, the previous chain is EVM

  const onSubmit = async () => {
    setLoading(true);
    try {
      await controllerEmitter(['wallet', 'setActiveNetwork'], [newNetwork]);
      navigate('/home');
    } catch (networkError) {
      throw cleanErrorStack(ethErrors.rpc.internal());
    }
    setConfirmed(true);
    setLoading(false);
    const type = data.eventName;
    dispatchBackgroundEvent(`${type}.${host}`, { success: true });
    window.close();
  };

  return (
    <>
      <DefaultModal
        show={confirmed}
        onClose={window.close}
        title={t('settings.networkChanged')}
        buttonText={t('settings.gotIt')}
      />

      {!loading ? (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="relative top-5 flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
            <h2 className="text-center text-lg">
              {t('send.allow')} {host} {t('settings.toSwitchNetwork')}?
            </h2>
            <div className="flex flex-col mt-1 px-4 w-full text-center text-xs">
              <span>{t('settings.thisWillSwitch')}</span>
            </div>
            <div className="flex flex-col items-center justify-center w-full">
              <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
                <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                  {t('settings.previousChainType')}
                  <span className="text-brand-royalblue text-xs">
                    {previousChain}
                  </span>
                </p>

                <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                  {t('settings.newChainType')}
                  <span className="text-brand-royalblue text-xs">
                    {newChainValue}
                  </span>
                </p>

                <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                  {t('settings.newNetworkUrl')}
                  <span className="text-brand-royalblue text-xs">
                    {newNetwork?.url || 'N/A'}
                  </span>
                </p>

                <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                  {t('settings.newNetworkChainId')}
                  <span className="text-brand-royalblue text-xs">
                    {newNetwork?.chainId || 'N/A'}
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
              onClick={onSubmit}
            >
              {t('buttons.switchNetwork')}
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <div className="relative top-40 flex items-center justify-center w-full">
          <LoadingComponent />
        </div>
      )}
    </>
  );
};

export default SwitchNeworkUtxoEvm;
