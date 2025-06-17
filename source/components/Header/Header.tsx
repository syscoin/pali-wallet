import { Dialog } from '@headlessui/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { INetwork } from '@pollum-io/sysweb3-network';

import { ErrorModal, Icon, Modal, PrimaryButton, SecondaryButton } from '..';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

import { AccountHeader } from '.';
import { GeneralMenu, NetworkMenu } from './Menus';
import { SetActiveAccountModal } from './SetActiveAccountModal';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const error = useSelector((state: RootState) => state.vault.error);

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { accounts } = useSelector((state: RootState) => state.vault);

  const {
    newConnectedAccount,
    host,
    isChangingConnectedAccount,
    connectedAccountType,
  } = useSelector((state: RootState) => state.vault.changingConnectedAccount);

  const [networkErrorStatus, setNetworkErrorStatus] = useState({
    error: false,
    description: '',
    title: '',
  });
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedNetwork, setSelectedNetwork] = useState<INetwork>();

  useEffect(() => {
    if (error) {
      setNetworkErrorStatus({
        error: true,
        description: error,
        title: t('header.errorSwitching'),
      });

      controllerEmitter(['wallet', 'resolveError']);
    }
  }, [error]);

  const handleDisconnectFromDapp = () => {
    controllerEmitter(['dapp', 'disconnect'], [host]);
    controllerEmitter(['wallet', 'resolveAccountConflict']);
  };
  const handleChangeConnectedAccount = () => {
    controllerEmitter(
      ['dapp', 'changeAccount'],
      [host, newConnectedAccount.id, connectedAccountType]
    );

    controllerEmitter(
      ['wallet', 'setAccount'],
      [newConnectedAccount.id, connectedAccountType]
    );

    controllerEmitter(['wallet', 'resolveAccountConflict']);
  };

  return (
    <div className={accountHeader ? 'pb-32' : 'pb-12'}>
      <div className="fixed z-50 w-full md:max-w-2xl">
        <div className="relative flex items-center justify-between p-2 py-6 w-full text-gray-300 bg-bkg-1">
          <NetworkMenu
            setActiveAccountModalIsOpen={setIsOpen}
            setSelectedNetwork={setSelectedNetwork}
          />

          <GeneralMenu />
          <SetActiveAccountModal
            showModal={isOpen}
            setIsOpen={setIsOpen}
            selectedNetwork={selectedNetwork}
          />

          <ErrorModal
            title={t('header.errorSwitching')}
            description={t('header.thereWasAnError')}
            log={networkErrorStatus.description}
            show={networkErrorStatus.error}
            onClose={() =>
              setNetworkErrorStatus({
                error: false,
                description: '',
                title: '',
              })
            }
          />

          <Modal
            show={isChangingConnectedAccount}
            onClose={() =>
              controllerEmitter(['wallet', 'resolveAccountConflict'])
            }
          >
            <div className="inline-block align-middle my-8 p-6 w-full max-w-2xl text-center font-poppins bg-bkg-4 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
              <Dialog.Title
                as="h3"
                className="flex gap-3 items-center justify-center text-brand-white text-lg font-medium leading-6"
              >
                <Icon name="warning" className="mb-2 text-brand-white" />
                <p>{t('header.switchActiveAccount')}</p>
              </Dialog.Title>

              <div className="mt-4">
                <p className="text-brand-white text-sm">
                  <b className="text-gray-400">{host}</b>{' '}
                  {t('header.hostIsConnected')}{' '}
                  {newConnectedAccount ? newConnectedAccount.label : ''}.{' '}
                  {t('header.yourActiveAccountIs')}{' '}
                  {accounts[activeAccount.type][activeAccount.id].label}.{' '}
                  {t('header.wouldYouLikeTo')}
                </p>
              </div>

              <div className="mt-4">
                <span className="text-brand-white text-xs">
                  {t('header.ifYouContinueWith')}{' '}
                  <b className="text-gray-400">{host}</b> to{' '}
                  {newConnectedAccount ? newConnectedAccount.label : ''}{' '}
                  {t('header.andYouWillNeed')}{' '}
                </span>
              </div>

              <div className="flex gap-5 items-center justify-between mt-8">
                <SecondaryButton
                  action
                  width="32"
                  type="button"
                  onClick={() => handleDisconnectFromDapp()}
                >
                  {t('buttons.noCancel')}
                </SecondaryButton>

                <PrimaryButton
                  action
                  width="32"
                  type="button"
                  onClick={() => handleChangeConnectedAccount()}
                >
                  {t('buttons.yesContinue')}
                </PrimaryButton>
              </div>
            </div>
          </Modal>
        </div>

        {accountHeader && <AccountHeader />}
      </div>
    </div>
  );
};
