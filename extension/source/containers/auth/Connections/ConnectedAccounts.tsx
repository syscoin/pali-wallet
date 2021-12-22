import React, { useState } from 'react';
import { SecondaryButton, PrimaryButton } from 'components/index';
import { useFormat, useAccount, useUtils, useStore, useDappConnection, usePopup } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';

export const ConnectedAccounts = () => {
  const { ellipsis } = useFormat();
  const { getHost } = useUtils();
  const { closePopup } = usePopup();
  const { connectedAccount } = useAccount();
  const { changeConnectedAccount } = useDappConnection();
  const { accounts, currentSenderURL } = useStore();

  const [accountId, setAccountId] = useState<number>(connectedAccount?.id || -1);

  const handleChangeAccount = (id: number) => {
    if (id === connectedAccount?.id) {
      return;
    }

    setAccountId(id);
  };

  return (
    <AuthViewLayout canGoBack={false} title="CONNECTED ACCOUNT">
      <div className="flex flex-col justify-center items-center w-full">
        <h1 className="text-sm mt-4">PALI WALLET</h1>

        <p className="text-brand-royalBlue text-sm">{getHost(`${currentSenderURL}`)}</p>

        <ul className="w-full flex flex-col gap-4 h-72 mt-4 overflow-auto px-8">
          {accounts.map((account: any) => (
            <li
              className={`${connectedAccount && account.id === connectedAccount.id ? 'cursor-not-allowed bg-opacity-50 border-brand-royalBlue' : 'cursor-pointer hover:bg-brand-navylight border-brand-royalBlue'} border border-solid  rounded-lg px-2 py-4 text-xs bg-brand-navydark flex justify-between items-center transition-all duration-200`}
              key={account.id}
              onClick={() => handleChangeAccount(account.id)}
            >
              <p>
                {account.label}
              </p>

              <small>{ellipsis(account.address.main)}</small>

              <div className={`${account.id === accountId ? 'bg-brand-green' : 'bg-brand-gray100'} w-3 h-3 rounded-full border border-brand-royalBlue`}></div>
            </li>
          ))}
        </ul>

        <div className="flex justify-between items-center absolute bottom-8 gap-3">
          <SecondaryButton
            type="button"
            onClick={closePopup}
          >
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="button"
            disabled={accountId === -1}
            onClick={() => changeConnectedAccount(accountId)}
          >
            Change
          </PrimaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};
