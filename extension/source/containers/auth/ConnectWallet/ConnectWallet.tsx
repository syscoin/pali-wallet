import React from 'react';
import { browser } from 'webextension-polyfill-ts';
import Button from 'components/Button';
import Header from 'containers/common/Header';
import Link from 'components/Link';

import styles from './ConnectWallet.scss';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

const ConnectWallet = () => {
  const { accounts, activeAccountId, connectedTo }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const handleSelectAccount = (id: number) => {
    browser.runtime.sendMessage({ type: 'SELECT_ACCOUNT', id });
  };

  const handleCancelConnection = () => {
    browser.runtime.sendMessage({ type: 'RESET_CONNECTION_INFO' });
  }

  return (
    <div className={styles.home}>
      <Header showLogo />

      <h1>Connect with <b>Syscoin Wallet</b></h1>

      <p>1/2</p>
      
      <p>{connectedTo}</p>
      <p>Choose account(s)</p>

      <div className={styles.accounts}>
        <ul className={styles.options}>
          {accounts.map((acc: any, index: number) => (
            <li key={index} onClick={() => handleSelectAccount(index)}>
              {acc.label}
              {index === activeAccountId && <small>(active)</small>}
            </li>
          ))}
        </ul>
      </div>

      <small>Only connect with sites you trust. <a href="#">Learn more.</a></small>

      <div className={styles.buttons}>
        <Link to="/app.html" onClick={handleCancelConnection}>
          <Button 
            type="submit" 
            theme="btn-outline-secondary"
            variant={styles.cancel}>
              Cancel
          </Button>
        </Link>

        <Link to="/confirm-connection">
          <Button 
            type="submit" 
            theme="btn-gradient-primary" 
            variant={styles.next}>
              Next
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default ConnectWallet;
