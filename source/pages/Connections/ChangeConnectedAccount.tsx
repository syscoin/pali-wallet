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
  const { accounts } = useSelector((state: RootState) => state.vault);
  const { dapp, wallet } = getController();
  //TODO: validate this
  const { host, eventName, connectedAccount, accountType } = useQueryData();

  const handleConnectedAccount = () => {
    dapp.changeAccount(host, activeAccount.id, activeAccount.type);
    dispatchBackgroundEvent(`${eventName}.${host}`, false);
    window.close();
  };

  const handleActiveAccount = () => {
    //this should be passed to constant instead of being hardcoded
    wallet.setAccount(connectedAccount.id, accountType);
    dispatchBackgroundEvent(`${eventName}.${host}`, true);
    window.close();
  };

  return (
    <Layout canGoBack={false} title="CONNECTED ACCOUNT" titleOnly={true}>
      <div className="flex flex-col items-center justify-center w-full">
        <h1 className="text-sm">PALI WALLET</h1>
        <div className="relative top-20 flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
          <h2 className="text-center text-sm">
            The website <b className="text-gray-400">{host}</b> is connected to{' '}
            {connectedAccount.label} ({ellipsis(connectedAccount.address)}).
            Your active account is{' '}
            {accounts[activeAccount.type][activeAccount.id].label} (
            {ellipsis(accounts[activeAccount.type][activeAccount.id].address)}).
            With which account you want to proceed?
          </h2>
          <div className="mt-1 px-4 w-full text-center text-xs">
            <span>
              If you continue with the active account, Pali will change the
              connected account for <b className="text-gray-400">{host}</b> to{' '}
              {accounts[activeAccount.type][activeAccount.id].label}.
            </span>
          </div>
        </div>
        <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton
            type="button"
            onClick={() => handleConnectedAccount()}
          >
            Connected
          </SecondaryButton>

          <PrimaryButton
            type="button"
            width="40"
            onClick={() => handleActiveAccount()}
          >
            Active
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
