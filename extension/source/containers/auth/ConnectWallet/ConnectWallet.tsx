import React, { useState } from 'react';
import { browser } from 'webextension-polyfill-ts';
import Header from 'containers/common/Header';
import Button from 'components/Button';
import checkGreen from 'assets/images/svg/check-green.svg';
import { ellipsis } from 'containers/auth/helpers';
import Spinner from '@material-ui/core/CircularProgress';

import styles from './ConnectWallet.scss';
import clsx from 'clsx';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

const ConnectWallet = () => {
  const { accounts, activeAccountId, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [accountId, setAccountId] = useState<number>(-1);

  const handleSelectAccount = (id: number) => {
    setAccountId(id);

    browser.runtime.sendMessage({
      type: "SELECT_ACCOUNT",
      target: "background",
      id
    });
  };

  const handleCancelConnection = () => {
    browser.runtime.sendMessage({
      type: "RESET_CONNECTION_INFO",
      target: "background",
      id: accountId,
      url: currentSenderURL
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  return (
    <div className={styles.wrapper}>
      <Header showLogo />

      <h1>Connect with <b>Pali Wallet</b></h1>

      <p>1/2</p>
      <p>{currentSenderURL}</p>
      <p>Choose account</p>

      {accounts.length > 0 ? (
        <ul className={styles.list}>
          {accounts.map((acc: any) => (
            <li key={acc.id} onClick={() => handleSelectAccount(acc.id)} className={styles.account}>
              <div className={styles.label}>
                <p>{acc.label} {acc.id === activeAccountId && <small>(active)</small>}</p>
                <small>{ellipsis(acc.address.main)}</small>
              </div>

              {acc.id === accountId && <img src={checkGreen} alt="check" />}

            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.loading}>
          <Spinner />
        </div>
      )}

      <small>Only connect with sites you trust. <a href="#">Learn more.</a></small>

      <div className={styles.actions}>
        <Button
          type="button"
          theme="btn-outline-secondary"
          variant={clsx(styles.button, styles.cancel)}
          onClick={handleCancelConnection}
          linkTo="/app.html"
        >
          Cancel
        </Button>

        <Button
          type="button"
          theme="btn-outline-secondary"
          variant={styles.button}
          disabled={accountId === -1}
          linkTo="/confirm-connection"
        >
          Next
        </Button>
      </div>
    </div>
  );
};

export default ConnectWallet;
