import { uniqueId } from 'lodash';
import React, { Fragment, memo, useMemo } from 'react';
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
    activeAccount,
    accountAssets,
  } = useSelector((state: RootState) => state.vault);

  // Use proper selectors
  const currentAccount = useSelector(selectActiveAccount);
  const accountTransactions = useSelector(selectActiveAccountTransactions);

  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();
  const { t } = useTranslation();
  // Create token symbol cache from user's assets
  const tokenSymbolCache = useMemo(() => {
    const cache = new Map<string, string>();
    const currentAccountAssets =
      accountAssets[activeAccount.type]?.[activeAccount.id];

    if (currentAccountAssets?.ethereum) {
      currentAccountAssets.ethereum.forEach((token) => {
        if (token.contractAddress && token.tokenSymbol) {
          cache.set(token.contractAddress.toLowerCase(), token.tokenSymbol);
        }
      });
    }

    return cache;
  }, [accountAssets, activeAccount.type, activeAccount.id]);

  const { getTxStatusIcons, getTxStatus, getTxType, getTokenSymbol } =
    useTransactionsListConfig();

  let isTxCanceled: boolean;
  let isConfirmed: boolean;
  let isTxSent: boolean;
  let transactionTx: any;
  let txValue: number;
  let txSymbol: string;

  // Helper function to get appropriate copy message based on field label
  const getCopyMessage = (label: string) => {
    switch (label.toLowerCase()) {
      case 'from':
      case 'to':
        return t('home.addressCopied');
      case 'hash':
      case 'block hash':
      case 'txid':
      case 'transaction id':
        return t('home.hashCopied');
      case 'input': // Hex data
        return t('send.hexDataCopied');
      case 'method':
      case 'function':
      case 'action':
      case 'revert reason':
      case 'success':
      case 'value':
      case 'confirmations':
      case 'timestamp':
      case 'block time':
      case 'gas used':
      case 'gas price':
      case 'max fee per gas':
      case 'max priority fee per gas':
      case 'nonce':
      case 'fees':
      case 'gas limit':
      case 'block number':
        return t('settings.successfullyCopied');
      default:
        return t('settings.successfullyCopied'); // Generic fallback
    }
  };

  // Copy message is now handled inline in the copy button onClick

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
    txSymbol = getTokenSymbol(isErc20Tx, tx, currency, tokenSymbolCache);
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
                      <IconButton
                        onClick={() => {
                          copy(value ?? '');
                          // Show appropriate message immediately
                          alert.info(getCopyMessage(label));
                        }}
                      >
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
