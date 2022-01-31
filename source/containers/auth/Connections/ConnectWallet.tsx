import React, { useEffect, useState } from 'react';
import { PrimaryButton, SecondaryButton, Icon, Modal } from 'components/index';
import {
  useStore,
  useUtils,
  useFormat,
  useDappConnection,
  useAccount,
} from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Dialog } from '@headlessui/react';

export const ConnectWallet = () => {
  const { getHost } = useUtils();
  const { ellipsis } = useFormat();
  const { confirmConnection, cancelConnection } = useDappConnection();
  const { accounts, currentSenderURL, trustedApps } = useStore();
  const { connectedAccount } = useAccount();

  const [accountId, setAccountId] = useState<number>(-1);
  const [isInTrustedList, setIsInTrustedList] = useState<boolean>(false);
  const [openExtraConfirmation, setOpenExtraConfirmation] =
    useState<boolean>(false);

  const handleSelectAccount = (id: number) => {
    if (connectedAccount && id === connectedAccount.id) {
      return;
    }

    setAccountId(id);
  };

  useEffect(() => {
    const trustedApp = trustedApps[getHost(currentSenderURL)] !== '';

    setIsInTrustedList(trustedApp);
  });

  return (
    <AuthViewLayout canGoBack={false} title="CONNECT WITH">
      <div className="flex flex-col justify-center items-center w-full">
        <h1 className="text-sm mt-4">PALI WALLET</h1>

        <p className="text-brand-royalblue text-sm">
          {getHost(`${currentSenderURL}`)}
        </p>

        {accounts.length > 0 ? (
          <ul className="scrollbar-styled w-full flex flex-col gap-4 h-64 mt-4 overflow-auto px-8">
            {accounts.map((acc: any) => (
              <li
                className={`${
                  connectedAccount && acc.id === connectedAccount.id
                    ? 'cursor-not-allowed bg-opacity-50 border-brand-royalblue'
                    : 'cursor-pointer hover:bg-bkg-4 border-brand-royalblue'
                } border border-solid  rounded-lg px-2 py-4 text-xs bg-bkg-2 flex justify-between items-center transition-all duration-200`}
                key={acc.id}
                onClick={() => handleSelectAccount(acc.id)}
              >
                <p>{acc.label}</p>

                <div className="flex justify-center items-center gap-3">
                  <small>{ellipsis(acc.address.main)}</small>

                  <div
                    className={`${
                      acc.id === accountId
                        ? 'bg-warning-success'
                        : 'bg-brand-graylight'
                    } w-3 h-3 rounded-full border border-brand-royalblue`}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div>
            <Icon name="loading" className="w-4 text-brand-graylight" />
          </div>
        )}

        <small className="text-brand-royalblue text-sm text-center mb-8">
          Only connect with sites you trust.{' '}
          <a href="https://docs.syscoin.org/">Learn more.</a>
        </small>

        <div className="flex justify-between w-full max-w-xs md:max-w-2xl items-center absolute bottom-10 gap-3">
          <SecondaryButton
            type="button"
            action
            onClick={() => cancelConnection(accountId)}
          >
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="button"
            action
            disabled={accountId === -1}
            onClick={
              !isInTrustedList
                ? () => setOpenExtraConfirmation(true)
                : () => confirmConnection(accountId)
            }
          >
            {accountId > -1 ? 'Confirm' : 'Next'}
          </PrimaryButton>
        </div>

        {openExtraConfirmation && (
          <Modal
            type=""
            open={openExtraConfirmation}
            onClose={() => setOpenExtraConfirmation(false)}
          >
            <div className="font-poppins inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-center align-middle transition-all border border-brand-royalblue transform bg-bkg-4 shadow-xl rounded-2xl">
              <Dialog.Title
                as="h3"
                className="text-lg font-medium leading-6 text-brand-white flex justify-center gap-3 items-center"
              >
                <Icon name="warning" className="text-brand-white mb-2" />
                <p>Not trusted site detected</p>
              </Dialog.Title>

              <div className="mt-4">
                <p className="text-sm text-brand-white">
                  This site is not on our trusted list. Are you sure you want to
                  connect?
                </p>
              </div>

              <div className="mt-8 flex justify-between items-center gap-5">
                <SecondaryButton
                  action
                  width="32"
                  type="button"
                  onClick={() => cancelConnection(accountId)}
                >
                  Cancel
                </SecondaryButton>

                <PrimaryButton
                  action
                  width="32"
                  type="button"
                  onClick={() => confirmConnection(accountId)}
                >
                  Confirm
                </PrimaryButton>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AuthViewLayout>
  );
};
