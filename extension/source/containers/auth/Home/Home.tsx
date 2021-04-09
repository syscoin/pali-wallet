import React, { useState } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';
import CircularProgress from '@material-ui/core/CircularProgress';
import IconButton from '@material-ui/core/IconButton';
import RefreshIcon from '@material-ui/icons/Refresh';

import Header from 'containers/common/Header';
import Button from 'components/Button';
import FullSelect from 'components/FullSelect';
import Modal from 'components/Modal';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import TxsPanel from './TxsPanel';

import styles from './Home.scss';
import { formatNumber } from '../helpers';

const Home = () => {
  const controller = useController();
  const getFiatAmount = useFiat();
  const { accounts, activeAccountId, currentURL, connectedTo }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [isOpenModal, setIsOpenModal] = useState(false);
  const isConnected = currentURL == connectedTo;

  const handleRefresh = () => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool();
    controller.stateUpdater();
  };

  return (
    <div className={styles.wrapper}>
      {isOpenModal && (
        <div className={styles.background} onClick={() => setIsOpenModal(false)}></div>
      )}

      {accounts[activeAccountId] ? (
        <>
          <Header showLogo />
          <section className={styles.account}>
            {accounts.length > 1 ? (
              <FullSelect
                value={String(activeAccountId)}
                options={accounts}
                onChange={(val: string) => {
                  controller.wallet.switchWallet(Number(val));
                  controller.wallet.account.watchMemPool();
                }}
              />
            ) : (
              accounts[activeAccountId].label
            )}
          </section>
          <section className={styles.center}>
            {(isConnected) 
              ? <small className={styles.connected} onClick={() => setIsOpenModal(!isOpenModal)}>Connected</small> 
              : <small className={styles.connected} onClick={() => setIsOpenModal(!isOpenModal)}>Not connected</small>}

            {isOpenModal && (isConnected) && (
              <Modal title={currentURL} connected />
            )}

            {isOpenModal && (!isConnected) && (
              <Modal title={currentURL} message="Syscoin Wallet is not connected this site. To connect to a web3 site, find the connect button on their site." />
            )}

            <h3>
              {formatNumber(accounts[activeAccountId].balance)}{' '}
              <small>SYS</small>
            </h3>
            <small>≈ {getFiatAmount(accounts[activeAccountId].balance)}</small>
            <IconButton className={styles.refresh} onClick={handleRefresh}>
              <RefreshIcon />
            </IconButton>
            <div className={styles.actions}>
              <Button
                type="button"
                theme="btn-outline-secondary"
                variant={styles.button}
                linkTo="/send"
              >
                Send
              </Button>
              <Button
                type="button"
                theme="btn-outline-primary"
                variant={styles.button}
                linkTo="/receive"
              >
                Receive
              </Button>
            </div>
          </section>
          <TxsPanel
            address={accounts[activeAccountId].address.main}
            transactions={accounts[activeAccountId].transactions}
          />
        </>
      ) : (
        <section
          className={clsx(styles.mask, {
            [styles.hide]: accounts[activeAccountId],
          })}
        >
          <CircularProgress className={styles.loader} />
        </section>
      )}
    </div>
  );
};

export default Home;
