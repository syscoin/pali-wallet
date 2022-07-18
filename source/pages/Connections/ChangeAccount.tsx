import React, { useState } from 'react';

import { Layout, SecondaryButton, PrimaryButton } from 'components/index';
import { useStore } from 'hooks/index';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const ChangeAccount = () => {
  const { accounts } = useStore();
  const { dapp } = getController();
  const connectedAccountId = dapp.getCurrent().accountId;

  const [accountId, setAccountId] = useState<number>(connectedAccountId);

  const handleChangeAccount = (id: number) => {
    if (id === connectedAccountId) return;

    setAccountId(id);
  };

  const changeConnectedAccount = () => {
    dapp.changeConnectedAccount(accountId);
    window.close();
  };

  return (
    <Layout canGoBack={false} title="CONNECTED ACCOUNT">
      <div className="flex flex-col items-center justify-center w-full">
        <h1 className="mt-4 text-sm">PALI WALLET</h1>

        <ul className="scrollbar-styled flex flex-col gap-4 mt-4 px-8 w-full h-72 overflow-auto">
          {Object.values(accounts).map((account) => (
            <li
              className={`${
                account.id === connectedAccountId
                  ? 'cursor-not-allowed bg-opacity-50 border-brand-royalblue'
                  : 'cursor-pointer hover:bg-bkg-4 border-brand-royalblue'
              } border border-solid  rounded-lg px-2 py-4 text-xs bg-bkg-2 flex justify-between items-center transition-all duration-200`}
              key={account.id}
              onClick={() => handleChangeAccount(account.id)}
            >
              <p>{account.label}</p>

              <small>{ellipsis(account.address)}</small>

              <div
                className={`${
                  account.id === accountId
                    ? 'bg-warning-success'
                    : 'bg-brand-graylight'
                } w-3 h-3 rounded-full border border-brand-royalblue`}
              />
            </li>
          ))}
        </ul>

        <div className="absolute bottom-10 flex gap-3 items-center justify-between w-full max-w-xs md:max-w-2xl">
          <SecondaryButton type="button" onClick={() => window.close()} action>
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="button"
            width="40"
            disabled={accountId === undefined}
            onClick={() => changeConnectedAccount()}
          >
            Change
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
