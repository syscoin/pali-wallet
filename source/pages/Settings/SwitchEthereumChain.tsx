import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { SecondButton } from 'components/Button/Button';
import { ChainIcon } from 'components/ChainIcon';
import { Icon } from 'components/Icon';
import { PrimaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { waitForNetworkSwitch } from 'utils/stateWaitUtils';

const SwitchChain: React.FC = () => {
  const { host, ...data } = useQueryData();
  const { chainId } = data;
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const prevChainIdRef = useRef(activeNetwork.chainId);
  const prevKindRef = useRef(activeNetwork.kind);
  const networks = useSelector(
    (state: RootState) => state.vaultGlobal.networks
  );
  const network = networks.ethereum[chainId];
  const { controllerEmitter } = useController();
  const { t } = useTranslation();

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
  const onSubmit = async () => {
    setLoading(true);
    try {
      // Perform the network switch and wait for state update
      await controllerEmitter(['wallet', 'setActiveNetwork'], [network, true]);
      try {
        await waitForNetworkSwitch(network.chainId, 5000);
      } catch (_e) {
        // Best-effort; continue without blocking close
      }
      setConfirmed(true);
      setLoading(false);
      // Dispatch MUST be right before window.close for subsequent popups timing
      const type = data.eventName;
      dispatchBackgroundEvent(`${type}.${host}`, null);
      window.close();
    } catch (networkError) {
      console.error('Network switch failed:', networkError);
      setLoading(false);
      // Don't throw here - just reset the loading state so user can try again
    }
  };

  const CurrentChains = () => {
    const fromChain = (
      <ChainIcon
        chainId={prevChainIdRef.current}
        size={100}
        className=""
        networkKind={prevKindRef.current}
        fallbackClassName="rounded-full flex items-center justify-center text-white text-sm bg-brand-blue200 p-5"
      />
    );

    const toChain = (
      <ChainIcon
        chainId={network.chainId}
        size={100}
        className=""
        networkKind={INetworkType.Ethereum}
        fallbackClassName="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
      />
    );

    return (
      <div className="w-4/5 gap-4 flex items-center align-center flex-row">
        {fromChain} <Icon name="arrowright" isSvg size={50} /> {toChain}
      </div>
    );
  };
  return (
    <>
      <div className="flex flex-col items-center justify-center w-full">
        <div className="relative top-15 flex flex-col pb-4 pt-4 w-full gap-4">
          <h2 className="text-center text-base">
            {t('send.allow')} {host} {t('settings.toSwitchNetwork')}?
          </h2>
          <div className="mt-1 px-4 w-full text-center text-sm">
            <span className="disabled">{t('settings.thisWillSwitch')}</span>
          </div>
          <div className="flex flex-col pb-4 pt-4 w-full text-center items-center">
            <CurrentChains />
            <div className="mt-2 flex items-center gap-2 text-brand-royalblue text-xs">
              <span className="flex items-center gap-1">
                {getTypeBadge(prevKindRef.current)}
              </span>
              <Icon name="arrowright" isSvg size={16} />
              <span className="flex items-center gap-1">
                {getTypeBadge(INetworkType.Ethereum)}
              </span>
            </div>
          </div>
        </div>

        <div className="w-full px-4 absolute bottom-12 md:static flex items-center justify-between">
          <SecondButton
            type="button"
            onClick={window.close}
            action={true}
            disabled={loading}
          >
            {t('buttons.reject')}
          </SecondButton>

          <PrimaryButton
            type="submit"
            disabled={confirmed || loading}
            loading={loading}
            onClick={onSubmit}
            action={true}
          >
            {t('buttons.confirm')}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
};

export default SwitchChain;
