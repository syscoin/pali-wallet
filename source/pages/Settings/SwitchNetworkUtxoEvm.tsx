import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import { PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { waitForNetworkSwitch } from 'utils/stateWaitUtils';

const SwitchNeworkUtxoEvm: React.FC = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { newNetwork, newChainValue } = data;
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { t } = useTranslation();
  const { activeNetwork } = useSelector((state: RootState) => state.vault);
  const prevNetworkRef = useRef(activeNetwork);
  const prevChainIdRef = useRef(activeNetwork?.chainId);
  const prevKindRef = useRef(activeNetwork?.kind);

  const getTypeBadge = (kind?: INetworkType) => {
    const isUtxo = kind === INetworkType.Syscoin;
    const text = isUtxo ? 'UTXO' : 'EVM';
    const colorClass = isUtxo ? 'bg-brand-pink' : 'bg-brand-blue';
    return (
      <span
        className={`px-1.5 py-0.5 text-[10px] font-medium text-white rounded-full ${colorClass}`}
      >
        {text}
      </span>
    );
  };

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
          {t('header.thereWasAnError')}
        </p>
        <div className="mt-4">
          <SecondaryButton type="button" onClick={() => window.close()}>
            {t('buttons.close')}
          </SecondaryButton>
        </div>
      </div>
    );
  }

  const previousNetworkName = prevNetworkRef.current?.label || 'N/A';

  const onSubmit = async () => {
    setLoading(true);
    try {
      // Perform the network switch and wait for state update
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        [newNetwork, true]
      );
      try {
        await waitForNetworkSwitch(newNetwork.chainId, 5000);
      } catch (_e) {
        // Best-effort; continue without blocking close
      }

      setConfirmed(true);
      setLoading(false);
      // Dispatch MUST happen immediately before closing to avoid timing issues with subsequent popups
      const type = data.eventName;
      dispatchBackgroundEvent(`${type}.${host}`, null);
      window.close();
    } catch (networkError) {
      console.error('Network switch failed:', networkError);
      setLoading(false);
      // Don't throw here - just reset the loading state so user can try again
    }
  };

  return (
    <>
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
              <div className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.previousChain')}
                <span className="flex items-center gap-2 text-brand-royalblue text-xs transition-opacity hover:opacity-90">
                  <ChainIcon
                    chainId={prevChainIdRef.current}
                    size={18}
                    networkKind={prevKindRef.current}
                  />
                  {previousNetworkName}
                  {getTypeBadge(prevKindRef.current)}
                </span>
              </div>

              <div className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newChain')}
                <span className="flex items-center gap-2 text-brand-royalblue text-xs transition-opacity hover:opacity-90">
                  <ChainIcon
                    chainId={newNetwork?.chainId}
                    size={18}
                    networkKind={INetworkType.Syscoin}
                  />
                  {newNetwork?.label || newChainValue}
                  {getTypeBadge(newNetwork?.kind ?? INetworkType.Syscoin)}
                </span>
              </div>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newNetworkUrl')}
                <span className="text-brand-royalblue text-xs break-all transition-opacity hover:opacity-90">
                  {newNetwork?.url || 'N/A'}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newNetworkChainId')}
                <span className="text-brand-royalblue text-xs transition-opacity hover:opacity-90">
                  {newNetwork?.chainId ?? 'N/A'}
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="w-full px-4 absolute bottom-12 md:static flex items-center justify-between">
          <SecondaryButton
            type="button"
            onClick={window.close}
            disabled={loading}
          >
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="submit"
            disabled={confirmed || loading}
            loading={loading}
            onClick={onSubmit}
          >
            {t('buttons.change')}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
};

export default SwitchNeworkUtxoEvm;
