import React, { useState } from 'react';
import { Button, Icon } from 'components/index';
import { useStore, useUtils, useFormat, useDappConnection } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';

export const ConnectWallet = () => {
  const { getHost } = useUtils();
  const { ellipsis } = useFormat();
  const { confirmConnection, cancelConnection } = useDappConnection();
  const { accounts, activeAccountId, currentSenderURL } = useStore();

  const [accountId, setAccountId] = useState<number>(-1);

  const handleSelectAccount = (id: number) => {
    setAccountId(id);
  };

  return (
    <AuthViewLayout title="CONNECT WITH">
      <h1>PALI WALLET</h1>

      <p>{getHost(`${currentSenderURL}`)}</p>

      {accounts.length > 0 ? (
        <ul>
          {accounts.map((acc: any) => (
            <li
              key={acc.id}
              onClick={() => handleSelectAccount(acc.id)}
            >
              <div>
                <p>
                  {acc.label}{' '}
                  {acc.id === activeAccountId && <small>(active)</small>}
                </p>
                <small>{ellipsis(acc.address.main)}</small>
              </div>

              {acc.id === accountId && <p>check</p>}
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
        </div>
      )}

      <small>
        Only connect with sites you trust. <a href="#">Learn more.</a>
      </small>

      <div>
        <Button
          type="button"
          onClick={() => cancelConnection(accountId)}
        >
          Cancel
        </Button>

        <Button
          type="button"
          disabled={accountId === -1}
          onClick={() => confirmConnection(accountId)}
        >
          {accountId > -1 ? 'Confirm' : 'Next'}
        </Button>
      </div>
    </AuthViewLayout>
  );
};
