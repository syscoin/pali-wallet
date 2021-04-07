import React, { FC, Fragment, useCallback, useState } from 'react';
import clsx from 'clsx';
import { v4 as uuid } from 'uuid';
// import { useFiat } from 'hooks/usePrice';
import UpArrowIcon from '@material-ui/icons/ArrowUpward';
// import DownArrowIcon from '@material-ui/icons/ArrowDownward';
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

const TxsPanel: FC<ITxsPanel> = ({ transactions }) => {
  // const getFiatAmount = useFiat();
  const controller = useController();
  const [isShowed, setShowed] = useState<boolean>(false);
  const [scrollArea, setScrollArea] = useState<HTMLElement>();

  const isShowedGroupBar = useCallback(
    (tx: Transaction, idx: number) => {
      return (
        idx === 0 ||
        new Date(tx.blockTime * 1e3).toDateString() !==
        new Date(transactions[idx - 1].blockTime * 1e3).toDateString()
      );
    },
    [transactions]
  );

  const handleFetchMoreTxs = () => {
    if (transactions.length) {
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

  const handleOpenExplorer = (txid: string) => {
    window.open(SYS_EXPLORER_SEARCH + '/tx/' + txid);
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
              // const isRecived = tx.receiver === address;
              const isConfirmed = tx.confirmations > 0;

              return (
                <Fragment key={uuid()}>
                  {isShowedGroupBar(tx, idx) && (
                    <li className={styles.groupbar}>
                      {formatDistanceDate(new Date(tx.blockTime * 1000).toDateString())}
                    </li>
                  )}
                  <li onClick={() => handleOpenExplorer(tx.txid)}>
                    {/* <div>
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
                    </div> */}
                    <div>
                      {isConfirmed ? null : <Spinner size={25} className={styles.spinner} />}
                    </div>
                    <div>
                      <span>
                        <span>
                          {new Date(tx.blockTime * 1000).toLocaleTimeString(navigator.language, {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        <small>{tx.txid}</small>
                        <small>{isConfirmed ? "Confirmed" : "Unconfirmed"}</small>
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
            {/* <img
              src={SyscoinIcon}
              alt="syscoin"
              height="167"
              width="auto"
            /> */}
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
