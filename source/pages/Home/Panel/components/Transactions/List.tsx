import React, {
  Fragment,
  useCallback,
  useMemo,
  useState,
  useDeferredValue,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { ConfirmationModal } from 'components/Modal';
import { TransactionOptions } from 'components/TransactionOptions';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatDate, handleUpdateTransaction } from 'utils/index';
import {
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';
import { isTransactionInBlock } from 'utils/transactionUtils';

import { useTransactionsListConfig } from './utils/useTransactionsInfos';

export const TransactionsList = ({
  userTransactions,
}: {
  userTransactions: any[]; //todo: adjust type
}) => {
  const { t } = useTranslation();
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
    accounts,
    activeAccount: activeAccountMeta,
  } = useSelector((state: RootState) => state.vault);
  const activeAccount =
    accounts[activeAccountMeta.type]?.[activeAccountMeta.id];
  const [searchParams] = useSearchParams();
  const { getTxStatus } = useTransactionsListConfig();
  const [modalData, setModalData] = useState<{
    buttonText: string;
    description: string;
    onClick: () => void;
    onClose: () => void;
    title: string;
  }>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Use deferred value for search to keep input responsive
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isSearching = searchQuery !== deferredSearchQuery;

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
          bgColor: 'bg-blue-500',
          textColor: 'text-white',
          icon: '↗️',
        };
      case 'syscoinburntoallocation':
        return {
          label: 'SYS → SYSX',
          bgColor: 'bg-orange-500',
          textColor: 'text-white',
          icon: '🔥',
        };
      case 'assetallocationburntosyscoin':
        return {
          label: 'SYSX → SYS',
          bgColor: 'bg-green-500',
          textColor: 'text-white',
          icon: '💰',
        };
      case 'assetallocationburntoethereum':
        return {
          label: 'SPT → NEVM',
          bgColor: 'bg-purple-500',
          textColor: 'text-white',
          icon: '🌉',
        };
      case 'assetallocationmint':
        return {
          label: 'SPT Mint',
          bgColor: 'bg-yellow-500',
          textColor: 'text-white',
          icon: '⚡',
        };
      default:
        return {
          label: 'Transaction',
          bgColor: 'bg-gray-500',
          textColor: 'text-white',
          icon: '💱',
        };
    }
  };

  const txid = isBitcoinBased ? 'txid' : 'hash';
  const blocktime = isBitcoinBased ? 'blockTime' : 'timestamp';

  const isShowedGroupBar = useCallback(
    (tx: any, idx: number) => {
      // Early return if current transaction is null/undefined
      if (tx === null || tx === undefined) {
        return false;
      }

      // Check if it's the first transaction
      if (idx === 0) {
        return true;
      }

      // Early return if previous transaction is null/undefined
      const prevTx = userTransactions[idx - 1];
      if (prevTx === null || prevTx === undefined) {
        return false;
      }

      // Compare dates between current and previous transaction
      return (
        new Date(tx[blocktime] * 1e3).toDateString() !==
        new Date(prevTx[blocktime] * 1e3).toDateString()
      );
    },
    [userTransactions, blocktime]
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
      .filter((tx: any) => {
        // Apply search filter using deferred query
        if (!deferredSearchQuery) return true;

        const query = deferredSearchQuery.toLowerCase();
        const txHash = (tx[txid] || '').toLowerCase();
        const txType = getTxType(tx, tx.direction === 'sent').toLowerCase();

        return txHash.includes(query) || txType.includes(query);
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
  }, [
    userTransactions,
    isBitcoinBased,
    chainId,
    blocktime,
    deferredSearchQuery,
    txid,
  ]);

  const getTxOptions = (isCanceled: boolean, isConfirmed: boolean, tx: any) => {
    if (!isCanceled && !isConfirmed) {
      return (
        <TransactionOptions
          handleUpdateTransaction={({ updateData }) =>
            handleUpdateTransaction({ updateData, t })
          }
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
    const isConfirmed = isTransactionInBlock(tx);
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

    // Use the direction field if available, otherwise fall back to comparing addresses for EVM
    let isTxSent = false;

    if (tx.direction) {
      // If direction field exists, use it
      isTxSent = tx.direction === 'sent';
    } else if (!isBitcoinBased && tx.from && activeAccount?.address) {
      // For EVM transactions without direction field, compare tx.from with active account address
      isTxSent = tx.from.toLowerCase() === activeAccount.address.toLowerCase();
    }
    const sptInfo =
      isBitcoinBased && tx.tokenType ? getSPTTypeInfo(tx.tokenType) : null;

    return (
      tx[blocktime] && (
        <Fragment key={tx[txid]}>
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
                  onClick={() => {
                    const returnContext = createNavigationContext(
                      '/home',
                      searchParams.get('tab') || 'activity'
                    );

                    navigateWithContext(
                      navigate,
                      '/home/details',
                      {
                        id: null,
                        hash: tx[txid],
                      },
                      returnContext
                    );
                  }}
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

      {/* Progressive search input */}
      {filteredTransactions.length > 0 && (
        <div className="px-4 py-2">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(
                'transactions.searchPlaceholder',
                'Search transactions...'
              )}
              className="w-full px-4 py-2 pr-10 bg-bkg-2 border border-bkg-4 rounded-lg focus:outline-none focus:border-brand-royalblue transition-colors"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <div className="animate-spin h-4 w-4 border-2 border-brand-royalblue border-t-transparent rounded-full" />
              </div>
            )}
            {!isSearching && searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-brand-gray400 hover:text-brand-white transition-colors"
              >
                <Icon name="close" className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={
          isSearching ? 'opacity-60 transition-opacity' : 'transition-opacity'
        }
      >
        <TransactionList />
      </div>

      {filteredTransactions.length === 0 && deferredSearchQuery && (
        <div className="text-center py-8 text-brand-gray400">
          {t('transactions.noResults', 'No transactions found')}
        </div>
      )}
    </>
  );
};
