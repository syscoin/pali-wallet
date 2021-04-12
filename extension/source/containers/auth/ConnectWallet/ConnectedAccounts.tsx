import React from 'react';
import { browser } from 'webextension-polyfill-ts';
import Button from 'components/Button';
import Header from 'containers/common/Header';
import Link from 'components/Link';

import styles from './ConnectWallet.scss';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

const ConnectedAccounts = () => {
  const { accounts, activeAccountId, connectedTo, connectedAccountId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  return (
    <div className={styles.home}>
      <Header showLogo />

      <h1>
        Connected account to
        <br />
        {connectedTo}
      </h1>

      <p>{accounts[connectedAccountId].label}</p>
    </div>
  );
};

export default ConnectedAccounts;
