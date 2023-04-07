import { uniqueId } from 'lodash';
import React, { Fragment, useCallback } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatDate } from 'utils/index';

export const TransactionsList = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { url: chainId },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);

  const { transactions: userTransactions } =
    accounts[activeAccount.type][activeAccount.id];

  const { navigate } = useUtils();

  const getTxType = (tx: any) => {
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

    return `Type: ${tx.type}`;
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

  const TransactionList = useCallback(
    () => (
      <ul className="pb-4">
        {userTransactions
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
          })
          .map((tx: any, idx: number) => {
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
            return (
              tx[blocktime] && (
                <Fragment key={uniqueId(tx[txid])}>
                  {isShowedGroupBar(tx, idx) && (
                    <li className="my-3 text-center text-sm bg-bkg-1">
                      {formatDate(
                        new Date(tx[blocktime] * 1000).toDateString()
                      )}
                    </li>
                  )}

                  <li className="py-2 border-b border-dashed border-dashed-dark">
                    <div className="relative flex items-center justify-between text-xs">
                      <div>
                        <p>{ellipsis(tx[txid], 4, 14)}</p>

                        <p
                          className={
                            isConfirmed
                              ? 'text-warning-success'
                              : 'text-yellow-300'
                          }
                        >
                          {isConfirmed ? 'Confirmed' : 'Pending'}
                        </p>
                      </div>

                      <div
                        className={`absolute flex ${
                          isBitcoinBased ? 'right-20 w-20' : 'right-32 w-14'
                        }`}
                      >
                        <div className="max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis">
                          <p className="text-blue-300">{timestamp}</p>

                          <p>{getTxType(tx)}</p>
                        </div>
                      </div>

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
                    </div>
                  </li>
                </Fragment>
              )
            );
          })}
      </ul>
    ),
    [userTransactions]
  );

  return <TransactionList />;
};
