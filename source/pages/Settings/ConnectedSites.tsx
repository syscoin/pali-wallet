import { Dialog } from '@headlessui/react';
import { GlobeAltIcon } from '@heroicons/react/outline';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  CenterPanel,
  DialogActionButton,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog/Dialog';
import { EditIconSvg } from 'components/Icon/Icon';
import { Button, Icon, IconButton, PageActionFooter } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { resolveDappAccount } from 'state/dapp/accountScope';
import { IDApp } from 'state/dapp/types';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/index';
import { navigateBack } from 'utils/navigationState';

import { NetworkTypeBadge } from './NetworkTypeBadge';

const connectionActionClassName =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-alpha-whiteAlpha200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

const ConnectedSites = () => {
  const { controllerEmitter } = useController();
  const { navigate } = useUtils();
  const location = useLocation();
  const { t } = useTranslation();
  const {
    accounts,
    activeAccount: activeAccountMeta,
    activeNetwork,
  } = useSelector((state: RootState) => state.vault);

  // Get dapps directly from Redux state
  const dapps = useSelector((state: RootState) => state.dapp.dapps);
  const [disconnectingHost, setDisconnectingHost] = useState<string | null>(
    null
  );
  const [disconnectError, setDisconnectError] = useState('');

  // Show all dapps since they're connected globally (one account per dapp)
  // Redux owns membership: an old optimistic removal must not hide a later
  // connection to the same host. Review the current permission, not a snapshot.
  const dappsList = Object.values(dapps);
  const [selectedHost, setSelectedHost] = useState<string>();
  const selected = dappsList.find((dapp) => dapp.host === selectedHost);
  // Foreign vaults remain removable without borrowing their numeric slot's
  // account label or address from the current vault.
  const accountFor = (dapp: IDApp) =>
    resolveDappAccount(dapp, accounts, activeNetwork);
  const accountLabel = (dapp: IDApp) =>
    accountFor(dapp)?.label || `Account ${dapp.accountId + 1}`;
  const selectedAccount = selected ? accountFor(selected) : undefined;
  useEffect(() => {
    if (selectedHost && !selected) setSelectedHost(undefined);
  }, [selectedHost, selected]);

  const disconnectHost = async (host: string) => {
    setDisconnectError('');
    setDisconnectingHost(host);
    setSelectedHost(undefined);

    try {
      // The controller will dispatch removeDApp action internally
      await controllerEmitter(
        ['dapp', 'disconnect'],
        [host, true, { allowAlreadyDisconnected: true, propagateErrors: true }]
      );
    } catch (error) {
      setDisconnectError(error?.message || t('send.failed'));
      console.error('Error disconnecting dapp:', error);
    } finally {
      setDisconnectingHost((current) => (current === host ? null : current));
    }
  };
  const disconnectSelected = () => {
    if (selected) void disconnectHost(selected.host);
  };

  return (
    <>
      <p className="w-full text-white text-sm md:max-w-md">
        {dappsList.length > 0
          ? `${dappsList.length} ${
              dappsList.length === 1 ? 'site is' : 'sites are'
            } connected to Pali Wallet`
          : 'No sites are connected to Pali Wallet'}
      </p>

      <div className="flex flex-col items-center justify-center w-full">
        <ul
          data-navigation-scroll="settings-connected-sites"
          className="remove-scrollbar w-full max-w-xs h-80 max-h-[calc(100dvh-16rem)] overflow-auto md:max-w-md"
        >
          {' '}
          {dappsList.map((_dapp) => (
            <li
              key={_dapp.host}
              className="flex items-center justify-between gap-3 my-2 py-3 w-full text-xs border-b border-dashed border-gray-500"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={_dapp.host}>
                  {_dapp.host}
                </p>
                {(!accountFor(_dapp) ||
                  _dapp.accountType !== activeAccountMeta.type ||
                  _dapp.accountId !== activeAccountMeta.id) && (
                  <p
                    className="truncate text-brand-graylight text-[10px] mt-1"
                    title={accountLabel(_dapp)}
                  >
                    Connected to: {accountLabel(_dapp)}
                  </p>
                )}
              </div>

              <IconButton
                aria-label={`${t('settings.editConnection')}: ${_dapp.host}`}
                className={connectionActionClassName}
                disabled={disconnectingHost === _dapp.host}
                onClick={() => setSelectedHost(_dapp.host)}
              >
                <EditIconSvg className="w-4" />
              </IconButton>
            </li>
          ))}
        </ul>

        {selected && (
          <DialogPrimitive show onClose={() => setSelectedHost(undefined)}>
            <CenterPanel
              padded={false}
              scroll={false}
              className="flex flex-col"
            >
              <DialogHeader
                title={t('settings.editConnection')}
                icon={<GlobeAltIcon />}
                onClose={() => setSelectedHost(undefined)}
              />
              <DialogBody>
                <Dialog.Description className="mb-3 text-content-secondary text-sm">
                  {t('settings.deleteConnected')}:
                </Dialog.Description>

                <div className="flex min-w-0 items-center justify-between gap-3 text-content-primary">
                  <p className="min-w-0 break-all">{selected.host}</p>

                  <IconButton
                    aria-label={t('settings.deleteConnected')}
                    className={connectionActionClassName}
                    disabled={disconnectingHost === selected.host}
                    onClick={disconnectSelected}
                  >
                    {disconnectingHost === selected.host ? (
                      <span className="text-xs text-brand-graylight">
                        Removing...
                      </span>
                    ) : (
                      <Icon name="delete" />
                    )}
                  </IconButton>
                </div>

                <div className="mt-4 rounded-card p-4 bg-surface-elevated">
                  <p className="mb-3 text-brand-white">
                    {t('settings.permissions')}
                  </p>
                  {selected.chain !== activeNetwork.kind && (
                    <NetworkTypeBadge kind={selected.chain} />
                  )}

                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <p className="break-words text-brand-white text-xs">
                      {accountLabel(selected)}
                    </p>

                    <p className="break-all text-brand-white text-xs">
                      {selectedAccount?.address
                        ? ellipsis(selectedAccount.address)
                        : t('settings.unavailable')}
                    </p>
                  </div>
                </div>
              </DialogBody>

              <DialogFooter>
                <DialogActions>
                  <DialogActionButton
                    type="button"
                    tone="secondary"
                    onClick={() => setSelectedHost(undefined)}
                  >
                    {t('buttons.close')}
                  </DialogActionButton>
                </DialogActions>
              </DialogFooter>
            </CenterPanel>
          </DialogPrimitive>
        )}

        <PageActionFooter error={disconnectError}>
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="button"
            fullWidth
            onClick={() => navigateBack(navigate, location)}
          >
            {t('buttons.close')}
          </Button>
        </PageActionFooter>
      </div>
    </>
  );
};

export default ConnectedSites;
