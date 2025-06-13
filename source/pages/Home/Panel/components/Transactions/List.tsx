import uniqueId from 'lodash/uniqueId';
import React, { Fragment, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { ConfirmationModal } from 'components/Modal';
import { TransactionOptions } from 'components/TransactionOptions';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatDate, handleUpdateTransaction } from 'utils/index';

export const TransactionsList = ({
  userTransactions,
}: {
  userTransactions: any[]; //todo: adjust type
}) => {
  const { t } = useTranslation();
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);

  const [modalData, setModalData] = useState<{
    buttonText: string;
    description: string;
    onClick: () => void;
    onClose: () => void;
    title: string;
  }>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);

  const { navigate, alert } = useUtils();

  const getTxType = (tx: any, isTxSent: boolean) => {
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
  };

  // Helper function to get SPT-specific styling for Syscoin 5 transaction types
  const getSPTTypeInfo = (tokenType: string) => {
    switch (tokenType) {
      case 'assetallocationsend':
        return {
          label: 'SPT Transfer',
          bgColor: 'bg-blue-500/10',
          textColor: 'text-blue-400',
          icon: '↗️',
        };
      case 'syscoinburntoallocation':
        return {
          label: 'SYS → SYSX',
          bgColor: 'bg-orange-500/10',
          textColor: 'text-orange-400',
          icon: '🔥',
        };
      case 'assetallocationburntosyscoin':
        return {
          label: 'SYSX → SYS',
          bgColor: 'bg-green-500/10',
          textColor: 'text-green-400',
          icon: '💰',
        };
      case 'assetallocationburntoethereum':
        return {
          label: 'SPT → NEVM',
          bgColor: 'bg-purple-500/10',
          textColor: 'text-purple-400',
          icon: '🌉',
        };
      case 'assetallocationmint':
        return {
          label: 'SPT Mint',
          bgColor: 'bg-emerald-500/10',
          textColor: 'text-emerald-400',
          icon: '⚡',
        };
      default:
        return {
          label: 'Transaction',
          bgColor: 'bg-gray-500/10',
          textColor: 'text-gray-400',
          icon: '💱',
        };
    }
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
          transaction={tx}
          setIsOpenModal={setIsOpenModal}
          setModalData={setModalData}
        />
      );
    }
  };

  const renderTransaction = (tx, idx) => {
    const isTxCanceled = tx?.isCanceled === true;
    const isConfirmed = tx.confirmations > 0;
    const timestamp =
      blocktime &&
      new Date(tx[blocktime] * 1000).toLocaleTimeString(
        //todo: add day/month/year as well
        navigator.language,
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      );

    // Use the direction field if available, otherwise fall back to the old logic
    const isTxSent = tx.direction ? tx.direction === 'sent' : false;
    const sptInfo =
      isBitcoinBased && tx.tokenType ? getSPTTypeInfo(tx.tokenType) : null;

    return (
      tx[blocktime] && (
        <Fragment key={uniqueId(tx[txid])}>
          {isShowedGroupBar(tx, idx) && (
            <li className="my-3 text-center text-sm bg-bkg-1">
              {formatDate(new Date(tx[blocktime] * 1000).toDateString())}
            </li>
          )}

          <li className="py-3 border-b border-dashed border-dashed-dark hover:bg-alpha-whiteAlpha50 transition-colors duration-200 rounded-lg">
            <div className="relative flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                {!isBitcoinBased && (
                  <Icon
                    name={isTxSent ? 'arrow-up' : 'arrow-down'}
                    className="mx-2"
                  />
                )}

                {/* SPT Type Badge */}
                {sptInfo && (
                  <div
                    className={`flex items-center gap-2 px-2 py-1 rounded-full ${sptInfo.bgColor}`}
                  >
                    <span className="text-sm">{sptInfo.icon}</span>
                    <span
                      className={`text-xs font-medium ${sptInfo.textColor}`}
                    >
                      {sptInfo.label}
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm">
                      {ellipsis(tx[txid], 4, 14)}
                    </p>
                    {sptInfo && (
                      <span className="text-xs text-brand-gray400">SPT</span>
                    )}
                  </div>
                  {getTxStatus(isTxCanceled, isConfirmed)}
                </div>
              </div>

              <div
                className={`absolute flex ${
                  isBitcoinBased ? 'right-20 w-20' : 'right-28 w-14'
                }`}
              >
                <div className="max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis">
                  <p className="text-blue-300">{timestamp}</p>
                  <p className={sptInfo ? sptInfo.textColor : ''}>
                    {getTxType(tx, isTxSent)}
                  </p>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <IconButton
                  className="w-5 p-2 hover:bg-brand-royalbluemedium/20 rounded-full transition-colors duration-200"
                  onClick={() =>
                    navigate('/home/details', {
                      state: {
                        id: null,
                        hash: tx[txid],
                      },
                    })
                  }
                  aria-label={`View transaction details for ${tx[txid]}`}
                >
                  <Icon
                    name="select"
                    className="text-base hover:text-brand-royalbluemedium transition-colors"
                  />
                </IconButton>

                {!isBitcoinBased && getTxOptions(isTxCanceled, isConfirmed, tx)}
              </div>
            </div>
          </li>
        </Fragment>
      )
    );
  };

  const TransactionList = () => (
    <ul className="pb-4">
      {filteredTransactions.map((tx: any, idx: number) =>
        renderTransaction(tx, idx)
      )}
    </ul>
  );

  return (
    <>
      <ConfirmationModal show={isOpenModal} {...modalData} />
      <TransactionList />
    </>
  );
};
