import React, { useState } from 'react';
import { Button } from 'components/index';;
import { Header } from 'containers/common/Header';
import { useFormat, useUtils, useStore, useDappConnection, usePopup } from 'hooks/index';

export const ConnectedAccounts = () => {
  const { ellipsis } = useFormat();
  const { getHost } = useUtils();
  const { closePopup } = usePopup();
  const { changeConnectedAccount } = useDappConnection();
  const { accounts, currentSenderURL, activeAccountId } = useStore();

  const [changeAccountIsOpen, setChangeAccountIsOpen] =
    useState<boolean>(false);
  const [accountId, setAccountId] = useState<number>(-1);

  const connectedAccount = accounts.filter((account) => {
    return account.connectedTo.find((url: any) => {
      return url == getHost(currentSenderURL);
    });
  });

  const handleChangeAccount = (id: number) => {
    if (id === connectedAccount[0].id) {
      return;
    }

    setAccountId(id);
  };

  return (
    <div >
      <Header />

      {changeAccountIsOpen ? (
        <div >
          <p >Choose your account</p>

          <ul >
            {accounts.map((account) => {
              return (
                <li
                  key={account.id}
                  onClick={() => handleChangeAccount(account.id)}
                > 
                  <div >
                    <p>{account.label}</p>
                    <small>{ellipsis(account.address.main)}</small>
                  </div>
                  {account.id === activeAccountId && <small>(active)</small>}
                  {account.id === accountId && account.id !== connectedAccount[0].id && (
                    // <img src={checkGreen} alt="check" />
                    <p>check</p>
                  )}
                </li>
              );
            })}
          </ul>

          <div >
            <Button
              type="button"
              onClick={() => setChangeAccountIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => changeConnectedAccount(accountId)}
            >
              Confirm
            </Button>
          </div>
        </div>
      ) : (
        <div >
          <div>
            <p>
              This account is connected to
              <br />
              {getHost(currentSenderURL)}
            </p>
            {connectedAccount[0].isTrezorWallet ? (
              <small>
                To change your connected Trezor account, you need to disconnect and connect the account you want.
              </small>
            ) : (
              <small>
                To change your connected account you need to have more than one
                account.
              </small>
            )}
          </div>

          <div >
            <div>
              <p>{connectedAccount[0].label}</p>
              <small>{ellipsis(connectedAccount[0].address.main)}</small>
            </div>
          </div>

          <div >
            <Button
              type="button"
              onClick={closePopup}
            >
              Close
            </Button>

            <Button
              type="button"
              onClick={() => setChangeAccountIsOpen(!changeAccountIsOpen)}
            >
              Change
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
