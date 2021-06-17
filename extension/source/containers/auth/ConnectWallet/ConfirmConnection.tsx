import React from 'react';
import { browser } from 'webextension-polyfill-ts';
import Button from 'components/Button';
import Header from 'containers/common/Header';

import styles from './ConnectWallet.scss';
import clsx from 'clsx';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import { ellipsis } from '../helpers';
import { getHost } from '../../../scripts/Background/helpers';
import { useAlert } from 'react-alert';

const ConfirmConnection = () => {
  const alert = useAlert();
  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const connectedAccount = accounts.filter(account => {
    return account.connectedTo.find((url: any) => {
      return url == getHost(currentSenderURL);
    });
  });

  const handleCancelConnection = () => {
    browser.runtime.sendMessage({
      type: "RESET_CONNECTION_INFO",
      target: "background",
      id: connectedAccount[0].id,
      url: currentSenderURL
    }).then(() => {
      browser.runtime.sendMessage({
        type: "CLOSE_POPUP",
        target: "background"
      });
    });
  }

  const handleConfirmConnection = () => {
    try {
      browser.runtime.sendMessage({
        type: "CONFIRM_CONNECTION",
        target: "background"
      }).then(() => {
        browser.runtime.sendMessage({
          type: "CLOSE_POPUP",
          target: "background"
        });

        return true;
      });

      return true;
    } catch (error) {
      alert.removeAll();
      alert.error('Sorry, an internal error has occurred.');

      return false;
    }
  }

  return (
    <div className={styles.wrapper}>
      <Header showLogo />

      <h1>Connect with <b>Pali Wallet</b></h1>

      <p>2/2</p>

      <div className={styles.list}>
        <p>Site: {currentSenderURL}</p>
        <p>Connect to account {connectedAccount[0].label}</p>
        <p>{ellipsis(connectedAccount[0].address.main)}</p>
      </div>

      <small>Only connect with sites you trust. <a href="#">Learn more.</a></small>

      <div className={styles.actions}>
        <Button
          type="button"
          theme="btn-outline-secondary"
          variant={clsx(styles.button, styles.cancel)}
          onClick={handleCancelConnection}
          linkTo="/app.html"
          fullWidth
        >
          Cancel
        </Button>

        <Button
          type="button"
          theme="btn-outline-secondary"
          variant={styles.button}
          linkTo="/home"
          onClick={handleConfirmConnection}
          fullWidth
        >
          Confirm
        </Button>
      </div>
    </div>
  );
};

export default ConfirmConnection;
