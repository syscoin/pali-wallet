import { Disclosure } from '@headlessui/react';
import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { camelCaseToText, ellipsis, truncate } from 'utils/index';

export const SyscoinTransactionDetails = ({ hash }: { hash: string }) => {
  const controller = getController();
  const transactions = useSelector(
    (state: RootState) => state.vault.activeAccount.transactions
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { useCopyClipboard, alert } = useUtils();

  const [newRecipients, setNewRecipients] = useState<any>({});
  const [newSenders, setNewSenders] = useState<any>({});
  const [rawTransaction, setRawTransaction] = useState<any>({});
  const [copied, copy] = useCopyClipboard();

  const showSuccessAlert = () => {
    if (copied) {
      alert.removeAll();
      alert.success('Address successfully copied');
    }
  };

  const recipients: any = {};
  const senders: any = {};

  const setTx = async () =>
    setRawTransaction(
      await controller.utils.getRawTransaction(activeNetwork.url, hash)
    );

  useEffect(() => {
    setTx();
  }, [hash]);

  useEffect(() => {
    if (rawTransaction) {
      const { vin, vout } = rawTransaction;

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

            controller.utils
              .getRawTransaction(activeNetwork.url, item.txid)
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
  }, [rawTransaction]);

  const renderAddresses = (list: any) =>
    Object.values(list).map(({ address, value: addressValue }: any) => (
      <li
        onClick={() => copy(address)}
        key={uniqueId(hash)}
        className="flex gap-x-1 items-center justify-between mt-2 p-1 text-xs rounded-lg cursor-pointer transition-all duration-200"
      >
        <p>{ellipsis(address) || '...'}</p>

        <div>
          <small>
            {truncate(String(Number(addressValue) / 10 ** 8), 18)
              ? truncate(String(Number(addressValue) / 10 ** 8), 18)
              : 0}{' '}
            {activeNetwork.chainId === 57 ? 'SYS' : 'tSYS'}
          </small>

          <IconButton onClick={() => copy(address)}>
            <Icon
              name="copy"
              className="px-1 text-brand-white hover:text-fields-input-borderfocus"
            />
          </IconButton>
        </div>
      </li>
    ));

  const renderAssetsDisclosure = (sender: boolean) => {
    const list = sender ? newSenders : newRecipients;

    return (
      <Disclosure>
        {({ open }) => (
          <>
            <div className="px-6">
              <Disclosure.Button
                className={`${
                  open ? 'rounded-t-md' : 'rounded-md'
                } mt-3 py-2 px-2 flex justify-between items-center  w-full border border-bkg-3 bg-bkg-1 cursor-pointer transition-all duration-300 text-xs`}
              >
                {sender ? 'From' : 'To'}
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
                  {Object.values(list).length && renderAddresses(list)}
                </div>
              </Disclosure.Panel>
            </div>
          </>
        )}
      </Disclosure>
    );
  };

  const formattedTransaction = [];

  transactions.find((tx: any) => {
    if (tx.txid !== hash) return null;

    for (const [key, value] of Object.entries(tx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? 'Yes' : 'No';

      const formattedValue = {
        value: typeof value === 'boolean' ? formattedBoolean : value,
        label: formattedKey,
        canCopy: false,
      };

      if (String(value).length >= 20) {
        formattedValue.value = truncate(String(value), 20);
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedTransaction.push(formattedValue);
    }

    return formattedTransaction;
  });

  const RenderTransaction = () => (
    <>
      {formattedTransaction.map(({ label, value, canCopy }: any) => (
        <Fragment key={uniqueId(hash)}>
          {label.length > 0 && value !== undefined && (
            <li className="flex items-center justify-between my-1 px-6 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
              <p>{label}</p>
              <span>
                <b>{value}</b>

                {canCopy && (
                  <IconButton onClick={() => copy(value ?? '')}>
                    <Icon
                      name="copy"
                      className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                    />
                  </IconButton>
                )}
              </span>
            </li>
          )}
        </Fragment>
      ))}

      {renderAssetsDisclosure(false)}
      {renderAssetsDisclosure(true)}

      {copied && showSuccessAlert()}
    </>
  );

  return <RenderTransaction />;
};
