import { formatUnits } from '@ethersproject/units';
import React, { Fragment, useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { UtxoTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountTransactions,
} from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';
import { camelCaseToText, ellipsis } from 'utils/index';
import {
  getSyscoinTransactionTypeLabel,
  getSyscoinTransactionTypeStyle,
  isMintOrBurnTransaction,
  normalizeSyscoinTransactionType,
} from 'utils/syscoinTransactionUtils';
import { isTransactionInBlock } from 'utils/transactionUtils';

// UTXO transaction details cache with TTL (5 minutes - consistent with EVM)
const utxoTxDetailsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = memo(() => (
  <Icon
    wrapperClassname="flex items-center justify-center"
    name="copy"
    className="px-1 text-brand-white hover:text-fields-input-borderfocus"
  />
));
CopyIcon.displayName = 'CopyIcon';

interface ISyscoinTransactionDetailsProps {
  hash: string;
}

export const SyscoinTransactionDetails = ({
  hash,
}: ISyscoinTransactionDetailsProps) => {
  const { controllerEmitter } = useController();
  const {
    activeNetwork: { chainId, url: activeNetworkUrl, currency },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);
  const { getTxType, getTxStatus } = useTransactionsListConfig();
  // Use proper selector
  const accountTransactions = useSelector(selectActiveAccountTransactions);
  const activeAccount = useSelector(selectActiveAccount);

  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();

  const [rawTransaction, setRawTransaction] = useState<any>({});
  const [, copy] = useCopyClipboard();

  // Helper function to get appropriate copy message based on field label
  const getCopyMessage = (label: string) => {
    switch (label.toLowerCase()) {
      case 'from':
      case 'to':
        return t('home.addressCopied');
      case 'txid':
      case 'hash':
      case 'transaction id':
      case 'block hash':
        return t('home.hashCopied');
      case 'input': // Hex data
        return t('send.hexDataCopied');
      case 'method':
      case 'function':
      case 'action':
      case 'confirmations':
      case 'block time':
      case 'fees':
      case 'value':
      case 'success':
        return t('settings.successfullyCopied');
      default:
        return t('settings.successfullyCopied');
    }
  };

  const handleCopyWithMessage = (value: string, label: string) => {
    copy(value);

    alert.info(getCopyMessage(label));
  };

  const recipients: any = {};
  const senders: any = {};
  let isTxCanceled: boolean;
  let isConfirmed: boolean;
  let isTxSent: boolean;
  let transactionTx: any;
  let txValue: number;

  const setTx = async () => {
    // First check if transaction exists in state with all needed data
    const syscoinTxs =
      accountTransactions[TransactionsType.Syscoin]?.[chainId] || [];
    const existingTx = syscoinTxs.find((tx: any) => tx.txid === hash);

    // If we have the transaction with full data (vin, vout, tokenType, etc), use it
    if (existingTx && existingTx.vin && existingTx.vout) {
      setRawTransaction(existingTx);
      // Also cache it for consistency
      utxoTxDetailsCache.set(hash, {
        data: existingTx,
        timestamp: Date.now(),
      });
      return;
    }

    // Check cache if not in state
    const cached = utxoTxDetailsCache.get(hash);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setRawTransaction(cached.data);
      return;
    }

    // Only fetch if we don't have the transaction or it's missing details
    try {
      const rawTxData: any = await controllerEmitter(
        ['wallet', 'getRawTransaction'],
        [activeNetworkUrl, hash]
      );

      // Cache the result
      utxoTxDetailsCache.set(hash, {
        data: rawTxData,
        timestamp: Date.now(),
      });

      setRawTransaction(rawTxData);
    } catch (error) {
      console.error('Failed to fetch UTXO transaction details:', error);
    }
  };

  useEffect(() => {
    setTx();
  }, [hash, chainId, accountTransactions]);

  useEffect(() => {
    if (rawTransaction) {
      const { vin, vout } = rawTransaction;

      // Process vins and vouts (with array checks)
      if (Array.isArray(vout)) {
        for (const voutItem of vout) {
          if (!voutItem.addresses) continue;
          for (const address of voutItem.addresses) {
            if (!recipients[address]) {
              recipients[address] = 0;
            }
            recipients[address] += voutItem.value;
          }
        }
      }

      if (Array.isArray(vin)) {
        for (const vinItem of vin) {
          if (!vinItem.addresses) continue;
          for (const address of vinItem.addresses) {
            if (!senders[address]) {
              senders[address] = 0;
            }
            senders[address] += vinItem.value;
          }
        }
      }
    }
  }, [rawTransaction]);

  // Get transaction from state
  const syscoinTransactions =
    accountTransactions[TransactionsType.Syscoin]?.[chainId] || [];

  const formattedTransaction: {
    canCopy: boolean;
    label: string;
    value: string;
  }[] = [];

  // Extract SPT information from raw transaction
  const tokenTransfers = rawTransaction?.tokenTransfers || [];
  const tokenType = rawTransaction?.tokenType;

  // Extract asset info from vins and vouts (with array checks)
  const vinAssetInfo = Array.isArray(rawTransaction?.vin)
    ? rawTransaction.vin.find((v: any) => v.assetInfo)?.assetInfo
    : undefined;
  const voutAssetInfo = Array.isArray(rawTransaction?.vout)
    ? rawTransaction.vout.find((v: any) => v.assetInfo)?.assetInfo
    : undefined;
  const assetInfo = vinAssetInfo || voutAssetInfo;

  const hasTokenInfo = tokenTransfers.length > 0 || tokenType || assetInfo;

  syscoinTransactions?.find((tx: any) => {
    if (tx.txid !== hash) return null;
    transactionTx = tx;
    txValue = tx?.vout?.[0]?.value || 0;
    isTxCanceled = tx?.isCanceled === true;
    isConfirmed = isTransactionInBlock(tx);
    isTxSent = isBitcoinBased
      ? false
      : tx.from.toLowerCase() === activeAccount.address.toLowerCase();

    const vinAddresses = tx.vin?.[0]?.addresses || [];
    const vinFormattedValue = {
      value: vinAddresses.join(', '),
      label: 'From',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(vinFormattedValue);

    const voutAddress = tx?.vout?.[0]?.addresses || [];
    const voutFormattedValue = {
      value: voutAddress.join(', '),
      label: 'To',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(voutFormattedValue);

    for (const [key, value] of Object.entries(tx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? t('send.yes') : t('send.no');

      const formattedValue = {
        value: typeof value === 'boolean' ? formattedBoolean : String(value),
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

  // Handle case where transaction doesn't exist (e.g., pending tx not in blockchain)
  if (!rawTransaction && !transactionTx) {
    return (
      <div className="p-8 text-center">
        <p className="text-brand-gray200 text-sm mb-4">
          {t('transactions.transactionNotFoundOrPending')}
        </p>
        <p className="text-xs text-brand-gray400">
          {t('transactions.transactionMayNotExistYet')}
        </p>
      </div>
    );
  }

  const RenderTransaction = () => (
    <>
      <div className="flex flex-col justify-center items-center w-full mb-2">
        <p className="text-brand-gray200 text-xs font-light">
          {hasTokenInfo && tokenType
            ? getSyscoinTransactionTypeLabel(tokenType)
            : getTxType(transactionTx, isTxSent)}
        </p>

        {/* Display token transfers if available */}
        {tokenTransfers.length > 0 ? (
          <div className="text-center">
            {tokenTransfers.map((transfer: any, index: number) => {
              let displayStr = '';

              // For mint and burn transactions, use the appropriate value
              if (isMintOrBurnTransaction(tokenType)) {
                const normalizedType =
                  normalizeSyscoinTransactionType(tokenType);

                // Special case: For SYS → SYSX, the minted amount is in the OP_RETURN
                if (normalizedType === 'syscoinburntoallocation') {
                  // Find the OP_RETURN output (usually first output)
                  const opReturnOutput = Array.isArray(rawTransaction?.vout)
                    ? rawTransaction.vout.find((v: any) =>
                        v.addresses?.[0]?.startsWith('OP_RETURN')
                      )
                    : undefined;

                  if (opReturnOutput?.value) {
                    // The value is in satoshis, use proper utility to format
                    const formattedAmount = formatSyscoinValue(
                      opReturnOutput.value
                    );
                    displayStr = `${formattedAmount} ${
                      transfer.symbol || 'SYSX'
                    }`;
                  }
                } else {
                  // For all other mint/burn types, use the first vout with asset info
                  const firstVoutWithAsset = Array.isArray(rawTransaction?.vout)
                    ? rawTransaction.vout.find(
                        (v: any) =>
                          v.assetInfo &&
                          v.assetInfo.assetGuid === transfer.token
                      )
                    : undefined;

                  if (firstVoutWithAsset?.assetInfo?.valueStr) {
                    displayStr = firstVoutWithAsset.assetInfo.valueStr;
                  }
                }
              }

              // Fallback to transfer value if no displayStr found
              if (!displayStr && transfer.valueOut) {
                displayStr = `${parseFloat(
                  formatUnits(transfer.valueOut, transfer.decimals || 8)
                ).toFixed(4)} ${transfer.symbol || 'Unknown'}`;
              }

              return (
                <div key={index} className="mb-1">
                  <p className="text-white text-base">{displayStr || '0'}</p>
                  {transfer.name && (
                    <p className="text-brand-gray200 text-xs">
                      {transfer.name}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : assetInfo ? (
          // Display asset info from vins/vouts if available
          <div className="text-center">
            <p className="text-white text-base">
              {assetInfo.valueStr ||
                `${parseFloat(formatUnits(assetInfo.value || '0', 8)).toFixed(
                  4
                )} Asset`}
            </p>
            <p className="text-brand-gray200 text-xs">
              {t('send.assetGuid')}: {assetInfo.assetGuid}
            </p>
          </div>
        ) : (
          <p className="text-white text-base">
            {formatSyscoinValue(txValue)} {currency?.toUpperCase() || 'SYS'}
          </p>
        )}

        <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
      </div>

      {/* Add token type as a detail if present */}
      {tokenType && (
        <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
          <p className="text-xs font-normal text-white">Transaction Type</p>
          {(() => {
            const sptInfo = getSyscoinTransactionTypeStyle(tokenType);
            return (
              <div
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-all duration-200 hover:scale-105 hover:brightness-110 cursor-default"
                style={sptInfo.bgStyle}
              >
                <span className="text-xs">{sptInfo.icon}</span>
                <span className="text-xs font-medium text-white">
                  {sptInfo.label}
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Add token info as details if present */}
      {tokenTransfers.length > 0 &&
        tokenTransfers.map((transfer: any, index: number) => (
          <Fragment key={`token-${index}`}>
            {transfer.token && (
              <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
                <p className="text-xs font-normal text-white">
                  {t('send.assetGuid')}
                </p>
                <span className="flex items-center">
                  <Tooltip content={transfer.token} childrenClassName="flex">
                    <p className="text-xs font-normal text-white">
                      {transfer.token.length > 12
                        ? ellipsis(transfer.token, 6, 6)
                        : transfer.token}
                    </p>
                    <IconButton
                      onClick={() =>
                        handleCopyWithMessage(transfer.token, 'Asset Guid')
                      }
                    >
                      <CopyIcon />
                    </IconButton>
                  </Tooltip>
                </span>
              </div>
            )}
          </Fragment>
        ))}

      {/* Add asset info from vins/vouts if present and not already shown */}
      {assetInfo && tokenTransfers.length === 0 && assetInfo.assetGuid && (
        <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
          <p className="text-xs font-normal text-white">
            {t('send.assetGuid')}
          </p>
          <span className="flex items-center">
            <Tooltip content={assetInfo.assetGuid} childrenClassName="flex">
              <p className="text-xs font-normal text-white">
                {assetInfo.assetGuid.length > 12
                  ? ellipsis(assetInfo.assetGuid, 6, 6)
                  : assetInfo.assetGuid}
              </p>
              <IconButton
                onClick={() =>
                  handleCopyWithMessage(assetInfo.assetGuid, 'Asset Guid')
                }
              >
                <CopyIcon />
              </IconButton>
            </Tooltip>
          </span>
        </div>
      )}

      {formattedTransactionDetails.map(
        ({ label, value, canCopy }: any, index: number) => (
          <Fragment key={`${hash}-${label}-${index}`}>
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
                          onClick={() => handleCopyWithMessage(value, label)}
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
        )
      )}
    </>
  );

  return <RenderTransaction />;
};
