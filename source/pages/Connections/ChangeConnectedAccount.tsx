import React from 'react';
import { useSelector } from 'react-redux';

import { Layout, SecondaryButton, PrimaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const ChangeConnectedAccount = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { dapp, wallet } = getController();
  const { host, eventName, connectedAccount } = useQueryData();

  const handleConnectedAccount = () => {
    dapp.changeAccount(host, activeAccount.id);
    dispatchBackgroundEvent(`${eventName}.${host}`, false);
    window.close();
  };

  const handleActiveAccount = () => {
    //this should be passed to constant instead of being hardcoded
    wallet.setAccount(connectedAccount.id);
    dispatchBackgroundEvent(`${eventName}.${host}`, true);
    window.close();
  };

  return (
    <Layout canGoBack={false} title="CONNECTED ACCOUNT" titleOnly={true}>
      <div className="flex flex-col items-center justify-center w-full">
        <h1 className="text-sm">PALI WALLET</h1>
        <div className="relative top-20 flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
          <h2 className="text-center text-lg">
            The {host} is connected to account {connectedAccount.label} of
            address {ellipsis(connectedAccount.address)}. Your current account
            is {activeAccount.label} of address
            {ellipsis(activeAccount.address)}. Do you want to change to the
            {host} connected account ?
          </h2>
          <div className="mt-1 px-4 w-full text-center text-xs">
            <span>
              If you don't accept changing account pali will automatically
              change the connected account of {host} to: {activeAccount.label}{' '}
              of address {ellipsis(activeAccount.address)}
            </span>
          </div>
        </div>
        <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton
            type="button"
            onClick={() => handleConnectedAccount()}
          >
            Connected Account
          </SecondaryButton>

          <PrimaryButton
            type="button"
            width="40"
            onClick={() => handleActiveAccount()}
          >
            Active Account
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
