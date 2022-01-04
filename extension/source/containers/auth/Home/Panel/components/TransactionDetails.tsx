import { useFormat, useController, useStore, useUtils } from 'hooks/index';
import React, { useState, useEffect } from 'react';
import { Icon, IconButton, Button } from 'components/index';
import { Disclosure } from '@headlessui/react';

export const TransactionDetails = ({
  transactionType,
  transactionDetails
}) => {
  const {
    formatDistanceDate,
    ellipsis,
    formatURL
  } = useFormat();

  const { activeNetwork } = useStore();
  const { useCopyClipboard } = useUtils();

  const controller = useController();

  const [newRecipients, setNewRecipients] = useState<any>({});
  const [newSenders, setNewSenders] = useState<any>({});
  const [copy, copyText] = useCopyClipboard();

  const recipients: any = {};
  const senders: any = {};

  useEffect(() => {
    if (transactionDetails) {
      const { vin, vout } = transactionDetails;

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
          console.log('vin > 1', vin, vout)
          for (const item of vin) {
            if (item.addresses) {
              senders[item.addresses[0]] = {
                address: item.addresses[0],
                value: item.value
              };
            }
          }
        }

        setNewRecipients(recipients);
        setNewSenders(senders);

        console.log(copy)
      }
    }
  }, [transactionDetails]);

  const renderAddresses = (list: any) => {
    return Object.values(list).map(({ address, value }: any) => {
      return (
        <li
          onClick={() => copyText(address)}
          key={address}
          className="flex justify-between mt-2 items-center gap-x-1 cursor-pointer rounded-lg transition-all duration-200 p-1 text-xs"
        >
          <p>
            {ellipsis(address) || '...'}
          </p>

          <div>
            <small>
              {formatURL(String(Number(value) / 10 ** 8), 18) ? formatURL(String(Number(value) / 10 ** 8), 18) : 0}   {activeNetwork === 'main' ? 'SYS' : 'tSYS'}
            </small>

            <IconButton
              onClick={() => copyText(address)}
            >
              <Icon name="copy" className="text-brand-white hover:text-fields-input-borderfocus" />
            </IconButton>
          </div>
        </li>
      );
    });
  };

  const {
    blockHash,
    confirmations,
    blockTime,
    valueIn,
    value,
    fees,
  } = transactionDetails;

  const txData = [
    {
      label: 'Block hash',
      value: ellipsis(blockHash),
    },
    {
      label: 'Type',
      value: transactionType || 'Transaction',
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


  return (
    <>
      {txData.map(({ label, value }: any) => {
        return (
          <>
            <div key={label} className="my-1 py-2 px-2 w-full border-b border-dashed border-bkg-2 cursor-default flex justify-between items-center transition-all duration-300 text-xs">
              <p>{label}</p>
              <b>{value}</b>
            </div>
          </>
        );
      })}

      {Object.values(newSenders).length > 0 && (
        <Disclosure
        >
          {({ open }) => (
            <>
              <Disclosure.Button
                className={`${open ? 'rounded-t-md' : 'rounded-md'} mt-3 p-2 flex justify-between items-center  w-full border border-bkg-3 bg-bkg-1 cursor-pointer transition-all duration-300 text-xs`}
              >
                From

                <Icon
                  name="select-up"
                  className={`${open ?
                    'transform rotate-180' :
                    ''
                    } mb-1 text-brand-white`}
                />
              </Disclosure.Button>


              <Disclosure.Panel>
                <div
                  className="px-2 pb-2 rounded-lg w-full border border-bkg-4 bg-bkg-3 flex flex-col transition-all duration-300 text-sm text-brand-white border-t-0 rounded-t-none"
                >
                  {Object.values(newSenders).length && renderAddresses(newSenders)}
                </div>
              </Disclosure.Panel>

            </>
          )}
        </Disclosure>
      )}

      {Object.values(newRecipients).length > 0 && (
        <Disclosure
        >
          {({ open }) => (
            <>
              <Disclosure.Button
                className={`${open ? 'rounded-t-md' : 'rounded-md'} mt-3 p-2 flex justify-between items-center  w-full border border-bkg-3 bg-bkg-1 cursor-pointer transition-all duration-300 text-xs`}
              >
                To

                <Icon
                  name="select-up"
                  className={`${open ?
                    'transform rotate-180' :
                    ''
                    } mb-1 text-brand-white`}
                />
              </Disclosure.Button>


              <Disclosure.Panel>
                <div
                  className="px-2 pb-2 rounded-lg w-full border border-bkg-4 bg-bkg-3 flex flex-col transition-all duration-300 text-sm text-brand-white border-t-0 rounded-t-none"
                >
                  {Object.values(newRecipients).length && renderAddresses(newRecipients)}
                </div>
              </Disclosure.Panel>

            </>
          )}
        </Disclosure>
      )}

      <div className="bg-bkg-3 fixed gap-x-6 p-4 bottom-0 left-0 text-xs flex justify-between items-center">
        <p>
          Would you like to go to view transaction on SYS Block Explorer?
        </p>

        <Button
          type="button"
          onClick={() => window.open('')}
          className="inline-flex justify-center px-6 py-1 text-sm font-medium hover:text-brand-royalblue text-brand-white bg-transparent border border-brand-white rounded-full hover:bg-button-popuphover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalblue"
        >
          Go
        </Button>
      </div>
    </>
  )
}