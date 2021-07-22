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
  txType
}) => {
  const controller = useController();
  const alert = useAlert();

  const [expanded, setExpanded] = useState<boolean>(false);
  const [fromAddress, setFromAddress] = useState('');
  const [newRecipients, setNewRecipients] = useState<any>({});
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

  useEffect(() => {
    console.log('assettx', assetTx)
  }, [
    assetTx
  ]);

  useEffect(() => {
    if (tx) {
      const vin = tx.vin;
      const vout = tx.vout;

      for (let item of vin) {
        controller.wallet.account.getTransactionInfoByTxId(item.txid).then((response: any) => {
          for (let vout of response.vout) {
            if (vout.n === item.vout) {
              setFromAddress(vout.addresses[0]);

              return;
            }
          }

        });
      }

      for (let item of vout) {
        if (item.addresses[0] === fromAddress) {
          return;
        }

        recipients[item.n] = {
          address: item.addresses[0],
          value: Number(item.value) / 10 ** 8
        }
      }

      setNewRecipients(recipients);
    }
  }, [
    tx
  ]);

  const renderReceiverAddresses = () => {
    return Object.values(newRecipients).map(({ address, value }: any) => {
      return <li>
        <p>{ellipsis(address)}</p>
        <p>{value}</p>
      </li>
    })
  }

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
            <div className={styles.addresses}>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
                <p>From</p>

                <b className={clsx(styles.iconBtn, { [styles.active]: isCopied })} onClick={() => copyText(fromAddress)}>{ellipsis(fromAddress)}</b>

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
                    {renderReceiverAddresses()}
                  </ul>
                </div>
              </div>
            </div>

            <div className={styles.data}>
              <h2>Transaction</h2>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p>Block hash</p>
                <b>{ellipsis(tx.blockHash)}</b>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p>Type</p>
                <b>{txType || 'Transaction'}</b>
              </div>

              {tx.tokenTransfers && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p>Token</p>
                    <b>{tx.tokenTransfers[0].token}</b>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p>Symbol</p>
                    <b>{tx.tokenTransfers[0].symbol ? atob(String(tx.tokenTransfers[0].symbol)) : ''}</b>
                  </div>
                </>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p>Confirmations</p>
                <b>{tx.confirmations}</b>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p>Mined</p>
                <b> {formatDistanceDate(new Date(tx.blockTime * 1000).toDateString())}</b>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p>Total input</p>
                <b>{(tx.valueIn) / 10 ** 8}</b>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p>Total output</p>
                <b>{(tx.value) / 10 ** 8}</b>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p>Total</p>
                <b>{tx.fees / 10 ** 8}</b>
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

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Asset Guid</p>
                  <b>{assetTx.assetGuid}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Type</p>
                  <b>{assetType}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Contract</p>
                  <b>{assetTx.contract}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Symbol</p>
                  <b> {assetTx.symbol ? atob(String(assetTx.symbol)) : ''}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Description</p>
                  <b>{assetTx.pubData && assetTx.pubData.desc ? formatURL(atob(String(assetTx.pubData.desc)), 15) : ''}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Total supply</p>
                  <b>{(assetTx.totalSupply) / 10 ** Number(assetTx.decimals)}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Max supply</p>
                  <b>{(assetTx.maxSupply) / 10 ** Number(assetTx.decimals)}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Decimals</p>
                  <b>{assetTx.decimals}</b>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p>Capability flags</p>
                  <b>{assetTx.updateCapabilityFlags}</b>
                </div>
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
