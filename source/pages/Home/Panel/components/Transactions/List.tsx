import uniqueId from 'lodash/uniqueId';
import React, { Fragment, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { TransactionOptions } from 'components/TransactionOptions';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis, formatDate } from 'utils/index';

export const TransactionsList = ({
  userTransactions,
}: {
  userTransactions: any[]; //todo: adjust type
}) => {
  const { wallet } = getController();
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
    activeAccount,
    accounts,
  } = useSelector((state: RootState) => state.vault);

  const currentAccount = accounts[activeAccount.type][activeAccount.id];

  const { navigate, alert } = useUtils();

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

  const cancelTransaction = async (txHash: string, isLegacy: boolean) => {
    const { isCanceled, error } =
      await wallet.ethereumTransaction.cancelSentTransaction(txHash, isLegacy);

    if (!isCanceled && error) {
      alert.removeAll();
      alert.error(
        'Transaction not found or already confirmed, verify the transaction in the explorer!'
      );

      return;
    }

    switch (isCanceled) {
      case true:
        wallet.setEvmTransactionAsCanceled(txHash, chainId);
        alert.removeAll();
        alert.success('Your transaction was successfully canceled.');
        break;
      case false:
        alert.removeAll();
        alert.error(
          'Something went wrong when trying to cancel your Transaction, please try again later!'
        );
        break;
    }
  };

  const speedUpTransaction = async (txHash: string, isLegacy: boolean) => {};

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

    const isTxSent = isBitcoinBased
      ? false
      : tx.from.toLowerCase() === currentAccount.address;

    return (
      tx[blocktime] && (
        <Fragment key={uniqueId(tx[txid])}>
          {isShowedGroupBar(tx, idx) && (
            <li className="my-3 text-center text-sm bg-bkg-1">
              {formatDate(new Date(tx[blocktime] * 1000).toDateString())}
            </li>
          )}

          <li className="py-2 border-b border-dashed border-dashed-dark">
            <div className="relative flex items-center justify-between text-xs">
              <div className="flex items-center">
                {!isBitcoinBased && (
                  <Icon
                    name={isTxSent ? 'arrow-up' : 'arrow-down'}
                    className="mx-2"
                  />
                )}
                <div className="flex flex-row">
                  <div>
                    <p>{ellipsis(tx[txid], 4, 14)}</p>

                    {isTxCanceled ? (
                      <p className="text-warning-error">Canceled</p>
                    ) : (
                      <p
                        className={
                          isConfirmed
                            ? 'text-warning-success'
                            : 'text-yellow-300'
                        }
                      >
                        {isConfirmed ? 'Confirmed' : 'Pending'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div
                className={`absolute flex ${
                  isBitcoinBased ? 'right-20 w-20' : 'right-28 w-14'
                }`}
              >
                <div className="max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis">
                  <p className="text-blue-300">{timestamp}</p>

                  <p>{getTxType(tx, isTxSent)}</p>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <IconButton
                  className="w-5"
                  onClick={() =>
                    navigate('/home/details', {
                      state: {
                        id: null,
                        hash: tx[txid],
                      },
                    })
                  }
                >
                  <Icon name="select" className="text-base" />
                </IconButton>

                {!isConfirmed && !isTxCanceled ? (
                  <TransactionOptions
                    cancelTransaction={cancelTransaction}
                    speedUpTransaction={speedUpTransaction}
                    transaction={tx}
                  />
                ) : null}
              </div>
            </div>
          </li>
        </Fragment>
      )
    );
  };

  const TransactionList = useCallback(
    () => (
      <ul className="pb-4">
        {filteredTransactions.map((tx: any, idx: number) =>
          renderTransaction(tx, idx)
        )}
      </ul>
    ),
    [userTransactions]
  );

  return <TransactionList />;
};
