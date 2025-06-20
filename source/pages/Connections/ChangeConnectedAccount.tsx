import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Layout, SecondaryButton, PrimaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import {
  selectActiveAccount,
  selectActiveAccountRef,
} from 'state/vault/selectors';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const ChangeConnectedAccount = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const activeAccountRef = useSelector(selectActiveAccountRef);
  const activeAccount = useSelector(selectActiveAccount);
  //TODO: validate this
  const { host, eventName, connectedAccount, accountType } = useQueryData();

  const handleConnectedAccount = async () => {
    await controllerEmitter(
      ['wallet', 'setAccount'],
      [connectedAccount.id, accountType]
    );

    dispatchBackgroundEvent(`${eventName}.${host}`, true);

    window.close();
  };

  const handleActiveAccount = async () => {
    await controllerEmitter(
      ['dapp', 'changeAccount'],
      [host, activeAccountRef.id, activeAccountRef.type]
    );
    //this should be passed to constant instead of being hardcoded
    dispatchBackgroundEvent(`${eventName}.${host}`, false);

    window.close();
  };

  return (
    <Layout
      canGoBack={false}
      title={t('connections.connectedAccount')}
      titleOnly={true}
    >
      <div className="flex flex-col items-center justify-center w-full">
        <h1 className="text-sm">PALI WALLET</h1>
        <div className="relative top-20 flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
          <h2 className="text-center text-sm">
            {t('connections.theWebsite')}{' '}
            <b className="text-gray-400">{host}</b>{' '}
            {t('header.hostIsConnected')} {connectedAccount.label} (
            {ellipsis(connectedAccount.address)}).
            {t('header.yourAcctiveAccountIs')}
            {activeAccount?.label} ({ellipsis(activeAccount?.address)}).
            {t('connections.withWitchAccount')}
          </h2>
          <div className="mt-1 px-4 w-full text-center text-xs">
            <span>
              {t('header.ifYouContinueWith')}{' '}
              <b className="text-gray-400">{host}</b> {t('header.to')}{' '}
              {activeAccount?.label}.
            </span>
          </div>
        </div>
        <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton
            type="button"
            onClick={() => handleConnectedAccount()}
          >
            {t('buttons.connected')}
          </SecondaryButton>

          <PrimaryButton
            type="button"
            width="40"
            onClick={() => handleActiveAccount()}
          >
            {t('buttons.active')}
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
