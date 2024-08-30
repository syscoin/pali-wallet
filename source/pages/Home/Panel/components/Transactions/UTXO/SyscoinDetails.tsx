import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { UtxoTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import { TransactionsType } from 'state/vault/types';
import { camelCaseToText, ellipsis } from 'utils/index';

export const SyscoinTransactionDetails = ({ hash }: { hash: string }) => {
  const { controllerEmitter } = useController();
  const {
    accounts,
    activeAccount,
    isBitcoinBased,
    activeNetwork: { chainId: activeChainId, url: activeNetworkUrl },
  } = useSelector((state: RootState) => state.vault);
  const { getTxStatus, getTxType } = useTransactionsListConfig();

  const currentAccount = accounts[activeAccount.type][activeAccount.id];

  const { transactions } = accounts[activeAccount.type][activeAccount.id];

  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();

  const [rawTransaction, setRawTransaction] = useState<any>({});
  const [copied, copy] = useCopyClipboard();

  const showSuccessAlert = () => {
    if (copied) {
      alert.removeAll();
      alert.success(t('home.addressCopied'));
    }
  };

  const recipients: any = {};
  const senders: any = {};
  let isTxCanceled: boolean;
  let isConfirmed: boolean;
  let isTxSent: boolean;
  let transactionTx: any;
  let txValue: string;

  const setTx = async () =>
    setRawTransaction(
      await controllerEmitter(
        ['utils', 'getRawTransaction'],
        [activeNetworkUrl, hash]
      )
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
              if (item.addresses) {
                senders[item.addresses[0]] = {
                  address: item.addresses[0],
                  value: item.value ? item.value : '0',
                };
              } else {
                return;
              }
            } else {
              controllerEmitter(
                ['utils', 'getRawTransaction'],
                [activeNetworkUrl, item.txid]
              ).then((response: any) => {
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
      }
    }
  }, [rawTransaction]);

  useEffect(() => {
    showSuccessAlert();
  }, [copied]);

  const formattedTransaction = [];

  const syscoinTransactions = transactions[TransactionsType.Syscoin][
    activeChainId
  ] as ISysTransaction[];

  syscoinTransactions?.find((tx: any) => {
    if (tx.txid !== hash) return null;
    transactionTx = tx;
    txValue = tx?.vout?.[0]?.value || '0';
    isTxCanceled = tx?.isCanceled === true;
    isConfirmed = tx.confirmations > 0;
    isTxSent = isBitcoinBased
      ? false
      : tx.from.toLowerCase() === currentAccount.address;

    const vinAddresses = tx.vin?.[0]?.addresses || [];
    const vinFormattedValue = {
      value: vinAddresses.join(', '),
      label: 'To',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(vinFormattedValue);

    const voutAddress = tx?.vout?.[1]?.addresses || [];
    const voutFormattedValue = {
      value: voutAddress.join(', '),
      label: 'From',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(voutFormattedValue);

    for (const [key, value] of Object.entries(tx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? t('send.yes') : t('send.no');

      const formattedValue = {
        value: typeof value === 'boolean' ? formattedBoolean : value,
        label: formattedKey,
        canCopy: false,
      };

      if (String(value).length >= 20) {
        formattedValue.value = String(value);
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedTransaction.push(formattedValue);
    }

    return formattedTransaction;
  });

  const formattedTransactionDetails = formattedTransaction
    .filter(({ label }) => UtxoTxDetailsLabelsToKeep.includes(label))
    .sort(
      (a, b) =>
        UtxoTxDetailsLabelsToKeep.indexOf(a.label) -
        UtxoTxDetailsLabelsToKeep.indexOf(b.label)
    );

  const RenderTransaction = () => (
    <>
      <div className="flex flex-col justify-center items-center w-full mb-2">
        <p className="text-brand-gray200 text-xs font-light">
          {getTxType(transactionTx, isTxSent)}
        </p>
        <p className="text-white text-base">{Number(txValue) / 10 ** 8} SYS</p>
        <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
      </div>
      {formattedTransactionDetails.map(({ label, value, canCopy }: any) => (
        <Fragment key={uniqueId(hash)}>
          {label.length > 0 && value !== undefined && (
            <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
              <p className="text-xs font-normal text-white">{label}</p>
              <span>
                {value.length >= 20 ? (
                  <Tooltip content={value} childrenClassName="flex">
                    <p className="text-xs font-normal text-white">
                      {ellipsis(value, 2, 4)}
                    </p>
                    {canCopy && (
                      <IconButton onClick={() => copy(value)}>
                        <Icon
                          wrapperClassname="flex items-center justify-center"
                          name="copy"
                          className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                        />
                      </IconButton>
                    )}
                  </Tooltip>
                ) : (
                  <p className="text-xs font-normal text-white">{value}</p>
                )}
              </span>
            </div>
          )}
        </Fragment>
      ))}
    </>
  );

  return <RenderTransaction />;
};
