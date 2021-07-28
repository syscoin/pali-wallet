import React, { FC, useState, useEffect } from 'react';
import clsx from 'clsx';
import DownArrowIcon from '@material-ui/icons/ExpandMore';

import styles from './ModalBlock.scss';
import { ellipsis, formatDistanceDate, formatURL } from 'containers/auth/helpers';
import { CircularProgress } from '@material-ui/core';
import { useController, useCopyClipboard } from 'hooks/index';
import { useAlert } from "react-alert";

interface IModalBlock {
  callback?: any;
  message?: any;
  setCallback?: any;
  title: any;
  tx?: any;
  assetTx?: any;
  assetType?: any;
  txType?: any;
}

const ModalBlock: FC<IModalBlock> = ({
  title,
  message,
  callback,
  setCallback,
  tx,
  assetTx,
  assetType,
  txType,
}) => {
  const controller = useController();
  const alert = useAlert();

  const [expanded, setExpanded] = useState<boolean>(false);
  const [newExpanded, setNewExpanded] = useState<boolean>(false);
  const [tokensExpanded, setTokensExpanded] = useState<boolean>(false);
  const [newRecipients, setNewRecipients] = useState<any>({});
  const [newSenders, setNewSenders] = useState<any>({});
  const [isCopied, copyText] = useCopyClipboard();

  useEffect(() => {
    if (isCopied) {
      alert.removeAll();
      alert.success("Address copied to clipboard", { timeout: 2000 })
    }
  }, [
    isCopied
  ]);

  const recipients: any = {};
  const senders: any = {};

  useEffect(() => {
    if (tx) {
      const { vin, vout } = tx;

      console.log('tx', tx)

      if (vin && vout) {
        for (let item of vout) {
          if (item.addresses) {
            recipients[item.addresses[0]] = item.addresses[0];
          }
        }

        if (vin.length === 1) {
          for (const item of vin) {
            if (!item.vout) {
              return;
            }

            controller.wallet.account.getTransactionInfoByTxId(item.txid).then((response: any) => {
              for (const vout of response.vout) {
                if (vout.n === item.vout) {
                  senders[item.addresses[0]] = item.addresses[0];
                }
              }
            });
          }
        }

        if (vin.length > 1) {
          for (const item of vin) {
            if (item.addresses) {
              senders[item.addresses[0]] = item.addresses[0];
            }
          }
        }
      }

      setNewRecipients(recipients);
      setNewSenders(senders);
    }
  }, [tx]);

  const renderAssetData = ({ assetGuid, contract, symbol, pubData, totalSupply, maxSupply, decimals, updateCapabilityFlags }: any) => {
    const assetTransaction = [
      {
        label: 'Asset Guid',
        value: assetGuid
      },
      {
        label: 'Type',
        value: assetType
      },
      {
        label: 'Contract',
        value: contract
      },
      {
        label: 'Symbol',
        value: symbol ? atob(String(symbol)) : ''
      },
      {
        label: 'Description',
        value: pubData && pubData.desc ? formatURL(atob(String(pubData.desc)), 15) : ''
      },
      {
        label: 'Total supply',
        value: (totalSupply) / 10 ** Number(decimals)
      },
      {
        label: 'Max supply',
        value: (maxSupply) / 10 ** Number(decimals)
      },
      {
        label: 'Decimals',
        value: decimals
      },
      {
        label: 'Capability flags',
        value: updateCapabilityFlags
      },
    ];

    return assetTransaction.map(({ label, value }: any) => {
      return (
        <div key={label} className={styles.flexCenter}>
          <p>{label}</p>
          <b>{value}</b>
        </div>
      )
    })
  }

  const renderTxData = ({ blockHash, confirmations, blockTime, valueIn, value, fees }: any) => {
    const txData = [
      {
        label: 'Block hash',
        value: ellipsis(blockHash)
      },
      {
        label: 'Type',
        value: txType || 'Transaction'
      },
      {
        label: 'Confirmations',
        value: confirmations
      },
      {
        label: 'Mined',
        value: blockTime ? formatDistanceDate(new Date(blockTime * 1000).toDateString()) : ''
      },
      {
        label: 'Total input',
        value: valueIn ? (valueIn) / 10 ** 8 : ''
      },
      {
        label: 'Total output',
        value: value ? (value) / 10 ** 8 : ''
      },
      {
        label: 'Total',
        value: fees ? fees / 10 ** 8 : ''
      },
    ];

    return txData.map(({ label, value }: any) => {
      return (
        <div key={label} className={styles.flexCenter}>
          <p>{label}</p>
          <b>{value}</b>
        </div>
      )
    })
  }

  const renderAddresses = (list: any) => {
    return Object.values(list).map((address: any, index: number) => {
      return <li key={index}>
        <p
          onClick={() => copyText(address)}
        >
          {ellipsis(address) || '...'}
        </p>
      </li>
    })
  }

  // const getTokenTransferItem = (transaction: any) => {
  //   const { vin, vout, tokenTransfers } = transaction;

  //   if (tokenTransfers && vin && vout) {
  //     console.log('txxxx', tokenTransfers, vin, vout)

  //     for (const v of vin) {
  //       return controller.wallet.account.getTransactionInfoByTxId(v.txid).then((response: any) => {
  //         const voutZero = response.vout.find((voutItem: any) => {
  //           return voutItem.n === 0;
  //         });
    
  //         if (voutZero) {
  //           const assetGuid = tokenTransfers.find((token: any) => {
  //             return token.token === voutZero.assetInfo.assetGuid;
  //           })
    
  //           if (assetGuid) {
  //             return (
  //               <div className={styles.flexCenter}>
  //                 <p>{assetGuid.symbol ? atob(assetGuid.symbol) : ''}</p>
  //                 <b>{assetGuid.token}</b>
  //               </div>
  //             )
  //           }

  //           return null;
  //         }
  //       })
  //     }
  //   }
  // }

  return (
    <div className={styles.modal}>
      <div className={styles.title}>
        <small>{title}</small>

        <p onClick={() => setCallback()}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M14 1.41L12.59 0L7 5.59L1.41 0L0 1.41L5.59 7L0 12.59L1.41 14L7 8.41L12.59 14L14 12.59L8.41 7L14 1.41Z"
              fill="#808080"
            />
          </svg>
        </p>
      </div>

      {tx && !assetTx ? (
        <div>
          <div className={styles.transaction}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className={styles.select}>
                <div
                  className={clsx(styles.fullselect, {
                    [styles.expanded]: newExpanded,
                  })}
                >
                  <span
                    onClick={() => setNewExpanded(!newExpanded)}
                    className={styles.selected}
                  >
                    <p>From</p>
                    <DownArrowIcon className={styles.arrow} />
                  </span>

                  <ul className={styles.options}>
                    {renderAddresses(newSenders)}
                  </ul>
                </div>
              </div>

              <div className={styles.select}>
                <div
                  className={clsx(styles.fullselect, {
                    [styles.expanded]: expanded,
                  })}
                >
                  <span
                    onClick={() => setExpanded(!expanded)}
                    className={styles.selected}
                  >
                    <p>To</p>
                    <DownArrowIcon className={styles.arrow} />
                  </span>

                  <ul className={styles.options}>
                    {renderAddresses(newRecipients)}
                  </ul>
                </div>
              </div>
            </div>

            <div className={styles.data}>
              <h2>Transaction</h2>

              {renderTxData(tx)}

              <div className={styles.select}>
                <div
                  className={clsx(styles.fullselect, {
                    [styles.expanded]: tokensExpanded,
                  })}
                >
                  <span
                    onClick={() => setTokensExpanded(!tokensExpanded)}
                    className={styles.selected}
                  >
                    <p>Asset info</p>
                    <DownArrowIcon className={styles.arrow} />
                  </span>

                  <ul className={styles.options} style={{ padding: "0 .5rem", margin: "0 1rem 1rem" }}>
                    {tx.tokenTransfers && tx.tokenTransfers.map((tokenTransfer: any, index: number) => {
                      return (
                        <div key={index} className={styles.flexCenter}>
                          <p>{tokenTransfer.symbol ? atob(tokenTransfer.symbol) : ''}</p>
                          <b>{tokenTransfer.token}</b>
                        </div>
                      )
                    })}
                    {/* {getTokenTransferItem(tx)} */}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <p>{message}</p>

          <div className={styles.close}>
            <button onClick={() => callback()}>Go</button>
          </div>
        </div>
      ) : (
        <div>
          {assetTx && !tx ? (
            <div className={styles.transaction} style={{ marginTop: "2rem" }}>
              <div className={styles.data} style={{ height: "342px" }}>
                <h2>Asset {assetTx.assetGuid} - {assetTx.symbol ? atob(String(assetTx.symbol)) : ''}</h2>

                {renderAssetData(assetTx)}
              </div>

              <p>{message}</p>

              <div className={styles.close}>
                <button onClick={() => callback()}>Go</button>
              </div>
            </div>
          ) : (
            <div
              className={clsx(styles.mask, {
                [styles.hide]: tx
              })}
            >
              <CircularProgress className={styles.loader} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ModalBlock;
