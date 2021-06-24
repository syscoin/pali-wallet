import * as React from 'react';
import { FC, Fragment, useCallback, useState, useEffect } from 'react';
import clsx from 'clsx';
import { v4 as uuid } from 'uuid';
import UpArrowIcon from '@material-ui/icons/ArrowUpward';
import GoTopIcon from '@material-ui/icons/VerticalAlignTop';
import IconButton from '@material-ui/core/IconButton';
import Spinner from '@material-ui/core/CircularProgress';
import Button from 'components/Button';

import { useController } from 'hooks/index';
import { formatDistanceDate } from '../helpers';
import SyscoinIcon from 'assets/images/logosys.svg';
import { Transaction, Assets } from '../../../scripts/types';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';

import styles from './Home.scss';
import ModalBlock from 'components/ModalBlock';

interface ITxsPanel {
  txidSelected: any;
  setTxidSelected: any;
  openBlockExplorer: any;
  setOpenBlockExplorer: any;
  address: string;
  transactions: Transaction[];
  assets: Assets[];
}

const TxsPanel: FC<ITxsPanel> = ({ transactions, assets, openBlockExplorer, setOpenBlockExplorer, txidSelected, setTxidSelected }) => {
  const controller = useController();
  const [isShowed, setShowed] = useState<boolean>(false);
  const [isActivity, setActivity] = useState<boolean>(true);
  const [scrollArea, setScrollArea] = useState<HTMLElement>();
  // const [txidSelected, setTxidSelected] = useState('');
  const sysExplorer = controller.wallet.account.getSysExplorerSearch();

  const { changingNetwork }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  
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

  const TokenTypeGroupBar = useCallback(
    (asset: Assets, idx: number) => {
      return (
        idx === 0 || controller.wallet.account.isNFT(asset.assetGuid) !==
        controller.wallet.account.isNFT(assets[idx - 1].assetGuid)
      );
    },
    [assets]
  );

  const handleFetchMoreTxs = () => {
    if (transactions.length) {
      controller.wallet.account.updateTxs();
    }
  };

  const handleScroll = useCallback((event) => {
    event.persist();

    if (event.target.scrollTop) setShowed(true);

    setScrollArea(event.target);

    const scrollOffset = event.target.scrollHeight - event.target.scrollTop;

    if (scrollOffset === event.target.clientHeight) {
      if (!changingNetwork) {
        handleFetchMoreTxs();
      }
    }
  }, []);

  // const handleOpenExplorer = (txid: string) => {
  //   window.open(sysExplorer + '/tx/' + txid);
  // };

  const handleOpenAssetExplorer = (txid: number) => {
    window.open(sysExplorer + '/asset/' + txid);
  };

  const handleGoTop = () => {
    scrollArea!.scrollTo({ top: 0, behavior: 'smooth' });
    setShowed(false);
  };

  const getTxType = (tx: Transaction) => {
    if (tx.tokenType === "SPTAssetActivate") {
      return 'SPT creation';
    }

    if (tx.tokenType === "SPTAssetSend") {
      return 'SPT mint';
    }

    return 'Transaction';
  }

  return (
    <section
      className={clsx(styles.activity, { [styles.expanded]: isShowed })}
      onScroll={handleScroll}
    >
      {!!(!isShowed) ?
        <div className={styles.wrapper}>
          <div className={styles.center}>
            <Button
              type="button"
              theme={isActivity ? "btn-rectangle-primary" : "btn-rectangle-selected"}
              variant={styles.button}
              onClick={() => { setActivity(false) }}
            >
              Assets
            </Button>

            <Button
              type="button"
              theme={isActivity ? "btn-rectangle-selected" : "btn-rectangle-primary"}
              variant={styles.button}
              onClick={() => { setActivity(true) }}
            >
              Activity
            </Button>
          </div>
        </div>
        :
        <div className={styles.heading}>
          {isActivity ? "Activity" : "Assets"}
          <IconButton className={styles.goTop} onClick={handleGoTop}>
            <GoTopIcon />
          </IconButton>
        </div>
      }

      {changingNetwork && (
        <>
          <span className={styles.noTxComment}>
            <Spinner size={25} className={styles.spinner} />
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
      
      {/* {openBlockExplorer && (
        <div className={styles.backgroundModalBlock} onClick={() => setOpenBlockExplorer(false)}></div>
      )} */}

      {/* {openBlockExplorer && <ModalBlock title="Open block explorer" message="Go to view transaction in Sys Block Explorer" setCallback={() => setOpenBlockExplorer(false)} callback={() => handleOpenExplorer(txidSelected)} />} */}

      {isActivity ?
        transactions.length && !changingNetwork ? (
          <>
            <ul>
              {transactions.map((tx: Transaction, idx: number) => {
                const isConfirmed = tx.confirmations > 0;

                return (
                  <Fragment key={uuid()}>
                    {isShowedGroupBar(tx, idx) && (
                      <li className={styles.groupbar}>
                        {formatDistanceDate(new Date(tx.blockTime * 1000).toDateString())}
                      </li>
                    )}
                    <li
                      className={styles.transactionItem}
                      onClick={() => {
                        setOpenBlockExplorer(true);
                        setTxidSelected(tx.txid);
                      }}>
                      <div>
                        {isConfirmed ? null : <Spinner size={25} className={styles.spinner} />}
                      </div>
                      <div>
                        <span title="Click here to go to view transaction in sys block explorer">
                          <span>
                            {new Date(tx.blockTime * 1000).toLocaleTimeString(navigator.language, {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <small>{tx.txid}</small>
                          <small>{isConfirmed ? "Confirmed" : "Unconfirmed"}</small>
                          <small>{getTxType(tx)}</small>
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
          </>
        ) : (
          <>
            <span className={styles.noTxComment}>
              You have no transaction history, send or receive SYS to register
              your first transaction.
            </span>

            {!changingNetwork && (
              <img
                src={SyscoinIcon}
                className={styles.syscoin}
                alt="syscoin"
                height="167"
                width="auto"
              />
            )}
          </>
        ) : assets.length && !changingNetwork ?
          <>
            <ul>
              {assets.map((asset: Assets, idx: number) => {
                if (asset.assetGuid !== undefined) {
                  return (
                    <Fragment key={uuid()}>
                      {TokenTypeGroupBar(asset, idx) && (
                        <div className={styles.groupbar}>
                          {controller.wallet.account.isNFT(asset.assetGuid) ? "NFT" : "SPT"}
                        </div>
                      )}
                      <div className={styles.assetItem} onClick={() => handleOpenAssetExplorer(asset.assetGuid)}>
                        <div>
                          <span title="Click here to go to view transaction in sys block explorer">
                            <span>{controller.wallet.account.isNFT(asset.assetGuid) ? asset.balance : (asset.balance / 10 ** asset.decimals).toFixed(2)}  {asset.symbol} </span>
                          </span>
                          <div className={styles.linkIcon}>
                            <UpArrowIcon />
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  );
                }
                return
              })}
            </ul>
          </>
          :
          <>
            <span className={styles.noTxComment}>
              You have no Assets, receive SPTs to register.
            </span>

            {!changingNetwork && (
              <img
                src={SyscoinIcon}
                className={styles.syscoin}
                alt="syscoin"
                height="167"
                width="auto"
              />
            )}
          </>

      }
    </section>
  );
};

export default TxsPanel;
