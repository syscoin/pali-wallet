import { useFormat, useController, useStore, useUtils } from 'hooks/index';
import React, { useState, useEffect } from 'react';
import { Button } from 'components/Button';
import { Icon } from 'components/Icon';
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
          key={address}
          className="flex justify-between mt-2 items-center gap-x-1 cursor-pointer rounded-lg bg-brand-navydarker hover:bg-brand-navydark transition-all duration-200 border border-solid border-brand-navyborder p-2 text-xs"
        >
          <p
            onClick={() => copyText(address)}
          >
            {ellipsis(address) || '...'}
          </p>

          <small>
            {formatURL(String(Number(value) / 10 ** 8), 18) ? formatURL(String(Number(value) / 10 ** 8), 18) : 0}   {activeNetwork === 'main' ? 'SYS' : 'tSYS'}
          </small>
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
            <div key={label} className="my-1 py-2 px-2 w-full border-b border-dashed border-brand-navydark cursor-default flex justify-between items-center transition-all duration-300 bg-brand-navydarker hover:bg-brand-navydarker text-xs">
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
                className="my-3 p-2 flex justify-between items-center rounded-lg w-full border border-dashed border-brand-navyborder cursor-pointer transition-all duration-300 bg-brand-navydarker text-xs"
              >
                From

                <Icon
                  name="select-up"
                  className={`${open ?
                    'transform rotate-180' :
                    ''
                    } mb-1 text-brand-deepPink100`}
                />
              </Disclosure.Button>


              <Disclosure.Panel>
                <div
                  className="p-2 rounded-lg w-full border border-dashed border-brand-deepPink flex flex-col transition-all duration-300 bg-brand-navydarker text-sm text-brand-white border-t-0 rounded-t-none"
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
                className="my-3 p-2 flex justify-between items-center rounded-lg w-full border border-dashed border-brand-navyborder cursor-pointer transition-all duration-300 bg-brand-navydarker text-xs"
              >
                To

                <Icon
                  name="select-up"
                  className={`${open ?
                    'transform rotate-180' :
                    ''
                    } mb-1 text-brand-deepPink100`}
                />
              </Disclosure.Button>


              <Disclosure.Panel>
                <div
                  className="p-2 rounded-lg w-full flex flex-col transition-all duration-300 bg-brand-navydarker border border-dashed border-brand-royalBlue text-sm text-brand-white border-t-0 rounded-t-none"
                >
                  {Object.values(newRecipients).length && renderAddresses(newRecipients)}
                </div>
              </Disclosure.Panel>

            </>
          )}
        </Disclosure>
      )}

      <div className="bg-brand-navyborder fixed gap-x-6 p-4 bottom-0 left-0 text-xs flex justify-between items-center">
        <p>
          Would you like to go to view transaction on SYS Block Explorer?
        </p>

        <Button
          type="button"
          onClick={() => window.open('')}
          className="inline-flex justify-center px-6 py-1 text-sm font-medium text-brand-royalBlue bg-blue-100 border border-transparent rounded-full hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalBlue"
        >
          Go
        </Button>
      </div>
    </>
  )
}