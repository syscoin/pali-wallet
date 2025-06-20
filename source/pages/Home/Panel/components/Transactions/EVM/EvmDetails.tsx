import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { EvmTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountTransactions,
} from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import {
  camelCaseToText,
  ellipsis,
  removeScientificNotation,
} from 'utils/index';
import { getERC20TransferValue, isERC20Transfer } from 'utils/transactions';

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = memo(() => (
  <Icon
    wrapperClassname="flex items-center justify-center"
    name="copy"
    className="px-1 text-brand-white hover:text-fields-input-borderfocus"
  />
));
CopyIcon.displayName = 'CopyIcon';

export const EvmTransactionDetails = ({ hash }: { hash: string }) => {
  const {
    activeNetwork: { chainId, currency },
  } = useSelector((state: RootState) => state.vault);
  const { coinsList } = useSelector((state: RootState) => state.vaultGlobal);

  // Use proper selectors
  const currentAccount = useSelector(selectActiveAccount);
  const accountTransactions = useSelector(selectActiveAccountTransactions);

  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();
  const { getTxStatusIcons, getTxStatus, getTxType, getTokenSymbol } =
    useTransactionsListConfig();

  const [copied, copy] = useCopyClipboard();

  let isTxCanceled: boolean;
  let isConfirmed: boolean;
  let isTxSent: boolean;
  let transactionTx: any;
  let txValue: number;
  let txSymbol: string;

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.info(t('home.hashCopied'));
  }, [copied, alert, t]);

  const formattedTransaction = [];

  const ethereumTransactions = accountTransactions[TransactionsType.Ethereum][
    chainId
  ] as IEvmTransaction[];

  ethereumTransactions?.forEach((transaction: any) => {
    const tx = { ...transaction };

    tx.value = !!tx.value?.hex ? tx.value?.hex : tx.value;

    if (tx?.hash !== hash) return null;
    const isErc20Tx = isERC20Transfer(tx as any);
    transactionTx = tx;
    txValue = isErc20Tx
      ? Number(getERC20TransferValue(tx as any)) / 1e18
      : parseInt(tx.value, 16) / 1e18;
    txSymbol = getTokenSymbol(isErc20Tx, coinsList, tx, currency);
    isTxCanceled = tx?.isCanceled === true;
    isConfirmed = tx.confirmations > 0;
    isTxSent = tx.direction
      ? tx.direction === 'sent'
      : tx.from.toLowerCase() === currentAccount?.address?.toLowerCase();

    for (const [key, value] of Object.entries(tx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? 'Yes' : 'No';

      const formattedValue = {
        value: typeof value === 'boolean' ? formattedBoolean : value,
        label: formattedKey,
        canCopy: false,
      };

      if (String(value).length >= 20 && key !== 'image') {
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedTransaction.push(formattedValue);
    }
  });

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
                        <CopyIcon />
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
