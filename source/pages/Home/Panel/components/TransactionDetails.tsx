import { useStore, useUtils } from 'hooks/index';
import React, { useState, useEffect } from 'react';
import { Icon, IconButton } from 'components/index';
import { ellipsis, formatDate, formatUrl } from 'utils/index';
import { getController } from 'utils/browser';
import { Disclosure } from '@headlessui/react';

export const TransactionDetails = ({ transactionType, transactionDetails }) => {
  const { activeNetwork } = useStore();
  const { useCopyClipboard, alert } = useUtils();

  const controller = getController();

  const [newRecipients, setNewRecipients] = useState<any>({});
  const [newSenders, setNewSenders] = useState<any>({});
  const [copied, copyText] = useCopyClipboard();

  const showSuccessAlert = () => {
    if (copied) {
      alert.removeAll();
      alert.success('Link successfully copied');
    }
  };

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
              value: item.value,
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
                for (const responseVout of response.vout) {
                  if (responseVout.n === item.vout) {
                    senders[item.addresses[0]] = {
                      address: item.addresses[0],
                      value: item.value,
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
                value: item.value,
              };
            }
          }
        }

        setNewRecipients(recipients);
        setNewSenders(senders);
      }
    }
  }, [transactionDetails]);

  const renderAddresses = (list: any) =>
    Object.values(list).map(({ address, value: addressValue }: any) => (
      <li
        onClick={() => copyText(address)}
        key={address}
        className="flex gap-x-1 items-center justify-between mt-2 p-1 text-xs rounded-lg cursor-pointer transition-all duration-200"
      >
        <p>{ellipsis(address) || '...'}</p>

        <div>
          <small>
            {formatUrl(String(Number(addressValue) / 10 ** 8), 18)
              ? formatUrl(String(Number(addressValue) / 10 ** 8), 18)
              : 0}{' '}
            {activeNetwork === 'main' ? 'SYS' : 'tSYS'}
          </small>

          <IconButton onClick={() => copyText(address)}>
            <Icon
              name="copy"
              className="px-1 text-brand-white hover:text-fields-input-borderfocus"
            />
          </IconButton>
        </div>
      </li>
    ));

  const { blockHash, confirmations, blockTime, valueIn, value, fees } =
    transactionDetails;

  const checkNetwork = (checkValue: any) =>
    activeNetwork === 'main'
      ? `${checkValue / 10 ** 8} SYS`
      : `${checkValue / 10 ** 8} tSYS`;

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
        ? formatDate(new Date(blockTime * 1000).toDateString())
        : '',
    },
    {
      label: 'Total input',
      value: valueIn ? checkNetwork(valueIn) : '',
    },
    {
      label: 'Total output',
      value: value ? checkNetwork(value) : '',
    },
    {
      label: 'Fees',
      value: fees ? checkNetwork(fees) : '',
    },
  ];

  return (
    <>
      {txData.map(({ label, value: currentValue }: any) => (
        <>
          <div
            key={label}
            className="flex items-center justify-between my-1 px-6 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300"
          >
            <p>{label}</p>
            <b>{currentValue}</b>
          </div>
        </>
      ))}

      {Object.values(newSenders).length > 0 && (
        <Disclosure>
          {({ open }) => (
            <>
              <div className="px-6">
                <Disclosure.Button
                  className={`${
                    open ? 'rounded-t-md' : 'rounded-md'
                  } mt-3 py-2 px-2 flex justify-between items-center  w-full border border-bkg-3 bg-bkg-1 cursor-pointer transition-all duration-300 text-xs`}
                >
                  From
                  <Icon
                    name="select-down"
                    className={`${
                      open ? 'transform rotate-180' : ''
                    } mb-1 text-brand-white`}
                  />
                </Disclosure.Button>
              </div>

              <Disclosure.Panel>
                <div className="px-6">
                  <div className="flex flex-col pb-2 px-2 w-full text-brand-white text-sm bg-bkg-3 border border-t-0 border-bkg-4 rounded-lg rounded-t-none transition-all duration-300">
                    {Object.values(newSenders).length &&
                      renderAddresses(newSenders)}
                  </div>
                </div>
              </Disclosure.Panel>
            </>
          )}
        </Disclosure>
      )}

      {Object.values(newRecipients).length > 0 && (
        <Disclosure>
          {({ open }) => (
            <>
              <div className="px-6">
                <Disclosure.Button
                  className={`${
                    open ? 'rounded-t-md' : 'rounded-md'
                  } mt-3 py-2 px-2 flex justify-between items-center  w-full border border-bkg-3 bg-bkg-1 cursor-pointer transition-all duration-300 text-xs`}
                >
                  To
                  <Icon
                    name="select-down"
                    className={`${
                      open ? 'transform rotate-180' : ''
                    } mb-1 text-brand-white`}
                  />
                </Disclosure.Button>
              </div>

              <div className="px-6">
                <Disclosure.Panel>
                  <div className="flex flex-col pb-2 px-2 w-full text-brand-white text-sm bg-bkg-3 border border-t-0 border-bkg-4 rounded-lg rounded-t-none transition-all duration-300">
                    {Object.values(newRecipients).length &&
                      renderAddresses(newRecipients)}
                  </div>
                </Disclosure.Panel>
              </div>
            </>
          )}
        </Disclosure>
      )}

      {copied && showSuccessAlert()}
    </>
  );
};
