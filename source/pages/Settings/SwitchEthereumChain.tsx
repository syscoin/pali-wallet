import React, { useLayoutEffect, useRef, useState } from 'react';
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
import {
  NETWORK_SWITCH_REVIEW_CHANGED,
  networkRegistrationFingerprint,
} from 'utils/networkRegistration';
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
    activeNetwork.label,
  ] as const).current;
  const registeredNetwork = useSelector(
    (state: RootState) => state.vaultGlobal.networks.ethereum[chainId]
  );
  const registration = networkRegistrationFingerprint(registeredNetwork);
  const review = useRef({ registration, retired: false, live: false });
  const reviewedRegistration = review.current.registration;
  const network =
    !review.current.retired && registration === reviewedRegistration
      ? registeredNetwork
      : undefined;
  const available = !!network;
  const submitting = useRef(false);
  useLayoutEffect(() => {
    const owner = review.current;
    owner.retired ||= !available;
    owner.live = available;
    return () => {
      owner.live = false;
    };
  }, [available]);
  const { controllerEmitter } = useController();
  const { t } = useTranslation();

  const onSubmit = async () => {
    if (
      !network ||
      !reviewedRegistration ||
      !review.current.live ||
      submitting.current
    )
      return;
    submitting.current = true;
    setLoading(true);
    setSwitchError('');
    try {
      // Perform the network switch and wait for state update
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        // Balance refreshes must not hold a dapp switch approval open.
        [network, false, reviewedRegistration]
      );
      if (!review.current.live) return;
      try {
        await waitForNetworkSwitch(network.chainId, 5000);
      } catch (_e) {
        // Best-effort; continue without blocking close
      }
      if (!review.current.live) return;
      setConfirmed(true);
      // Dispatch MUST be right before window.close for subsequent popups timing
      dispatchBackgroundEvent(`${eventName}.${host}`, null);
      window.close();
    } catch (networkError) {
      if (networkError?.message === NETWORK_SWITCH_REVIEW_CHANGED) {
        review.current.retired = true;
        review.current.live = false;
        setSwitchError(t('settings.unknownNetwork'));
        return;
      }
      console.error('Network switch failed:', networkError);
      setSwitchError(networkError?.message || t('send.failed'));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const CurrentChains = () => (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4">
      <section
        aria-label={t('settings.previousChain')}
        className="flex min-w-0 flex-col items-center gap-2"
      >
        <p className="text-xs text-content-secondary [overflow-wrap:anywhere]">
          {t('settings.previousChain')}
        </p>
        <ChainIcon
          chainId={previousNetwork[0]}
          size={80}
          networkKind={previousNetwork[1]}
          fallbackClassName="rounded-full flex items-center justify-center text-white text-sm bg-brand-blue200 p-5"
        />
        <p className="w-full text-sm [overflow-wrap:anywhere]">
          {previousNetwork[2] || t('settings.unavailable')}
        </p>
        <p className="w-full text-xs text-content-secondary [overflow-wrap:anywhere]">
          {t('send.chainId')}: {previousNetwork[0]}
        </p>
        <NetworkTypeBadge kind={previousNetwork[1]} />
      </section>
      <Icon name="arrowright" isSvg size={24} />
      <section
        aria-label={t('settings.newChain')}
        className="flex min-w-0 flex-col items-center gap-2"
      >
        <p className="text-xs text-content-secondary [overflow-wrap:anywhere]">
          {t('settings.newChain')}
        </p>
        <ChainIcon
          chainId={network?.chainId ?? chainId}
          size={80}
          networkKind={INetworkType.Ethereum}
          fallbackClassName="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
        />
        <p className="w-full text-sm [overflow-wrap:anywhere]">
          {network?.label || t('settings.unavailable')}
        </p>
        <p className="w-full text-xs text-content-secondary [overflow-wrap:anywhere]">
          {t('send.chainId')}: {network?.chainId ?? chainId}
        </p>
        <NetworkTypeBadge kind={INetworkType.Ethereum} />
      </section>
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
          </div>
        </div>

        <div className="w-full px-4 flex flex-wrap items-center justify-between gap-y-3">
          {(!network || switchError) && (
            <p
              role="alert"
              className="mb-3 w-full break-words text-sm text-warning-error"
            >
              {network ? switchError : t('settings.unknownNetwork')}
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
            disabled={!network || confirmed || loading}
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
