import React from 'react';
import { browser } from 'webextension-polyfill-ts';
import Button from 'components/Button';
import Header from 'containers/common/Header';
import Link from 'components/Link';

import styles from './ConnectWallet.scss';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

const ConfirmConnection = () => {
  const { accounts, connectedAccountId, connectedTo }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const handleCancelConnection = () => {
    browser.runtime.sendMessage({ type: 'RESET_CONNECTION_INFO' });
  }

  const handleConfirmConnection = () => {
    browser.runtime.sendMessage({ type: 'CONFIRM_CONNECTION' });
  }

  return (
    <div className={styles.home}>
      <Header showLogo />

      <h1>Connect with <b>Syscoin Wallet</b></h1>

      <p>2/2</p>

      <div className={styles.confirm}>
        <p>Site: {connectedTo}</p>
        <p>Connect to account {accounts[connectedAccountId].label}</p>
        <p>{accounts[connectedAccountId].address.main}</p>
      </div>

      <small>Only connect with sites you trust. <a href="#">Learn more.</a></small>

      <div className={styles.buttons}>
        <Link color="secondary" to="/app.html" onClick={handleCancelConnection}>
          <Button 
            type="submit" 
            theme="btn-outline-secondary" 
            variant={styles.cancel}>
              Cancel
          </Button>
        </Link>

        <Link color="secondary" to="/home" onClick={handleConfirmConnection}>
          <Button 
            type="submit" 
            theme="btn-outline-confirm" 
            variant={styles.next}>
              Confirm
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default ConfirmConnection;
