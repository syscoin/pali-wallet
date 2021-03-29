import React, { FC, Fragment, useCallback, useState } from 'react';
import clsx from 'clsx';
import { v4 as uuid } from 'uuid';
import { useFiat } from 'hooks/usePrice';
import UpArrowIcon from '@material-ui/icons/ArrowUpward';
import DownArrowIcon from '@material-ui/icons/ArrowDownward';
import GoTopIcon from '@material-ui/icons/VerticalAlignTop';
import IconButton from '@material-ui/core/IconButton';
import Spinner from '@material-ui/core/CircularProgress';

import { useController } from 'hooks/index';
import { formatDistanceDate } from '../helpers';
import SyscoinIcon from 'assets/images/logosys.svg';
import { SYS_EXPLORER_SEARCH } from 'constants/index';
import { Transaction } from '../../../scripts/types';

import styles from './Home.scss';

interface ITxsPanel {
  address: string;
  transactions: Transaction[];
}

const TxsPanel: FC<ITxsPanel> = ({ address, transactions }) => {
  const getFiatAmount = useFiat();
  const controller = useController();
  const [isShowed, setShowed] = useState<boolean>(false);
  const [scrollArea, setScrollArea] = useState<HTMLElement>();

  const isShowedGroupBar = useCallback(
    (tx: Transaction, idx: number) => {
      return (
        idx === 0 ||
        new Date(tx.timestamp).toDateString() !==
          new Date(transactions[idx - 1].timestamp).toDateString()
      );
    },
    [transactions]
  );

  const handleFetchMoreTxs = () => {
    if (transactions.length) {
      const lastTx = [...transactions].pop();
      console.log('last tx', lastTx);
      controller.wallet.account.updateTxs();
    }
  };

  const handleScroll = useCallback((ev) => {
    ev.persist();
    if (ev.target.scrollTop) setShowed(true);
    setScrollArea(ev.target);
    const scrollOffset = ev.target.scrollHeight - ev.target.scrollTop;
    if (scrollOffset === ev.target.clientHeight) {
      handleFetchMoreTxs();
    }
  }, []);

  const handleOpenExplorer = (/* tx: string */) => {
    window.open(SYS_EXPLORER_SEARCH, '_blank');
  };

  const handleGoTop = () => {
    scrollArea!.scrollTo({ top: 0, behavior: 'smooth' });
    setShowed(false);
  };

  return (
    <section
      className={clsx(styles.activity, { [styles.expanded]: isShowed })}
      onScroll={handleScroll}
    >
      <div className={styles.heading}>
        Activity
        {!!isShowed && (
          <IconButton className={styles.goTop} onClick={handleGoTop}>
            <GoTopIcon />
          </IconButton>
        )}
      </div>
      {transactions.length ? (
        <>
          <ul>
            {transactions.map((tx: Transaction, idx: number) => {
              const isRecived = tx.receiver === address;

              return (
                <Fragment key={uuid()}>
                  {isShowedGroupBar(tx, idx) && (
                    <li className={styles.groupbar}>
                      {formatDistanceDate(tx.timestamp)}
                    </li>
                  )}
                  <li onClick={() => handleOpenExplorer(/* tx.hash */)}>
                    <div>
                      <div className={styles.iconWrapper}>
                        {tx.checkpointBlock ? (
                          isRecived ? (
                            <DownArrowIcon />
                          ) : (
                            <UpArrowIcon />
                          )
                        ) : (
                          <Spinner size={16} className={styles.spinner} />
                        )}
                      </div>
                      <span>
                        {isRecived ? 'Received' : 'Sent'}
                        <small>
                          {isRecived
                            ? `From: ${tx.sender}`
                            : `To: ${tx.receiver}`}
                        </small>
                      </span>
                    </div>
                    <div>
                      <span>
                        <span>
                          {tx.amount / 1e8} <b>SYS</b>
                        </span>
                        <small>{getFiatAmount(tx.amount / 1e8, 8)}</small>
                      </span>
                      <div className={styles.linkIcon}>
                        <UpArrowIcon />
                      </div>
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ul>
          <div className={styles.syscoin}>
            <img
              src={SyscoinIcon}
              alt="syscoin"
              height="167"
              width="auto"
            />
          </div>
        </>
      ) : (
        <>
          <span className={styles.noTxComment}>
            You have no transaction history, send or receive SYS to register
            your first transaction.
          </span>
          <img
            src={SyscoinIcon}
            className={styles.syscoin}
            alt="syscoin"
            height="167"
            width="auto"
          />
        </>
      )}
    </section>
  );
};

export default TxsPanel;
