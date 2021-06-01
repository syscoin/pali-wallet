import React, { useEffect, useState } from 'react';
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
import IAccountState from 'state/wallet/types';
import TxsPanel from './TxsPanel';

import styles from './Home.scss';
import { formatNumber } from '../helpers';

const Home = () => {
  const controller = useController();
  const getFiatAmount = useFiat();
  const { accounts, activeAccountId, currentURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const handleRefresh = () => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool();
    controller.stateUpdater();
  };

  useEffect(() => {
    if (!controller.wallet.isLocked() && accounts.length > 0 && accounts.find(element => element.id === activeAccountId)) {
      handleRefresh();
    }
  }, [
    !controller.wallet.isLocked(),
    accounts.length > 0
  ]);

  useEffect(() => {
    let acc = accounts.find(element => element.id === activeAccountId)
    if (acc && acc.connectedTo !== undefined) {
      if (acc.connectedTo.length > 0) {
        setIsConnected(acc.connectedTo.findIndex((url: any) => {
          return url == currentURL;
        }) > -1);

        return;
      }

      setIsConnected(false);
    }
  }, [
    accounts,
    activeAccountId,
    currentURL
  ]);

  return (
    <div className={styles.wrapper}>
      {isOpenModal && (
        <div className={styles.background} onClick={() => setIsOpenModal(false)}></div>
      )}

      {accounts.find(element => element.id === activeAccountId) ? (
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
              accounts.find(element => element.id === activeAccountId)?.label
            )}
          </section>
          <section className={styles.center}>
            {isConnected
              ? <small className={styles.connected} onClick={() => setIsOpenModal(!isOpenModal)}>Connected</small>
              : <small className={styles.connected} onClick={() => setIsOpenModal(!isOpenModal)}>Not connected</small>
            }

            {isOpenModal && isConnected && (
              <Modal title={currentURL} connected />
            )}

            {isOpenModal && (!isConnected) && (
              <Modal title={currentURL} message="This account is not connected this site. To connect to a web3 site, find the connect button on their site." />
            )}

            <h3>
              {formatNumber(accounts.find(element => element.id === activeAccountId)?.balance || 0)}{' '}
              <small>SYS</small>
            </h3>
            <small>{getFiatAmount(accounts.find(element => element.id === activeAccountId)?.balance || 0)}</small>
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
            address={accounts.find(element => element.id === activeAccountId)?.address.main || 'no addr'}
            transactions={accounts.find(element => element.id === activeAccountId)?.transactions || []}
            assets={accounts.find(element => element.id === activeAccountId)?.assets || []}
          />
        </>
      ) : (
        <section
          className={clsx(styles.mask, {
            [styles.hide]: accounts.find(element => element.id === activeAccountId),
          })}
        >
          <CircularProgress className={styles.loader} />
        </section>
      )}
    </div>
  );
};

export default Home;
