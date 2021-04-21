import React from 'react';
import { browser } from 'webextension-polyfill-ts';
import Button from 'components/Button';
import Header from 'containers/common/Header';

import styles from './ConnectWallet.scss';
import clsx from 'clsx';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import { useController } from 'hooks/index';

const ConfirmConnection = () => {
  const controller = useController();
  
  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const connectedAccount = accounts.filter(account => {
    return account.connectedTo.find((url: any) => {
      return url == currentSenderURL;
    });
  });

  const handleCancelConnection = () => {
    browser.runtime.sendMessage({
      type: "RESET_CONNECTION_INFO",
      target: "background",
      id: connectedAccount[0].id,
      url: currentSenderURL
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleConfirmConnection = () => {
    browser.runtime.sendMessage({ 
      type: "CONFIRM_CONNECTION",
      target: "background",
      id: connectedAccount[0].id
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  return (
    <div className={styles.home}>
      <Header showLogo />

      <h1>
        Connect with Syscoin
        <br />
        Wallet
      </h1>

      <p>2/2</p>

      <div className={styles.list}>
        <p>Site: {currentSenderURL}</p>
        <p>Connect to account {connectedAccount[0].label}</p>
        <p>{controller.wallet.formatAddress(connectedAccount[0].address.main)}</p>
      </div>

      <small>Only connect with sites you trust. Learn more.</small>

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
