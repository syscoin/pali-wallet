import React, { FC, useCallback, Fragment } from 'react';

import { IconButton, Icon } from 'components/index';
import { FiatComponent } from 'components/index';
import { useStore, useUtils } from 'hooks/index';
import {
  ellipsis,
  formatCurrency,
  formatDate,
  formatTransactionValue,
} from 'utils/index';

interface IPanelList {
  activity: boolean;
  assets: boolean;
  data: any;
  isSyscoinChain?: boolean;
}

export const PanelList: FC<IPanelList> = ({
  data,
  assets = false,
  activity = false,
  isSyscoinChain = true,
}) => {
  const { navigate } = useUtils();

  const { activeAccount, activeNetwork, activeToken, networks } = useStore();

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
  const transactions = isSyscoinChain ? data : data.slice(0).reverse();

  const isShowedGroupBar = useCallback(
    (tx: any, idx: number) =>
      idx === 0 ||
      new Date(tx[blocktime] * 1e3).toDateString() !==
        new Date(transactions[idx - 1][blocktime] * 1e3).toDateString(),
    [transactions]
  );

  return (
    <>
      {activity && (
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

            return tx[blocktime] !== undefined ? (
              <Fragment key={tx[txid]}>
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
                          isConfirmed
                            ? 'text-warning-success'
                            : 'text-yellow-300'
                        }
                      >
                        {isConfirmed ? 'Confirmed' : 'Pending'}
                      </p>
                    </div>

                    <div className="flex pl-4 pr-2 md:pl-8">
                      <div className="text-left">
                        <p className="text-blue-300">{timestamp}</p>

                        <p>{getTxType(tx)}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-start">
                      {!isSyscoinChain && (
                        <>
                          <p>
                            {formatTransactionValue(
                              tx?.value?.hex,
                              activeNetwork,
                              networks,
                              activeToken,
                              false
                            )}
                          </p>

                          <FiatComponent transactionValue={tx?.value?.hex} />
                        </>
                      )}
                    </div>

                    <IconButton
                      className="w-5"
                      onClick={() =>
                        navigate('/home/details/', {
                          state: {
                            tx,
                            type: getTxType(tx),
                            assetGuid: null,
                            assetType: null,
                          },
                        })
                      }
                    >
                      <Icon name="select" className="text-base" />
                    </IconButton>
                  </div>
                </li>
              </Fragment>
            ) : (
              console.error('Please, change the current network.')
            );
          })}
        </ul>
      )}

      {assets && (
        <ul className="pb-24 md:pb-4">
          {isSyscoinChain &&
            data.map((asset: any) => {
              if (asset.assetGuid && asset.balance > 0) {
                return (
                  <li
                    key={asset.assetGuid}
                    className="flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark"
                  >
                    <p className="font-rubik">
                      {formatCurrency(
                        String(asset.balance / 10 ** asset.decimals),
                        asset.decimals
                      )}

                      <span className="text-button-secondary font-poppins">
                        {`  ${asset.symbol}`}
                      </span>
                    </p>

                    <IconButton
                      onClick={() =>
                        navigate('/home/details', {
                          state: {
                            tx: null,
                            type: null,
                            assetGuid: asset.assetGuid,
                            assetType: asset.type,
                          },
                        })
                      }
                    >
                      <Icon name="select" className="w-4 text-brand-white" />
                    </IconButton>
                  </li>
                );
              }

              return null;
            })}

          {!isSyscoinChain && (
            <>
              {data.map((asset: any, index: number) => {
                if (asset.symbol) {
                  return (
                    <li
                      key={index}
                      className="flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark"
                    >
                      <p className="font-rubik">
                        {asset.symbol === 'ETH'
                          ? activeAccount?.balances?.ethereum
                          : asset.balance}
                        <span className="text-button-secondary font-poppins">
                          {`  ${asset.symbol}`}
                        </span>
                      </p>

                      <IconButton
                        onClick={() =>
                          navigate('/home/details', {
                            state: {
                              tx: null,
                              type: null,
                              assetGuid: asset.symbol,
                              assetType: asset.type,
                            },
                          })
                        }
                      >
                        <Icon name="select" className="w-4 text-brand-white" />
                      </IconButton>
                    </li>
                  );
                }

                return null;
              })}

              <p
                className="mb-8 mt-4 text-center hover:text-brand-royalbluemedium cursor-pointer"
                onClick={() => navigate('/import-token')}
              >
                Import token
              </p>
            </>
          )}
        </ul>
      )}
    </>
  );
};
