import React, { FC, useState, useEffect } from 'react';
import { useController, useStore, useUtils, useFormat } from 'hooks/index';
import { Icon } from 'components/index';

interface IModalBlock {
  assetTx?: any;
  assetType?: any;
  callback?: any;
  message?: any;
  setCallback?: any;
  title: any;
  tx?: any;
  txType?: any;
}

export const ModalBlock: FC<IModalBlock> = ({
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

  const { activeNetwork } = useStore();
  const { useCopyClipboard, alert } = useUtils();
  const { ellipsis, formatDistanceDate, formatURL } = useFormat();

  const [expanded, setExpanded] = useState<boolean>(false);
  const [newExpanded, setNewExpanded] = useState<boolean>(false);
  const [tokensExpanded, setTokensExpanded] = useState<boolean>(false);
  const [newRecipients, setNewRecipients] = useState<any>({});
  const [newSenders, setNewSenders] = useState<any>({});
  const [isCopied, copyText] = useCopyClipboard();

  useEffect(() => {
    if (isCopied) {
      alert.removeAll();
      alert.success('Address copied to clipboard', { timeout: 2000 });
    }
  }, [isCopied]);

  const recipients: any = {};
  const senders: any = {};

  useEffect(() => {
    if (tx) {
      const { vin, vout } = tx;

      if (vin && vout) {
        for (const item of vout) {
          if (item.addresses) {
            recipients[item.addresses[0]] = {
              address: item.addresses[0],
              value: item.value
            };
          }
        }

        if (vin.length === 1) {
          for (const item of vin) {
            if (!item.vout) {
              return;
            }

            controller.wallet.account
              .getTransactionInfoByTxId(item.txid)
              .then((response: any) => {
                for (const vout of response.vout) {
                  if (vout.n === item.vout) {
                    senders[item.addresses[0]] = {
                      address: item.addresses[0],
                      value: item.value
                    };
                  }
                }
              });
          }
        }

        if (vin.length > 1) {
          for (const item of vin) {
            if (item.addresses) {
              senders[item.addresses[0]] = {
                address: item.addresses[0],
                value: item.value
              };
            }
          }
        }
      }

      setNewRecipients(recipients);
      setNewSenders(senders);
    }
  }, [tx]);

  const renderAssetData = ({
    assetGuid,
    contract,
    symbol,
    pubData,
    totalSupply,
    maxSupply,
    decimals,
    updateCapabilityFlags,
  }: any) => {
    const assetTransaction = [
      {
        label: 'Asset Guid',
        value: assetGuid,
      },
      {
        label: 'Type',
        value: assetType,
      },
      {
        label: 'Contract',
        value: formatURL(String(contract), 15),
      },
      {
        label: 'Symbol',
        value: symbol ? atob(String(symbol)) : '',
      },
      {
        label: 'Description',
        value:
          pubData && pubData.desc
            ? formatURL(atob(String(pubData.desc)), 15)
            : '',
      },
      {
        label: 'Total supply',
        value: totalSupply / 10 ** Number(decimals),
      },
      {
        label: 'Max supply',
        value: maxSupply / 10 ** Number(decimals),
      },
      {
        label: 'Decimals',
        value: decimals,
      },
      {
        label: 'Capability flags',
        value: updateCapabilityFlags,
      },
    ];

    return assetTransaction.map(({ label, value }: any) => {
      return (
        <div key={label}>
          <p>{label}</p>
          <b>{value}</b>
        </div>
      );
    });
  };

  const renderTxData = ({
    blockHash,
    confirmations,
    blockTime,
    valueIn,
    value,
    fees,
  }: any) => {
    const txData = [
      {
        label: 'Block hash',
        value: ellipsis(blockHash),
      },
      {
        label: 'Type',
        value: txType || 'Transaction',
      },
      {
        label: 'Confirmations',
        value: confirmations,
      },
      {
        label: 'Mined',
        value: blockTime
          ? formatDistanceDate(new Date(blockTime * 1000).toDateString())
          : '',
      },
      {
        label: 'Total input',
        value: valueIn ? (activeNetwork === 'main' ? `${valueIn / 10 ** 8} SYS` : `${valueIn / 10 ** 8} tSYS`) : '',
      },
      {
        label: 'Total output',
        value: value ? (activeNetwork === 'main' ? `${value / 10 ** 8} SYS` : `${value / 10 ** 8} tSYS`) : '',
      },
      {
        label: 'Fees',
        value: fees ? (activeNetwork === 'main' ? `${fees / 10 ** 8} SYS` : `${fees / 10 ** 8} tSYS`) : '',
      },
    ];

    return txData.map(({ label, value }: any) => {
      return (
        <div key={label}>
          <p>{label}</p>
          <b>{value}</b>
        </div>
      );
    });
  };

  const renderAddresses = (list: any) => {
    return Object.values(list).map(({ address, value }: any) => {
      return (
        <li key={address}>
          <p onClick={() => copyText(address)}>{ellipsis(address) || '...'}</p>
          <small>{formatURL(String(Number(value) / 10 ** 8), 18) ? formatURL(String(Number(value) / 10 ** 8), 18) : 0}   {activeNetwork === 'main' ? 'SYS' : 'tSYS'}</small>
        </li>
      );
    });
  };

  return (
    <div >
      <div>
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
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                >
                  <span
                    onClick={() => setNewExpanded(!newExpanded)}
                  >
                    <p>From</p>
                    <Icon name="arrow-down" className="w-4 bg-brand-gold text-brand-white" />
                  </span>

                  <ul>
                    {renderAddresses(newSenders)}
                  </ul>
                </div>
              </div>

              <div >
                <div
                >
                  <span
                    onClick={() => setExpanded(!expanded)}
                  >
                    <p>To</p>
                    <Icon name="arrow-dowm"  className="w-4 bg-brand-gold text-brand-white" />
                  </span>

                  <ul>
                    {renderAddresses(newRecipients)}
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <h2>Transaction</h2>

              {renderTxData(tx)}

              <div>
                <div
                >
                  <span
                    onClick={() => setTokensExpanded(!tokensExpanded)}
                  >
                    <p>Assets</p>
                    <Icon name="arrow-down" className="w-4 bg-brand-gold text-brand-white" />
                  </span>

                  <ul
                    style={{ padding: '0 .5rem', margin: '0 1rem 1rem' }}
                  >
                    {tx.tokenTransfers &&
                      tx.tokenTransfers.map(
                        (tokenTransfer: any, index: number) => {
                          return (
                            <div key={index}>
                              <p>
                                {tokenTransfer.symbol
                                  ? atob(tokenTransfer.symbol)
                                  : ''}
                              </p>
                              <b>{tokenTransfer.token}</b>
                            </div>
                          );
                        }
                      )
                    }
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <p>{message}</p>

          <div >
            <button onClick={() => callback()}>Go</button>
          </div>
        </div>
      ) : (
        <div>
          {assetTx && !tx ? (
            <div >
              <div >
                <h2>
                  Asset {assetTx.assetGuid} -{' '}
                  {assetTx.symbol ? atob(String(assetTx.symbol)) : ''}
                </h2>

                {renderAssetData(assetTx)}
              </div>

              <p>{message}</p>

              <div>
                <button onClick={() => callback()}>Go</button>
              </div>
            </div>
          ) : (
            <div
            >
              <Icon name="loading" className="w-4 bg-brand-gray text-brand-darktransparent" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
