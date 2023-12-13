import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { TransactionOptions } from 'components/TransactionOptions';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import {
  ITransactionsListConfig,
  modalDataType,
} from 'types/useTransactionsInfo';
import { getController } from 'utils/browser';
import { handleUpdateTransaction } from 'utils/index';

export const useTransactionsListConfig = (
  userTransactions?: any[]
): ITransactionsListConfig => {
  const { wallet } = getController();

  const { t } = useTranslation();
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);

  const [modalData, setModalData] = useState<modalDataType>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);

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

  const getTxStatusIcons = (txLabel: string) => {
    let icon = '';

    switch (txLabel) {
      case 'Sent':
        icon = '/assets/icons/ArrowUp.svg';
        break;
      case 'Received':
        icon = '/assets/icons/receivedArrow.svg';
        break;
    }

    return <img className="absolute top-[7px] left-[9px]" src={icon} />;
  };

  const txId = isBitcoinBased ? 'txId' : 'hash';
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
          className = 'text-brand-redDark';
          status = t('send.canceled');
          break;
        case false:
          className = isConfirmed ? 'text-brand-green' : 'text-brand-orange';
          status = isConfirmed ? t('send.confirmed') : t('send.pending');
          break;
      }

      return <p className={`text-xs font-normal ${className}`}>{status}</p>;
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

  const formatTimeStamp = (timestamp: number) => {
    const data = new Date(timestamp * 1000);

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    };

    const formatedData = new Intl.DateTimeFormat('en-US', options).format(data);

    return formatedData;
  };

  return {
    getTxOptions,
    getTxStatus,
    getTxStatusIcons,
    isOpenModal,
    modalData,
    formatTimeStamp,
    filteredTransactions,
    isShowedGroupBar,
    txId,
    getTxType,
    blocktime,
  };
};
