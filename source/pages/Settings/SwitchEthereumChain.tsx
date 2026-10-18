import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button } from 'components/Button/Button';
import { ChainIcon } from 'components/ChainIcon';
import { Icon } from 'components/Icon';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { waitForNetworkSwitch } from 'utils/stateWaitUtils';

import { NetworkTypeBadge } from './NetworkTypeBadge';

const SwitchChain: React.FC = () => {
  const { host, chainId, eventName } = useQueryData();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const previousNetwork = useRef([
    activeNetwork.chainId,
    activeNetwork.kind,
  ] as const).current;
  const networks = useSelector(
    (state: RootState) => state.vaultGlobal.networks
  );
  const network = networks.ethereum[chainId];
  const { controllerEmitter } = useController();
  const { t } = useTranslation();

  const onSubmit = async () => {
    setLoading(true);
    setSwitchError('');
    try {
      // Perform the network switch and wait for state update
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        // Balance refreshes must not hold a dapp switch approval open.
        [network, false]
      );
      try {
        await waitForNetworkSwitch(network.chainId, 5000);
      } catch (_e) {
        // Best-effort; continue without blocking close
      }
      setConfirmed(true);
      setLoading(false);
      // Dispatch MUST be right before window.close for subsequent popups timing
      dispatchBackgroundEvent(`${eventName}.${host}`, null);
      window.close();
    } catch (networkError) {
      console.error('Network switch failed:', networkError);
      setSwitchError(networkError?.message || t('send.failed'));
      setLoading(false);
      // Don't throw here - just reset the loading state so user can try again
    }
  };

  const CurrentChains = () => (
    <div className="w-4/5 gap-4 flex items-center align-center flex-row">
      <ChainIcon
        chainId={previousNetwork[0]}
        size={100}
        networkKind={previousNetwork[1]}
        fallbackClassName="rounded-full flex items-center justify-center text-white text-sm bg-brand-blue200 p-5"
      />{' '}
      <Icon name="arrowright" isSvg size={50} />{' '}
      <ChainIcon
        chainId={network.chainId}
        size={100}
        networkKind={INetworkType.Ethereum}
        fallbackClassName="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
      />
    </div>
  );

  return (
    <>
      <div className="flex flex-col items-center justify-center w-full gap-6 pb-6">
        <div className="mt-12 flex flex-col pb-4 pt-4 w-full gap-4">
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
                <NetworkTypeBadge kind={previousNetwork[1]} />
              </span>
              <Icon name="arrowright" isSvg size={16} />
              <span className="flex items-center gap-1">
                <NetworkTypeBadge kind={INetworkType.Ethereum} />
              </span>
            </div>
          </div>
        </div>

        <div className="w-full px-4 flex flex-wrap items-center justify-between">
          {switchError && (
            <p
              role="alert"
              className="mb-3 w-full break-words text-sm text-warning-error"
            >
              {switchError}
            </p>
          )}
          <Button
            variant="ghost"
            type="button"
            onClick={window.close}
            disabled={loading}
            icon={
              <Icon
                name="close"
                wrapperClassname="mb-0.5"
                className="text-brand-white font-bold"
              />
            }
          >
            {t('buttons.reject')}
          </Button>

          <Button
            variant="primary"
            type="submit"
            disabled={confirmed || loading}
            loading={loading}
            onClick={onSubmit}
            icon={
              <Icon
                name="check-outlined"
                wrapperClassname="mb-0.5"
                className={
                  confirmed || loading ? 'text-disabled' : 'text-brand-white'
                }
              />
            }
          >
            {t('buttons.confirm')}
          </Button>
        </div>
      </div>
    </>
  );
};

export default SwitchChain;
