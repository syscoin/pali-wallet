import React, { useState } from 'react';
import Header from 'containers/common/Header';
import { Button, Icon } from 'components/index';
import { useStore, useUtils, useFormat, useDappConnection } from 'hooks/index';

const ConnectWallet = () => {
  const { getHost } = useUtils();
  const { ellipsis } = useFormat();
  const { confirmConnection, cancelConnection } = useDappConnection();
  const { accounts, activeAccountId, currentSenderURL } = useStore();

  const [accountId, setAccountId] = useState<number>(-1);
  const [continueConnection, setContinueConnection] = useState(false);
  const connectedAccount = accounts.find((account) => {
    return account.id === accountId;
  });

  const handleSelectAccount = (id: number) => {
    setAccountId(id);
  };

  return (
    <div>
      {continueConnection ? (
        <div >
          <Header />

          <h1>
            Connect with <b>Pali Wallet</b>
          </h1>

          <p>2/2</p>

          <div>
            <p>Site: {currentSenderURL}</p>
            {connectedAccount && (
              <div>
                <p>Connect to account {connectedAccount?.label}</p>
                <p>{ellipsis(connectedAccount?.address.main)}</p>
              </div>
            )}
          </div>

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
              onClick={() => confirmConnection(accountId)}
            >
              Confirm
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Header />

          <h1>
            Connect with <b>Pali Wallet</b>
          </h1>

          <p>1/2</p>
          <p>{getHost(`${currentSenderURL}`)}</p>
          <p>Choose account</p>

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
              onClick={() => setContinueConnection(true)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>

  );
};

export default ConnectWallet;
