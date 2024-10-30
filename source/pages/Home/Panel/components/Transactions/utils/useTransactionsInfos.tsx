import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';
import { ITransactionsListConfig } from 'types/useTransactionsInfo';

export const useTransactionsListConfig = (
  userTransactions?: any[]
): ITransactionsListConfig => {
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);

  const { t } = useTranslation();

  const txId = isBitcoinBased ? 'txId' : 'hash';
  const blocktime = isBitcoinBased ? 'blockTime' : 'timestamp';

  const getTxType = (tx: any, isTxSent: boolean) => {
    if (isBitcoinBased) {
      return 'Transaction';
    }

    const txLabel = isTxSent ? 'Sent' : 'Received';

    return `${txLabel}`;
  };

  const getTxStatusIcons = (txLabel: string, isDetail: boolean) => {
    let icon = '';

    switch (txLabel) {
      case 'Sent':
        icon = '/assets/icons/ArrowUp.svg';
        break;
      case 'Received':
        icon = '/assets/icons/receivedArrow.svg';
        break;
    }

    return (
      <>
        {isDetail ? (
          <div className="relative w-[50px] h-[50px] bg-brand-pink200 rounded-[100px] flex items-center justify-center mb-2">
            <img className="relative w-[30px] h-[30px]" src={icon} alt="Icon" />
          </div>
        ) : (
          <div className="relative w-[36px] h-[36px] bg-brand-whiteAlpaBlue rounded-[100px] mr-2 flex items-center justify-center">
            <img className="relative" src={icon} alt="Icon" />
          </div>
        )}
      </>
    );
  };

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

  const formatTimeStampUtxo = (timestamp: number) => {
    const date = new Date(timestamp);

    const dateFormatOptions: Intl.DateTimeFormatOptions = {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    };

    const timeFormatOptions: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    };

    const formattedDate = new Intl.DateTimeFormat(
      'en-US',
      dateFormatOptions
    ).format(date);
    const formattedTime = new Intl.DateTimeFormat(
      'en-US',
      timeFormatOptions
    ).format(date);

    const dateComponents = formattedDate.split('/');
    const formattedDateWithHyphen = dateComponents.join('-');

    return (
      <div className="flex gap-2">
        <p className="text-xs text-brand-gray200">{formattedDateWithHyphen}</p>
        <p className="text-xs text-white">{formattedTime}</p>
      </div>
    );
  };

  const getTokenSymbol = (isErc20Tx: boolean, coinsList: any[], tx: any) => {
    if (isErc20Tx) {
      const token = coinsList.find((coin) =>
        Object.values(coin?.platforms || {})
          ?.map((item) => `${item}`.toLocaleLowerCase())
          ?.includes(`${tx?.to}`.toLocaleLowerCase())
      );

      if (token) {
        return `${token?.symbol}`.toUpperCase();
      }

      return '';
    }

    return '';
  };

  return useMemo(
    () => ({
      getTxStatus,
      getTxStatusIcons,
      formatTimeStamp,
      formatTimeStampUtxo,
      filteredTransactions,
      isShowedGroupBar,
      txId,
      getTxType,
      blocktime,
      getTokenSymbol,
    }),
    [
      getTxStatus,
      getTxStatusIcons,
      formatTimeStamp,
      formatTimeStampUtxo,
      filteredTransactions,
      isShowedGroupBar,
      txId,
      getTxType,
      blocktime,
      getTokenSymbol,
    ]
  );
};
