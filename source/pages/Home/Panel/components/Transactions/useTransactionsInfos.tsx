import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { TransactionOptions } from 'components/TransactionOptions';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { handleUpdateTransaction } from 'utils/index';

interface ITransactionsListConfig {
  currentAccount: any;
  filteredTransactions: any;
  getTxOptions: any;
  getTxStatus: any;
  getTxType: any;
  isShowedGroupBar: any;
  txid: any;
}

export const useTransactionsListConfig = (
  userTransactions?: any[]
): ITransactionsListConfig => {
  const { wallet } = getController();
  const { t } = useTranslation();
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
    activeAccount,
    accounts,
  } = useSelector((state: RootState) => state.vault);

  const [modalData, setModalData] = useState<{
    buttonText: string;
    description: string;
    onClick: () => void;
    onClose: () => void;
    title: string;
  }>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);

  const currentAccount = accounts[activeAccount.type][activeAccount.id];

  const { alert } = useUtils();

  const getTxType = (tx: any, isTxSent: boolean) => {
    if (isBitcoinBased) {
      if (tx.tokenType === 'SPTAssetActivate') {
        return 'SPT creation';
      }

      if (tx.tokenType === 'SPTAssetSend') {
        return 'SPT mint';
      }

      if (tx.tokenType === 'SPTAssetUpdate') {
        return 'SPT update';
      }

      return 'Transaction';
    }

    const txLabel = isTxSent ? 'Sent' : 'Received';

    return `${txLabel}`;
  };

  const txid = isBitcoinBased ? 'txid' : 'hash';
  const blocktime = isBitcoinBased ? 'blockTime' : 'timestamp';

  const isShowedGroupBar = useCallback(
    (tx: any, idx: number) =>
      tx === null &&
      tx === undefined &&
      userTransactions[idx - 1] === undefined &&
      userTransactions[idx - 1] === null &&
      (idx === 0 ||
        new Date(tx[blocktime] * 1e3).toDateString() !==
          new Date(userTransactions[idx - 1][blocktime] * 1e3).toDateString()),
    [userTransactions]
  );

  const filteredTransactions = useMemo(() => {
    if (!Array.isArray(userTransactions)) {
      return [];
    }

    return userTransactions
      .filter((item: any) => {
        if (!isBitcoinBased) {
          return item?.chainId === chainId;
        }
        return item !== undefined && item !== null;
      })
      .sort((a: any, b: any) => {
        if (a[blocktime] > b[blocktime]) {
          return -1;
        }
        if (a[blocktime] < b[blocktime]) {
          return 1;
        }
        return 0;
      });
  }, [userTransactions, isBitcoinBased, chainId, blocktime]);

  const getTxStatus = useCallback(
    (isCanceled: boolean, isConfirmed: boolean) => {
      let className = '';
      let status = '';

      switch (isCanceled) {
        case true:
          className = 'text-warning-error';
          status = t('send.canceled');
          break;
        case false:
          className = isConfirmed ? 'text-warning-success' : 'text-yellow-300';
          status = isConfirmed ? t('send.confirmed') : t('send.pending');
          break;
      }

      return <p className={className}>{status}</p>;
    },
    [userTransactions]
  );

  const getTxOptions = (isCanceled: boolean, isConfirmed: boolean, tx: any) => {
    if (!isCanceled && !isConfirmed) {
      return (
        <TransactionOptions
          handleUpdateTransaction={handleUpdateTransaction}
          alert={alert}
          chainId={chainId}
          wallet={wallet}
          transaction={tx}
          setIsOpenModal={setIsOpenModal}
          setModalData={setModalData}
        />
      );
    }
  };

  return {
    getTxOptions,
    getTxStatus,
    filteredTransactions,
    isShowedGroupBar,
    txid,
    getTxType,
    currentAccount,
  };
};
