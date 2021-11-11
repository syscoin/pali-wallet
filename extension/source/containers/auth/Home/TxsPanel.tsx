/* eslint-disable no-nested-ternary */
import * as React from 'react';
import { FC, Fragment, useCallback, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { Icon, IconButton, Button } from 'components/index';
import { useController, useStore, useFormat } from 'hooks/index';
import SyscoinIcon from 'assets/images/logo-s.svg';
import ActivityPanel from './ActivityPanel';

import { Transaction, Assets } from '../../../scripts/types';
import AssetsPanel from './AssetsPanel';

interface ITxsPanel {
  address: string;
  assets: Assets[];
  getTransactionAssetData: any;
  getTransactionData: any;
  openAssetBlockExplorer: any;
  openBlockExplorer: any;
  setAssetSelected: any;
  setAssetTx: any;
  setAssetType: any;
  setOpenAssetBlockExplorer: any;
  setOpenBlockExplorer: any;
  setTx: any;
  setTxType: any;
  setTxidSelected: any;
  transactions: Transaction[];
  txidSelected: any;
}

const TxsPanel: FC<ITxsPanel> = ({ transactions, assets, setOpenBlockExplorer, setTxidSelected, setAssetSelected, setOpenAssetBlockExplorer, setTxType, setAssetType, getTransactionData, setTx, setAssetTx, getTransactionAssetData }) => {
  const controller = useController();
  const [isShowed, setShowed] = useState<boolean>(false);
  const [isActivity, setActivity] = useState<boolean>(true);
  const [scrollArea, setScrollArea] = useState<HTMLElement>();

  const { changingNetwork } = useStore();
  // const { formatDistanceDate, formatCurrency } = useFormat();

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

    if (tx.tokenType === "SPTAssetUpdate") {
      return 'SPT update';
    }

    return 'Transaction';
  }

  return (
    <div className="w-full flex justify-center items-center flex-col">
      {!isShowed ? (
        <div>
          <Button
            type="button"
            onClick={() => { setActivity(false) }}
          >
            Assets
          </Button>

          <Button
            type="button"
            onClick={() => { setActivity(true) }}
          >
            Activity
          </Button>
        </div>
      ) : (
        <div >
          {isActivity ? "Activity" : "Assets"}

          <IconButton type="primary" shape="circle" onClick={handleGoTop}>
            <Icon name="vertical-align" className="w-4 bg-brand-gray200 text-brand-navy" />
          </IconButton>
        </div>
      )}

      {/* {changingNetwork && (
        <>
          <span>
            <Icon name="loading" className="w-4 bg-brand-gray200 text-brand-navy" />
          </span>
          <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
        </>
      )} */}

      {isActivity ? (
        <ActivityPanel
          show={transactions && !changingNetwork}
        />
      ) : (
        <AssetsPanel
          show={assets && !changingNetwork}
        />
      )}

    </div>
  );
};

export default TxsPanel;
