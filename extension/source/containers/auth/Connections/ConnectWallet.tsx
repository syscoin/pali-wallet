import React, { useState } from 'react';
import { PrimaryButton, SecondaryButton, Icon } from 'components/index';
import { useStore, useUtils, useFormat, useDappConnection, useAccount } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';

export const ConnectWallet = () => {
  const { getHost } = useUtils();
  const { ellipsis } = useFormat();
  const { confirmConnection, cancelConnection } = useDappConnection();
  const { accounts, currentSenderURL } = useStore();
  const { connectedAccount } = useAccount();

  const [accountId, setAccountId] = useState<number>(-1);

  const handleSelectAccount = (id: number) => {
    if (connectedAccount && id === connectedAccount.id) {
      return;
    }
    
    setAccountId(id);
  };

  return (
    <AuthViewLayout title="CONNECT WITH">
      <div className="flex flex-col justify-center items-center w-full">
        <h1 className="text-sm mt-4">PALI WALLET</h1>

        <p className="text-brand-royalBlue text-sm">{getHost(`${currentSenderURL}`)}</p>

        {accounts.length > 0 ? (
          <ul className="w-full flex flex-col gap-4 h-64 mt-4 overflow-auto px-8">
            {accounts.map((acc: any) => (
              <li
                className={`${connectedAccount && acc.id === connectedAccount.id ? 'cursor-not-allowed bg-opacity-50 border-brand-royalBlue' : 'cursor-pointer hover:bg-brand-navylight border-brand-royalBlue'} border border-solid  rounded-lg px-2 py-4 text-xs bg-brand-navydark flex justify-between items-center transition-all duration-200`}
                key={acc.id}
                onClick={() => handleSelectAccount(acc.id)}
              >
                <p>
                  {acc.label}
                </p>

                <small>{ellipsis(acc.address.main)}</small>

                <div className={`${acc.id === accountId ? 'bg-brand-green' : 'bg-brand-gray100'} w-3 h-3 rounded-full border border-brand-royalBlue`}></div>
              </li>
            ))}
          </ul>
        ) : (
          <div>
            <Icon name="loading" className="w-4 text-brand-gray200" />
          </div>
        )}

        <small className="text-brand-royalBlue text-sm text-center mb-8">
          Only connect with sites you trust. <a href="#">Learn more.</a>
        </small>

        <div className="flex justify-between items-center absolute bottom-8 gap-3">
          <SecondaryButton
            type="button"
            onClick={() => cancelConnection(accountId)}
          >
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="button"
            disabled={accountId === -1}
            onClick={() => confirmConnection(accountId)}
          >
            {accountId > -1 ? 'Confirm' : 'Next'}
          </PrimaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};
