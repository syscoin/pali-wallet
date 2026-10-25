import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import { Button, PageActionFooter } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { waitForNetworkSwitch } from 'utils/stateWaitUtils';

import { NetworkTypeBadge } from './NetworkTypeBadge';

const SwitchNeworkUtxoEvm: React.FC = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { newNetwork, newChainValue } = data;
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
    setLoading(true);
    setSwitchError('');
    try {
      // Perform the network switch and wait for state update
      await controllerEmitter(
        ['wallet', 'setActiveNetwork'],
        // The network/account state is committed before this resolves. Do not
        // keep a dapp approval popup open for the subsequent balance refresh.
        [newNetwork, false]
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
      setSwitchError(networkError?.message || t('send.failed'));
      setLoading(false);
      // Don't throw here - just reset the loading state so user can try again
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
                    chainId={newNetwork?.chainId}
                    size={18}
                    networkKind={newNetwork.kind}
                  />
                  {newNetwork?.label || newChainValue}
                  <NetworkTypeBadge
                    kind={newNetwork?.kind ?? INetworkType.Syscoin}
                  />
                </span>
              </div>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newNetworkUrl')}
                <span className="text-content-secondary text-xs break-all transition-opacity hover:opacity-90">
                  {newNetwork?.url || 'N/A'}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                {t('settings.newNetworkChainId')}
                <span className="text-content-secondary text-xs transition-opacity hover:opacity-90">
                  {newNetwork?.chainId ?? 'N/A'}
                </span>
              </p>
            </div>
          </div>
        </div>

        <PageActionFooter
          error={
            switchError && <span className="break-words">{switchError}</span>
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
              disabled={confirmed || loading}
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
