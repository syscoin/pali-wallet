import React, { useState } from 'react';
import { browser } from 'webextension-polyfill-ts';
import Button from 'components/Button';
import Header from 'containers/common/Header';
import checkGreen from 'assets/images/svg/check-green.svg';
import clsx from 'clsx';
import { ellipsis } from 'containers/auth/helpers';
import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import { useAlert } from 'react-alert';

import { getHost } from '../../../scripts/Background/helpers';

import styles from './ConnectWallet.scss';

const ConnectedAccounts = () => {
  const alert = useAlert();
  const { accounts, currentSenderURL, activeAccountId }: IWalletState =
    useSelector((state: RootState) => state.wallet);
  const [changeAccountIsOpen, setChangeAccountIsOpen] =
    useState<boolean>(false);
  const [accountId, setAccountId] = useState<number>(-1);

  const handleChangeAccount = (id: number) => {
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
    } catch (error) {
      alert.removeAll();
      alert.error('Error changing account. Try again.');
    }
  };

  const connectedAccount = accounts.filter((account) => {
    return account.connectedTo.find((url: any) => {
      return url == getHost(currentSenderURL);
    });
  });

  return (
    <div className={styles.wrapper}>
      <Header showLogo />

      {changeAccountIsOpen ? (
        <div className={styles.list}>
          <p className={styles.connectedTitle}>Choose your account</p>

          <ul className={styles.listAccounts}>
            {accounts.map((account) => {
              return (
                <li
                  key={account.id}
                  className={styles.account}
                  onClick={() => handleChangeAccount(account.id)}
                >
                  <div className={styles.label}>
                    <p>{account.label}</p>
                    <small>{ellipsis(account.address.main)}</small>
                  </div>
                  {account.id === activeAccountId && <small>(active)</small>}
                  {account.id === accountId && (
                    <img src={checkGreen} alt="check" />
                  )}
                </li>
              );
            })}
          </ul>

          <div className={styles.actions}>
            <Button
              type="button"
              theme="btn-outline-secondary"
              variant={clsx(styles.button, styles.cancel)}
              onClick={() => setChangeAccountIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              theme="btn-outline-confirm"
              variant={styles.button}
              disabled={accountId === -1}
              onClick={() => handleConfirm()}
            >
              Confirm
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          <div className={styles.connectedTitle}>
            <p>
              This account is connected to
              <br />
              {getHost(currentSenderURL)}
            </p>
            <small>
              To change your connected account you need to have more than one
              account.
            </small>
          </div>

          <div className={styles.account}>
            <div className={styles.label}>
              <p>{connectedAccount[0].label}</p>
              <small>{ellipsis(connectedAccount[0].address.main)}</small>
            </div>
          </div>

          <div className={styles.actions}>
            <Button
              type="button"
              theme="btn-outline-secondary"
              variant={clsx(styles.button, styles.cancel)}
              onClick={handleDisconnect}
              fullWidth
            >
              Close
            </Button>

            <Button
              type="button"
              theme="btn-outline-secondary"
              variant={styles.button}
              disabled={accounts.length === 1}
              onClick={() => setChangeAccountIsOpen(!changeAccountIsOpen)}
              fullWidth
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
