import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { Layout, SecondaryButton, PrimaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const ChangeAccount = () => {
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { dapp } = getController();
  const { host } = useQueryData();

  const currentAccountId = dapp.get(host).accountId;

  const [accountId, setAccountId] = useState<number>(currentAccountId);

  const handleSetAccountId = (id: number) => {
    if (id === currentAccountId) return;
    setAccountId(id);
  };

  const handleChangeAccount = () => {
    dapp.changeAccount(host, accountId);
    window.close();
  };

  return (
    <Layout canGoBack={false} title="CONNECTED ACCOUNT" titleOnly={true}>
      <div className="flex flex-col items-center justify-center w-full">
        <h1 className="text-sm">PALI WALLET</h1>

        <ul className="scrollbar-styled flex flex-col gap-4 mt-4 px-8 w-full h-72 overflow-auto">
          {Object.values(accounts).map((account) => (
            <li
              className={`${
                account.id === currentAccountId
                  ? 'cursor-not-allowed bg-opacity-50 border-brand-royalblue'
                  : 'cursor-pointer hover:bg-bkg-4 border-brand-royalblue'
              } border border-solid  rounded-lg px-2 py-4 text-xs bg-bkg-2 flex justify-between items-center transition-all duration-200`}
              key={account.id}
              onClick={() => handleSetAccountId(account.id)}
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

        <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton type="button" onClick={() => window.close()}>
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="button"
            width="40"
            disabled={accountId === currentAccountId}
            onClick={() => handleChangeAccount()}
          >
            Change
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
