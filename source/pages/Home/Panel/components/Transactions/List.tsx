import { uniqueId } from 'lodash';
import React, { Fragment, useCallback } from 'react';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useStore, useUtils } from 'hooks/index';
import { ellipsis, formatDate } from 'utils/index';

export const TransactionsList = ({
  isSyscoinChain,
}: {
  isSyscoinChain: boolean;
}) => {
  const {
    activeAccount: { transactions },
  } = useStore();

  const { navigate } = useUtils();

  const getTxType = (tx: any) => {
    if (isSyscoinChain) {
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

  const txid = isSyscoinChain ? 'txid' : 'hash';
  const blocktime = isSyscoinChain ? 'blockTime' : 'timestamp';

  const isShowedGroupBar = useCallback(
    (tx: any, idx: number) =>
      idx === 0 ||
      new Date(tx[blocktime] * 1e3).toDateString() !==
        new Date(transactions[idx - 1][blocktime] * 1e3).toDateString(),
    [transactions]
  );

  return (
    <ul className="pb-24 md:pb-8">
      {transactions.map((tx: any, idx: number) => {
        const isConfirmed = tx.confirmations > 0;
        const timestamp =
          blocktime &&
          new Date(tx[blocktime] * 1000).toLocaleTimeString(
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
                  {formatDate(new Date(tx[blocktime] * 1000).toDateString())}
                </li>
              )}

              <li className="py-2 border-b border-dashed border-dashed-dark">
                <div className="relative flex items-center justify-between text-xs">
                  <div>
                    <p>{ellipsis(tx[txid], 4, 14)}</p>

                    <p
                      className={
                        isConfirmed ? 'text-warning-success' : 'text-yellow-300'
                      }
                    >
                      {isConfirmed ? 'Confirmed' : 'Pending'}
                    </p>
                  </div>

                  <div
                    className={`absolute flex ${
                      isSyscoinChain ? 'right-20 w-20' : 'right-32 w-14'
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
  );
};
