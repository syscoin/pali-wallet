import React, { useState } from 'react';
import { Button } from 'components/index';;
import Header from 'containers/common/Header';
import { useController, useFormat, useUtils, useStore, useBrowser } from 'hooks/index';

const ConnectedAccounts = () => {
  const controller = useController();
  const { ellipsis } = useFormat();
  const { getHost, alert } = useUtils();
  const { browser } = useBrowser();

  const { accounts, tabs, activeAccountId } = useStore();
  const [changeAccountIsOpen, setChangeAccountIsOpen] =
    useState<boolean>(false);
  const [accountId, setAccountId] = useState<number>(-1);
  const { currentSenderURL } = tabs;

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

  const handleDisconnect = () => {
    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  };

  const handleConfirm = () => {
    try {
      browser.runtime.sendMessage({
        type: 'CHANGE_CONNECTED_ACCOUNT',
        target: 'background',
        id: accountId,
        url: currentSenderURL,
      });

      browser.runtime.sendMessage({
        type: 'CLOSE_POPUP',
        target: 'background',
      });

      controller.wallet.account.updateTokensState().then(() => {
        console.log('tokens state updated after change connected account');
      });
    } catch (error) {
      alert.removeAll();
      alert.error('Error changing account. Try again.');
    }
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
              onClick={() => handleConfirm()}
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
              onClick={handleDisconnect}
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

export default ConnectedAccounts;
