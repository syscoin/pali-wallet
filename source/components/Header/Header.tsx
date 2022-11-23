import { Dialog } from '@headlessui/react';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { ErrorModal, Icon, Modal, PrimaryButton, SecondaryButton } from '..';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { AccountHeader } from '.';
import { GeneralMenu, NetworkMenu } from './Menus';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const { wallet, dapp } = getController();

  const error = useSelector((state: RootState) => state.vault.error);

  const isPendingBalances = useSelector(
    (state: RootState) => state.vault.isPendingBalances
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { newConnectedAccount, host, isChangingConnectedAccount } = useSelector(
    (state: RootState) => state.vault.changingConnectedAccount
  );

  const [networkErrorStatus, setNetworkErrorStatus] = useState({
    error: false,
    description: '',
    title: '',
  });

  useEffect(() => {
    if (!isPendingBalances && error) {
      setNetworkErrorStatus({
        error: true,
        description:
          'There was an error while trying to switch network. Try again later.',
        title: 'Error switching networks',
      });

      wallet.resolveError();
    }
  }, [isPendingBalances, error]);

  const hanldeDisconnectFromDapp = () => {
    dapp.disconnect(host);
    wallet.resolveAccountConflict();
  };
  const handleChangeConnectedAccount = () => {
    dapp.changeAccount(host, newConnectedAccount.id);
    wallet.setAccount(newConnectedAccount.id);
    wallet.resolveAccountConflict();
  };

  return (
    <div className={accountHeader ? 'pb-32' : 'pb-12'}>
      <div className="fixed z-10 w-full md:max-w-2xl">
        <div className="relative flex items-center justify-between p-2 py-6 w-full text-gray-300 bg-bkg-1">
          <NetworkMenu />

          <GeneralMenu />

          <ErrorModal
            title="Error switching networks"
            description="There was an error while trying to switch network. Try again later."
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
            onClose={() => wallet.resolveAccountConflict()}
          >
            <div className="inline-block align-middle my-8 p-6 w-full max-w-2xl text-center font-poppins bg-bkg-4 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
              <Dialog.Title
                as="h3"
                className="flex gap-3 items-center justify-center text-brand-white text-lg font-medium leading-6"
              >
                <Icon name="warning" className="mb-2 text-brand-white" />
                <p>Switch active account</p>
              </Dialog.Title>

              <div className="mt-4">
                <p className="text-brand-white text-sm">
                  {` ${
                    newConnectedAccount ? newConnectedAccount.label : ''
                  } is not connected.
                    \
                    Do you want to switch connection for: ${host} 
                    \
                    to current account

                    If you don't switch ${
                      activeAccount.label
                    }  will be disconnected`}
                </p>
              </div>

              <div className="flex gap-5 items-center justify-between mt-8">
                <SecondaryButton
                  action
                  width="32"
                  type="button"
                  onClick={() => hanldeDisconnectFromDapp()}
                >
                  Disconnect
                </SecondaryButton>

                <PrimaryButton
                  action
                  width="32"
                  type="button"
                  onClick={() => handleChangeConnectedAccount()}
                >
                  Connect account
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
