import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import { Button, PageActionFooter } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetwork } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import {
  NETWORK_SWITCH_REVIEW_CHANGED,
  networkRegistrationFingerprint,
} from 'utils/networkRegistration';
import { waitForNetworkSwitch } from 'utils/stateWaitUtils';

import { NetworkTypeBadge } from './NetworkTypeBadge';

const SwitchNeworkUtxoEvm: React.FC = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const {
    newNetwork,
    newChainValue,
  }: { newChainValue?: string; newNetwork?: INetwork } = data;
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const { t } = useTranslation();
  const { activeNetwork } = useSelector((state: RootState) => state.vault);
  const previousNetwork = useRef([
    activeNetwork?.chainId,
    activeNetwork?.kind,
    activeNetwork?.label,
  ] as const).current;
  const registeredNetwork = useSelector((state: RootState) =>
    newNetwork
      ? state.vaultGlobal.networks[newNetwork.kind]?.[newNetwork.chainId]
      : undefined
  );
  const requestedRegistration = networkRegistrationFingerprint(newNetwork);
  const review = useRef({
    registration: requestedRegistration,
    retired: false,
    live: false,
  });
  const reviewedRegistration = review.current.registration;
  const network =
    !review.current.retired &&
    newNetwork?.kind === newChainValue &&
    requestedRegistration === reviewedRegistration &&
    networkRegistrationFingerprint(registeredNetwork) === reviewedRegistration
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
          <Button
            variant="secondary"
            type="button"
            onClick={() => window.close()}
          >
            {t('buttons.close')}
          </Button>
        </div>
      </div>
    );
  }

  const previousNetworkName = previousNetwork[2] || 'N/A';

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
        // The network/account state is committed before this resolves. Do not
        // keep a dapp approval popup open for the subsequent balance refresh.
        [network, false, reviewedRegistration]
      );
      if (!review.current.live) return;
      try {
        await waitForNetworkSwitch(network.chainId, 5000, network.kind);
      } catch (_e) {
        // Best-effort; continue without blocking close
      }

      if (!review.current.live) return;
      setConfirmed(true);
      // Dispatch MUST happen immediately before closing to avoid timing issues with subsequent popups
      const type = data.eventName;
      dispatchBackgroundEvent(`${type}.${host}`, null);
      window.close();
    } catch (networkError) {
      if (!review.current.live) return;
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

  return (
    <>
      <div className="flex flex-col items-center justify-center w-full">
        <div className="mt-5 flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
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
                <span className="flex items-center gap-2 text-content-secondary text-xs transition-opacity hover:opacity-90">
                  <ChainIcon
                    chainId={previousNetwork[0]}
                    size={18}
                    networkKind={previousNetwork[1]}
                  />
                  {previousNetworkName}
                  <NetworkTypeBadge kind={previousNetwork[1]} />
                </span>
              </div>

              <div className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newChain')}
                <span className="flex items-center gap-2 text-content-secondary text-xs transition-opacity hover:opacity-90">
                  <ChainIcon
                    chainId={newNetwork.chainId}
                    size={18}
                    networkKind={newNetwork.kind}
                  />
                  {network
                    ? network.label || newChainValue
                    : t('settings.unavailable')}
                  <NetworkTypeBadge kind={newNetwork.kind} />
                </span>
              </div>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newNetworkUrl')}
                <span className="text-content-secondary text-xs break-all transition-opacity hover:opacity-90">
                  {network?.url || 'N/A'}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newNetworkChainId')}
                <span className="text-content-secondary text-xs transition-opacity hover:opacity-90">
                  {newNetwork.chainId}
                </span>
              </p>
            </div>
          </div>
        </div>

        <PageActionFooter
          error={
            (!network || switchError) && (
              <span className="break-words">
                {network ? switchError : t('settings.unknownNetwork')}
              </span>
            )
          }
        >
          <div className="grid w-full grid-cols-2 gap-3">
            <Button
              variant="secondary"
              type="button"
              fullWidth
              onClick={window.close}
              disabled={loading}
            >
              {t('buttons.cancel')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              fullWidth
              disabled={!network || confirmed || loading}
              loading={loading}
              onClick={onSubmit}
            >
              {t('buttons.change')}
            </Button>
          </div>
        </PageActionFooter>
      </div>
    </>
  );
};

export default SwitchNeworkUtxoEvm;
