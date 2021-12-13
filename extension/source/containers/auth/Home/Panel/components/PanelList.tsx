import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useFormat } from 'hooks/index';
import React, { FC, useCallback, Fragment } from 'react';
import { Assets, Transaction } from 'scripts/types';

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
  const {
    formatDistanceDate,
    ellipsis,
    formatCurrency
  } = useFormat();

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
        <ul className="pb-4">
          {data.map((tx: Transaction, idx: number) => {
            const isConfirmed = tx.confirmations > 0;
            const timestamp = new Date(tx.blockTime * 1000).toLocaleTimeString(navigator.language, {
              hour: '2-digit',
              minute: '2-digit'
            })

            return (
              <Fragment key={tx.txid}>
                {isShowedGroupBar(tx, idx) && (
                  <li
                    className="bg-brand-navydarker text-sm text-center my-3"
                  >
                    {formatDistanceDate(new Date(tx.blockTime * 1000).toDateString())}
                  </li>
                )}

                <li
                  className="border-dashed border-b border-gray-600 py-2"
                >
                  <div className="flex justify-between pr-6 text-xs">
                    <div>
                      <p>{ellipsis(String(tx.txid), 4, 14)}</p>

                      <p
                        className="text-yellow-300"
                      >
                        {isConfirmed ? 'Confirmed' : 'Pending'}
                      </p>
                    </div>

                    <div className="flex justify-self-end">
                      <div className="mr-12">
                        <p className="text-blue-300">
                          {timestamp}
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
      )}

      {assets && (
        <ul className="pb-4">
          {data.map((asset: Assets) => {
            if (asset.assetGuid) {
              return (
                <li
                  key={asset.assetGuid}
                  className="border-dashed border-b border-gray-600 py-4 flex justify-between items-center text-xs"
                >
                  <p className="font-rubik">
                    {formatCurrency(String(asset.balance / 10 ** asset.decimals), asset.decimals)}

                    <span className="font-poppins">
                      {`  ${asset.symbol}`}
                    </span>
                  </p>

                  <IconButton>
                    <Icon
                      name="arrow-up"
                      className="w-4 bg-brand-gray200 text-brand-navy"
                    />
                  </IconButton>
                </li>
              );
            }

            return null;
          })}
        </ul>
      )}
    </div>
  );
};
