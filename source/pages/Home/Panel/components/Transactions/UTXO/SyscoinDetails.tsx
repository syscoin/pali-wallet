import React, { Fragment, useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { UtxoTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import {
  formatSyscoinValue,
  formatDisplayValue,
} from 'utils/formatSyscoinValue';
import { camelCaseToText, ellipsis } from 'utils/index';
import {
  getSyscoinTransactionTypeLabel,
  getSyscoinTransactionTypeStyle,
  getSyscoinIntentAmount,
} from 'utils/syscoinTransactionUtils';
import { isTransactionInBlock } from 'utils/transactionUtils';

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
  tx: ISysTransaction;
}

export const SyscoinTransactionDetails = ({
  hash,
  tx,
}: ISyscoinTransactionDetailsProps) => {
  const {
    activeNetwork: { currency },
  } = useSelector((state: RootState) => state.vault);
  const { getTxType, getTxStatus } = useTransactionsListConfig();
  const activeAccountAssets = useSelector(selectActiveAccountAssets);

  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();

  const [rawTransaction] = useState<any>(tx);
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
  let txValue: number = 0;

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

  // Build formatted details from the active raw transaction (prefer passed tx)

  const formattedTransaction: {
    canCopy: boolean;
    label: string;
    value: string;
  }[] = [];

  // Extract SPT information from raw transaction
  const tokenTransfers = rawTransaction?.tokenTransfers || [];
  const tokenType = rawTransaction?.tokenType;

  // Simple extraction of first asset from vout for single clear intent
  const firstAssetInfo = rawTransaction?.vout?.find(
    (v: any) => v.assetInfo
  )?.assetInfo;
  const hasAssetInfo = Boolean(firstAssetInfo);

  const hasTokenInfo = tokenTransfers.length > 0 || tokenType || hasAssetInfo;

  const txSource =
    rawTransaction && (rawTransaction as any).txid ? rawTransaction : null;
  if (txSource) {
    txValue = (txSource as any)?.vout?.[0]?.value || 0;
    isTxCanceled = Boolean((txSource as any)?.isCanceled);
    isConfirmed = isTransactionInBlock(txSource as any);
    isTxSent = false;
    const vinAddresses = (txSource as any).vin?.[0]?.addresses || [];
    const vinFormattedValue = {
      value: vinAddresses.join(', '),
      label: 'From',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(vinFormattedValue);

    const voutAddress = (txSource as any)?.vout?.[0]?.addresses || [];
    const voutFormattedValue = {
      value: voutAddress.join(', '),
      label: 'To',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(voutFormattedValue);

    for (const [key, value] of Object.entries(txSource as any)) {
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
  }

  const formattedTransactionDetails = formattedTransaction
    .filter(({ label }) => UtxoTxDetailsLabelsToKeep.includes(label))
    .sort(
      (a, b) =>
        UtxoTxDetailsLabelsToKeep.indexOf(a.label) -
        UtxoTxDetailsLabelsToKeep.indexOf(b.label)
    );

  // Handle case where transaction doesn't exist (e.g., pending tx not in blockchain)
  if (!rawTransaction) {
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
          {getTxType(rawTransaction, isTxSent)}
        </p>

        {/* Display transaction amount */}
        {(() => {
          // Priority 1: Use assetInfo-based calculation with single clear intent
          if (hasAssetInfo) {
            const intent = getSyscoinIntentAmount(rawTransaction);

            if (intent) {
              // Look up asset from vault's assets for accurate symbol and decimals
              const assetInfo = activeAccountAssets?.syscoin?.find(
                (asset: any) => asset.assetGuid === intent.assetGuid
              );

              // Use asset info from vault if available, otherwise fallback
              const symbol =
                assetInfo?.symbol ||
                (intent.assetGuid === '123456'
                  ? 'SYSX'
                  : `Asset ${intent.assetGuid.slice(0, 6)}`);
              const decimals = assetInfo?.decimals || 8;

              return (
                <p className="text-white text-base">
                  {formatDisplayValue(intent.amount, decimals)} {symbol}
                </p>
              );
            }
          }

          // Priority 2: For regular SYS transactions without asset transfers
          return (
            <p className="text-white text-base">
              {formatSyscoinValue(txValue)} {currency?.toUpperCase() || 'SYS'}
            </p>
          );
        })()}

        {(() => {
          // Detect SPT tx (either explicit tokenType or vout with assetInfo)
          const normalizedType = getSyscoinTransactionTypeLabel(tokenType);
          const isSptTx = hasTokenInfo || normalizedType !== 'Transaction';

          // Heuristic RBF detection from input sequences:
          // If any input sequence is < 0xfffffffe, opt-in RBF is enabled
          const MAX_SEQ_MINUS_ONE = 0xfffffffe;
          const rbfEnabled = Array.isArray(rawTransaction?.vin)
            ? rawTransaction.vin.some(
                (v: any) =>
                  typeof v.sequence === 'number' &&
                  v.sequence < MAX_SEQ_MINUS_ONE
              )
            : false;

          const showZdagConfirmed =
            isSptTx && !rbfEnabled && !isTxCanceled && !isConfirmed;

          if (showZdagConfirmed) {
            return (
              <p className="text-xs font-normal text-brand-green">
                Z-DAG confirmed
              </p>
            );
          }

          return getTxStatus(isTxCanceled, isConfirmed);
        })()}
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
