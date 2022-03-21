import React, { useEffect, useState } from 'react';
import {
  Layout,
  PrimaryButton,
  SecondaryButton,
  Icon,
  Modal,
} from 'components/index';
import {
  useStore,
  useUtils,
  useFormat,
  useDappConnection,
  useAccount,
} from 'hooks/index';
import { Dialog } from '@headlessui/react';
import { browser } from 'webextension-polyfill-ts';
import queryString from 'query-string';
import { useLocation } from 'react-router-dom';

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
  const location = useLocation();

  const handleSelectAccount = async (id: number) => {
    if (connectedAccount && id === connectedAccount.id) {
      return;
    }

    setAccountId(id);

    const background = await browser.runtime.getBackgroundPage();

    const { windowId } = queryString.parse(location.search);

    background.dispatchEvent(
      new CustomEvent('connectWallet', {
        detail: { windowId, accounts },
      })
    );
  };

  useEffect(() => {
    const trustedApp = trustedApps[getHost(currentSenderURL)] !== '';

    setIsInTrustedList(trustedApp);
  });

  return (
    <Layout canGoBack={false} title="CONNECT WITH">
      <div className="flex flex-col items-center justify-center w-full">
        <h1 className="mt-4 text-sm">PALI WALLET</h1>

        <p className="text-brand-royalblue text-sm">
          {getHost(`${currentSenderURL}`)}
        </p>

        {accounts.length > 0 ? (
          <ul className="scrollbar-styled flex flex-col gap-4 mt-4 px-8 w-full h-64 overflow-auto">
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

                <div className="flex gap-3 items-center justify-center">
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

        <small className="mb-8 text-center text-brand-royalblue text-sm">
          Only connect with sites you trust.{' '}
          <a href="https://docs.syscoin.org/">Learn more.</a>
        </small>

        <div className="absolute bottom-10 flex gap-3 items-center justify-between w-full max-w-xs md:max-w-2xl">
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

        <Modal
          show={openExtraConfirmation}
          onClose={() => setOpenExtraConfirmation(false)}
        >
          <div className="inline-block align-middle my-8 p-6 w-full max-w-2xl text-center font-poppins bg-bkg-4 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
            <Dialog.Title
              as="h3"
              className="flex gap-3 items-center justify-center text-brand-white text-lg font-medium leading-6"
            >
              <Icon name="warning" className="mb-2 text-brand-white" />
              <p>Not trusted site detected</p>
            </Dialog.Title>

            <div className="mt-4">
              <p className="text-brand-white text-sm">
                This site is not on our trusted list. Are you sure you want to
                connect?
              </p>
            </div>

            <div className="flex gap-5 items-center justify-between mt-8">
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
      </div>
    </Layout>
  );
};
