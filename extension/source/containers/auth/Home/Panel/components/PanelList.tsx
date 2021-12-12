import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { randomUUID } from 'crypto';
import { useController, useFormat } from 'hooks/index';
import React, { FC, useCallback, Fragment } from 'react';
import { Transaction } from 'scripts/types';

interface IPanelList {
  data: any;
  assets: boolean;
  activity: boolean;
}

export const PanelList: FC<IPanelList> = ({
  data,
  assets = false,
  activity = false,
}) => {
  const controller = useController();

  const { formatDistanceDate, ellipsis } = useFormat();

  const isShowedGroupBar = useCallback(
    (tx: Transaction, idx: number) => {
      return (
        idx === 0 ||
        new Date(tx.blockTime * 1e3).toDateString() !==
        new Date(data[idx - 1].blockTime * 1e3).toDateString()
      );
    },
    [data]
  );

  const handleFetchMoreTxs = () => {
    if (data.length) {
      controller.wallet.account.updateTxs();
    }
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
    <div>
      {activity && (
        <>
          <ul>
            {data.map((tx: Transaction, idx: number) => {
              const isConfirmed = tx.confirmations > 0;

              return (
                <Fragment key={tx.txid}>
                  {isShowedGroupBar(tx, idx) && (
                    <li className="bg-brand-navydarker text-sm text-center">
                      {formatDistanceDate(new Date(tx.blockTime * 1000).toDateString())}
                    </li>
                  )}

                  <li
                    className="border-dashed border-b border-gray-200 py-2"
                  >
                    <div className="flex text-xs">
                      <div>
                        <p>{ellipsis(String(tx.txid), 4, 7)}</p>
                        <p className="text-yellow-300">{isConfirmed ? 'Confirmed' : 'Pending'}</p>
                      </div>

                      <div className="flex justify-self-end">
                        <div>
                          <p className="text-blue-300">
                            {new Date(tx.blockTime * 1000).toLocaleTimeString(navigator.language, {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>

                          <p>{getTxType(tx)}</p>
                        </div>

                        <IconButton className="w-1">
                          <Icon
                            name="select"
                            className="text-base"
                          />
                        </IconButton>
                      </div>
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ul>

          <ul>
            {data.map((data: any) => {
              return (
                <li className="border-dashed border-b border-gray-200 py-2">
                  <div className="flex text-xs">
                    <div>
                      <p>{data.account}</p>
                      <p className="text-yellow-300">{data.status}</p>
                    </div>
                    <div className="pl-16">
                      <p className="text-blue-300">{data.hour}</p>
                      <p>{data.stp}</p>
                    </div>
                    <div className="pl-20 leading-8">
                      <button className="w-1" type="submit">
                        <Icon
                          name="select"
                          className="text-base"
                          maxWidth={'1'}
                        ></Icon>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>

      )}

      {assets && (
        <ul>
          {data.map((data) => {
            return (
              <li className="border-dashed border-b border-gray-200 py-2">
                <div className="flex text-xs">
                  <div>
                    <p>{data.idk}</p>
                  </div>
                  <div className="pl-8">
                    <p>{data.value}</p>
                  </div>
                  <div className="pl-8 text-blue-300">
                    <p>{data.idk2}</p>
                  </div>
                  <div className="pl-20">
                    <button className="w-1" type="submit">
                      <Icon
                        name="select"
                        className="text-base inline-flex self-center"
                        maxWidth={'1'}
                      ></Icon>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
