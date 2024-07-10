import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { EvmTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { TransactionsType } from 'state/vault/types';
import {
  camelCaseToText,
  ellipsis,
  removeScientificNotation,
} from 'utils/index';
import { getERC20TransferValue, isERC20Transfer } from 'utils/transactions';

export const EvmTransactionDetails = ({ hash }: { hash: string }) => {
  const {
    accounts,
    activeAccount,
    isBitcoinBased,
    activeNetwork: { chainId, currency },
    coinsList,
  } = useSelector((state: RootState) => state.vault);

  const currentAccount = accounts[activeAccount.type][activeAccount.id];
  const [isTxCanceled, setIsTxCanceled] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isTxSent, setIsTxSent] = useState(false);
  const [transactionTx, setTransactionTx] = useState(null);
  const [txValue, setTxValue] = useState<any>();
  const [txSymbol, setTxSymbol] = useState<any>('');
  const [formattedTransaction, setFormattedTransaction] = useState([]);
  const { transactions } = accounts[activeAccount.type][activeAccount.id];
  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();
  const { getTxStatusIcons, getTxStatus, getTxType } =
    useTransactionsListConfig();

  const [copied, copy] = useCopyClipboard();
  const getTokenSymbol = (isErc20Tx: boolean, tx: any) => {
    if (isErc20Tx) {
      const token = coinsList.find((coin) =>
        Object.values(coin?.platforms || {})?.includes(tx?.to)
      );

      if (token) {
        return `${token?.symbol}`.toUpperCase();
      }

      return `${currency || 'SYS'}`.toUpperCase();
    }

    return `${currency || 'SYS'}`.toUpperCase();
  };

  useEffect(() => {
    if (copied) {
      alert.removeAll();
      alert.success(t('home.hashCopied'));
    }
  }, [copied, t]);

  useEffect(() => {
    const ethereumTransactions: any =
      transactions[TransactionsType.Ethereum][chainId];

    if (ethereumTransactions) {
      const foundTransaction = ethereumTransactions?.find((tx: any) => {
        if (tx.value && tx.value === 'object') {
          setTxValue(tx.value?.hex);
        } else {
          setTxValue(tx.value);
        }

        if (tx?.hash !== hash) return false;

        const isErc20Tx = isERC20Transfer(tx);
        setTransactionTx(tx);
        setTxValue(
          isErc20Tx
            ? Number(getERC20TransferValue(tx)) / 1e18
            : parseInt(tx.value, 16) / 1e18
        );
        setTxSymbol(getTokenSymbol(isErc20Tx, tx));
        setIsTxCanceled(tx?.isCanceled === true);
        setIsConfirmed(tx.confirmations > 0);
        setIsTxSent(
          isBitcoinBased
            ? false
            : tx.from.toLowerCase() === currentAccount.address
        );

        const formattedTransactionList = [];

        for (const [key, value] of Object.entries(tx)) {
          const formattedKey = camelCaseToText(key);
          const formattedBoolean = Boolean(value) ? 'Yes' : 'No';
          const formattedValue = {
            value: typeof value === 'boolean' ? formattedBoolean : value,
            label: formattedKey,
            canCopy: String(value).length >= 20 && key !== 'image',
          };
          if (typeof value !== 'object')
            formattedTransactionList.push(formattedValue);
        }

        setFormattedTransaction(formattedTransactionList);
        return true;
      });

      if (!foundTransaction) {
        setTransactionTx(null);
        setFormattedTransaction([]);
      }
    }
  }, [transactions, chainId, hash, isBitcoinBased, currentAccount]);

  const formattedTransactionDetails = formattedTransaction
    .filter(({ label }) => EvmTxDetailsLabelsToKeep.includes(label))
    .sort(
      (a, b) =>
        EvmTxDetailsLabelsToKeep.indexOf(a.label) -
        EvmTxDetailsLabelsToKeep.indexOf(b.label)
    );

  const RenderTransaction = () => (
    <>
      <div className="flex flex-col justify-center items-center w-full mb-2">
        {getTxStatusIcons(getTxType(transactionTx, isTxSent), true)}
        <p className="text-brand-gray200 text-xs font-light">
          {getTxType(transactionTx, isTxSent)}
        </p>
        <p className="text-white text-base">
          {removeScientificNotation(Number(txValue))} {txSymbol}
        </p>
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
                      <IconButton onClick={() => copy(value ?? '')}>
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
