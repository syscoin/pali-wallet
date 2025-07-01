import React, { useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ArrowUpSvg, ReceivedArrowSvg } from 'components/Icon/Icon';
import { RootState } from 'state/store';
import { ITransactionsListConfig } from 'types/useTransactionsInfo';

// Memoize transaction status icons using centralized SVG components
const SentIcon = memo(({ isDetail }: { isDetail: boolean }) => (
  <>
    {isDetail ? (
      <div className="relative w-[50px] h-[50px] bg-brand-pink200 rounded-[100px] flex items-center justify-center mb-2">
        <ArrowUpSvg className="relative w-[30px] h-[30px]" />
      </div>
    ) : (
      <div className="relative w-[36px] h-[36px] bg-brand-whiteAlpaBlue rounded-[100px] mr-2 flex items-center justify-center">
        <ArrowUpSvg className="relative" />
      </div>
    )}
  </>
));
SentIcon.displayName = 'SentIcon';

const ReceivedIcon = memo(({ isDetail }: { isDetail: boolean }) => (
  <>
    {isDetail ? (
      <div className="relative w-[50px] h-[50px] bg-brand-pink200 rounded-[100px] flex items-center justify-center mb-2">
        <ReceivedArrowSvg className="relative w-[30px] h-[30px]" />
      </div>
    ) : (
      <div className="relative w-[36px] h-[36px] bg-brand-whiteAlpaBlue rounded-[100px] mr-2 flex items-center justify-center">
        <ReceivedArrowSvg className="relative" />
      </div>
    )}
  </>
));
ReceivedIcon.displayName = 'ReceivedIcon';

export const useTransactionsListConfig = (
  userTransactions?: any[]
): ITransactionsListConfig => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const chainId = activeNetwork.chainId;

  const { t } = useTranslation();

  const txId = isBitcoinBased ? 'txId' : 'hash';
  const blocktime = isBitcoinBased ? 'blockTime' : 'timestamp';

  const getTxType = useCallback(
    (tx: any, isTxSent: boolean) => {
      if (isBitcoinBased) {
        // Syscoin 5 transaction types
        if (tx.tokenType === 'assetallocationsend') {
          return 'SPT Transfer';
        }

        if (tx.tokenType === 'syscoinburntoallocation') {
          return 'SYS → SYSX';
        }

        if (tx.tokenType === 'assetallocationburntosyscoin') {
          return 'SYSX → SYS';
        }

        if (tx.tokenType === 'assetallocationburntoethereum') {
          return 'SPT → NEVM';
        }

        if (tx.tokenType === 'assetallocationmint') {
          return 'SPT Mint';
        }

        return 'Transaction';
      }

      const txLabel = isTxSent ? 'Sent' : 'Received';

      return `${txLabel}`;
    },
    [isBitcoinBased]
  );

  const getTxStatusIcons = useCallback((txLabel: string, isDetail: boolean) => {
    switch (txLabel) {
      case 'Sent':
        return <SentIcon isDetail={isDetail} />;
      case 'Received':
        return <ReceivedIcon isDetail={isDetail} />;
      default:
        return null;
    }
  }, []);

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
    [t]
  );

  const formatTimeStamp = useCallback((timestamp: number) => {
    // Validate timestamp - should be in seconds, not too far in past or future
    const currentTime = Math.floor(Date.now() / 1000);
    const oneYearFromNow = currentTime + 365 * 24 * 60 * 60;
    const tenYearsAgo = currentTime - 10 * 365 * 24 * 60 * 60;

    // If timestamp is invalid, use current time
    if (!timestamp || timestamp < tenYearsAgo || timestamp > oneYearFromNow) {
      console.warn(
        `Invalid timestamp detected: ${timestamp}, using current time`
      );
      timestamp = currentTime;
    }

    const data = new Date(timestamp * 1000);

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    };

    const formatedData = new Intl.DateTimeFormat('en-US', options).format(data);

    return formatedData;
  }, []);

  const formatTimeStampUtxo = useCallback((timestamp: number) => {
    // Validate timestamp for UTXO as well
    const currentTime = Math.floor(Date.now() / 1000);
    const oneYearFromNow = currentTime + 365 * 24 * 60 * 60;
    const tenYearsAgo = currentTime - 10 * 365 * 24 * 60 * 60;

    // For UTXO, timestamp might already be in milliseconds
    let timestampMs = timestamp;
    if (timestamp < 10000000000) {
      // If timestamp appears to be in seconds, convert to milliseconds
      timestampMs = timestamp * 1000;
    }

    // Validate the millisecond timestamp
    const timestampSec = Math.floor(timestampMs / 1000);
    if (
      !timestampSec ||
      timestampSec < tenYearsAgo ||
      timestampSec > oneYearFromNow
    ) {
      console.warn(
        `Invalid UTXO timestamp detected: ${timestamp}, using current time`
      );
      timestampMs = Date.now();
    }

    const date = new Date(timestampMs);

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
  }, []);

  const getTokenSymbol = useCallback(
    (
      isErc20Tx: boolean,
      tx: any,
      currency: string,
      tokenSymbolCache?: Map<string, string>
    ) => {
      if (isErc20Tx && tx?.to) {
        // First check cache for this contract address
        const cachedSymbol = tokenSymbolCache?.get(tx.to.toLowerCase());
        if (cachedSymbol) {
          return cachedSymbol.toUpperCase();
        }

        // For transactions, we don't want to make API calls in the render loop
        // Instead, we'll fall back to showing the contract address or currency
        // The cache should be populated elsewhere for known tokens
        return `${currency}`.toUpperCase();
      }

      return `${currency}`.toUpperCase();
    },
    []
  );

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
