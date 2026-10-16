import React, { Fragment, useEffect, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { UtxoTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { TokenIcon } from 'components/TokenIcon';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import {
  formatSyscoinValue,
  formatDisplayValue,
} from 'utils/formatSyscoinValue';
import { camelCaseToText, ellipsis } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  getSyscoinTransactionTypeLabel,
  getSyscoinTransactionTypeStyle,
  getSyscoinOperationAmount,
  isSyscoinTokenOperation,
  getSyscoinNativeTransferAmount,
  getSyscoinAccountChange,
  formatSyscoinConfirmationETA,
} from 'utils/syscoinTransactionUtils';
import { getTokenLogo } from 'utils/tokens';
import { isTransactionInBlock } from 'utils/transactionUtils';

import {
  mergeAccountOwnershipFlags,
  watchUtxoTransactionDetails,
} from './utxoTransactionDetails';

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = memo(() => (
  <Icon
    wrapperClassname="flex items-center justify-center"
    name="copy"
    className="px-1 text-brand-white hover:text-fields-input-borderfocus"
  />
));
CopyIcon.displayName = 'CopyIcon';

const selectFresherStatusTransaction = (
  accountTransaction: ISysTransaction,
  fullTransaction: ISysTransaction
) => {
  const accountConfirmations = Number(accountTransaction.confirmations ?? -1);
  const fullConfirmations = Number(fullTransaction.confirmations ?? -1);

  return accountConfirmations > fullConfirmations
    ? accountTransaction
    : fullTransaction;
};

const mergeAccountSummaryWithFullTransaction = (
  accountTransaction: ISysTransaction | undefined,
  fullTransaction: ISysTransaction
): ISysTransaction => {
  if (!accountTransaction) return fullTransaction;
  const statusTransaction = selectFresherStatusTransaction(
    accountTransaction,
    fullTransaction
  );

  return {
    ...fullTransaction,
    tokenType: fullTransaction.tokenType ?? accountTransaction.tokenType,
    tokenTransfers:
      fullTransaction.tokenTransfers ?? accountTransaction.tokenTransfers,
    accountAssetTransfers: accountTransaction.accountAssetTransfers,
    addressValueIn: accountTransaction.addressValueIn,
    addressValueOut: accountTransaction.addressValueOut,
    blockHash: statusTransaction.blockHash ?? fullTransaction.blockHash,
    blockHeight: statusTransaction.blockHeight ?? fullTransaction.blockHeight,
    blockTime: statusTransaction.blockTime ?? fullTransaction.blockTime,
    confirmations:
      statusTransaction.confirmations ?? fullTransaction.confirmations,
    confirmationETABlocks:
      fullTransaction.confirmationETABlocks ??
      accountTransaction.confirmationETABlocks,
    confirmationETASeconds:
      fullTransaction.confirmationETASeconds ??
      accountTransaction.confirmationETASeconds,
    direction: accountTransaction.direction,
    vin: mergeAccountOwnershipFlags(
      accountTransaction.vin,
      fullTransaction.vin
    ) as ISysTransaction['vin'],
    vout: mergeAccountOwnershipFlags(
      accountTransaction.vout,
      fullTransaction.vout
    ) as ISysTransaction['vout'],
  };
};

interface ISyscoinTransactionDetailsProps {
  hash: string;
  tx?: ISysTransaction;
}

export const SyscoinTransactionDetails = ({
  hash,
  tx,
}: ISyscoinTransactionDetailsProps) => {
  const { activeNetwork } = useSelector((state: RootState) => state.vault);
  const activeAssets = useSelector(selectActiveAccountAssets);
  const { currency, url: networkUrl } = activeNetwork;
  const normalizedHash = hash.toLowerCase();
  const walletScope = useSelector(getWalletNavigationScope, shallowEqual);
  const scope = `${walletScope.account}:${walletScope.network}:${normalizedHash}`;
  const accountTransaction =
    tx?.txid?.toLowerCase() === normalizedHash ? tx : undefined;
  const { controllerEmitter } = useController();
  const { getTxType, getTxStatus } = useTransactionsListConfig();

  const { useCopyClipboard, alert } = useUtils();
  const { t, i18n } = useTranslation();

  const [enhancedTransaction, setEnhancedTransaction] = useState<{
    data: ISysTransaction;
    scope: string;
  } | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [, copy] = useCopyClipboard();
  const matchingEnhancedTransaction =
    enhancedTransaction?.scope === scope ? enhancedTransaction.data : null;
  // Cache only chain data; always merge the latest account summary at render time.
  const rawTransaction: any = matchingEnhancedTransaction
    ? mergeAccountSummaryWithFullTransaction(
        accountTransaction,
        matchingEnhancedTransaction
      )
    : accountTransaction;
  const tokenIntent = getSyscoinOperationAmount(rawTransaction);
  // Resolve presentation metadata from this account and chain by immutable GUID,
  // never by an issuer-controlled symbol or an unrelated transaction asset.
  const tokenAsset = tokenIntent?.assetGuid
    ? activeAssets.syscoin.find(
        (asset) =>
          String(asset.assetGuid) === String(tokenIntent.assetGuid) &&
          asset.chainId === activeNetwork.chainId
      )
    : undefined;

  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && scopeRef.current === scope;

    if (!hash || !networkUrl) return;
    setEnhancedTransaction(null);
    const stop = watchUtxoTransactionDetails(
      scope,
      hash,
      () =>
        controllerEmitter(
          ['wallet', 'getSysTransactionFromBlockbook'],
          [hash, networkUrl]
        ),
      isCurrent,
      (fullTransaction: ISysTransaction | null) => {
        if (
          isCurrent() &&
          fullTransaction?.txid?.toLowerCase() === normalizedHash
        ) {
          setEnhancedTransaction({ scope, data: fullTransaction });
        }
      },
      (error) => {
        if (isCurrent())
          console.error('Failed to fetch Syscoin transaction details:', error);
      }
    );

    return () => {
      cancelled = true;
      stop();
    };
  }, [hash, networkUrl, scope]);

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
  const nativeIntent = getSyscoinNativeTransferAmount(
    accountTransaction,
    rawTransaction
  );
  const nativeAccountChange = getSyscoinAccountChange(accountTransaction);

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
    isTxCanceled = Boolean((txSource as any)?.isCanceled);
    isConfirmed = isTransactionInBlock(txSource as any);
    isTxSent = (txSource as any)?.direction === 'sent';
    const confirmationETA = !isConfirmed
      ? formatSyscoinConfirmationETA(txSource as any)
      : null;
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

    if (confirmationETA) {
      formattedTransaction.push({
        value: confirmationETA,
        label: 'Estimated Confirmation',
        canCopy: false,
      });
    }

    for (const [key, value] of Object.entries(txSource as any)) {
      const formattedKey = camelCaseToText(key);
      if (key === 'blockHash') {
        const blockHash = typeof value === 'string' ? value : '';
        formattedTransaction.push({
          value: isConfirmed
            ? blockHash || t('settings.unavailable')
            : t('send.pending'),
          label: formattedKey,
          canCopy: isConfirmed && blockHash.length > 0,
        });
        continue;
      }
      if (key === 'blockTime') {
        const blockDate = new Date(Number(value) * 1000);
        formattedTransaction.push({
          value: !isConfirmed
            ? t('send.pending')
            : Number(value) > 0 && Number.isFinite(blockDate.getTime())
            ? blockDate.toLocaleString(i18n?.resolvedLanguage || i18n?.language)
            : t('settings.unavailable'),
          label: formattedKey,
          canCopy: false,
        });
        continue;
      }
      if (key === 'fees') {
        const rawFee = String(value ?? '');
        formattedTransaction.push({
          value: /^\d+$/.test(rawFee)
            ? `${formatSyscoinValue(rawFee)} ${
                currency?.toUpperCase() || 'SYS'
              }`
            : t('settings.unavailable'),
          label: formattedKey,
          canCopy: false,
        });
        continue;
      }
      if (value === undefined || value === null || typeof value === 'object') {
        continue;
      }
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

      formattedTransaction.push(formattedValue);
    }
    // Blockbook omits block fields for some pending rows instead of returning
    // null. Keep that normal REST shape as readable as an explicit empty field.
    if (!isConfirmed) {
      for (const key of ['blockHash', 'blockTime']) {
        if (!Object.prototype.hasOwnProperty.call(txSource, key)) {
          formattedTransaction.push({
            value: t('send.pending'),
            label: camelCaseToText(key),
            canCopy: false,
          });
        }
      }
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
          {accountTransaction
            ? getTxType(rawTransaction, isTxSent)
            : getSyscoinTransactionTypeLabel(rawTransaction?.tokenType)}
        </p>

        {(accountTransaction || isSyscoinTokenOperation(rawTransaction)) && (
          <p className="text-brand-gray200 text-xs mt-1">
            {t(
              nativeIntent?.outputTotal
                ? 'send.selfTransferOutputTotal'
                : 'send.transactionValue'
            )}
          </p>
        )}

        {/* Token operation value is distinct from native account funding. */}
        {(accountTransaction || isSyscoinTokenOperation(rawTransaction)) &&
          (() => {
            const intent = tokenIntent;

            if (intent) {
              const decimals = intent.decimals ?? 8;
              const symbol =
                intent.symbol ?? `SPT (${intent.assetGuid || '?'})`;
              const logo =
                tokenAsset?.image ||
                getTokenLogo(symbol, true, intent.assetGuid);

              return (
                <div className="flex items-center justify-center gap-2 max-w-full">
                  <span
                    className="group relative inline-flex shrink-0 cursor-default"
                    aria-hidden="true"
                  >
                    <TokenIcon
                      key={`${activeNetwork.chainId}:${intent.assetGuid}:${logo}`}
                      assetGuid={intent.assetGuid}
                      logo={logo || undefined}
                      symbol={symbol}
                      size={24}
                      className="shadow-md group-hover:shadow-xl motion-safe:group-hover:scale-110 transition-all duration-200 ease-out motion-reduce:transition-none"
                    />
                    <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none pointer-events-none" />
                  </span>
                  <p className="text-white text-base min-w-0 break-words">
                    {formatDisplayValue(intent.amount, decimals)} {symbol}
                  </p>
                </div>
              );
            }

            // Priority 2: For regular SYS transactions without asset transfers
            return (
              <p className="text-white text-base">
                {isSyscoinTokenOperation(rawTransaction) || !nativeIntent
                  ? t('settings.unavailable')
                  : `${formatSyscoinValue(nativeIntent.amount)} ${
                      currency?.toUpperCase() || 'SYS'
                    }`}
              </p>
            );
          })()}

        {accountTransaction && nativeAccountChange !== null && (
          <p className="text-brand-gray200 text-xs mt-1">
            {t('send.nativeBalanceChange')}:{' '}
            {nativeAccountChange !== '0' && !nativeAccountChange.startsWith('-')
              ? '+'
              : ''}
            {formatSyscoinValue(nativeAccountChange)}{' '}
            {currency?.toUpperCase() || 'SYS'}
          </p>
        )}

        {(() => {
          // Detect SPT tx (either explicit tokenType or vout with assetInfo)
          const normalizedType = getSyscoinTransactionTypeLabel(tokenType);
          const isSptTx = hasTokenInfo || normalizedType !== 'Transaction';

          // Heuristic RBF detection from input sequences:
          // If any input sequence is < 0xfffffffe, opt-in RBF is enabled
          const MAX_SEQ_MINUS_ONE = 0xfffffffe;
          const hasSequenceData =
            Array.isArray(rawTransaction?.vin) &&
            rawTransaction.vin.some((v: any) => typeof v.sequence === 'number');
          const rbfEnabled = Array.isArray(rawTransaction?.vin)
            ? rawTransaction.vin.some(
                (v: any) =>
                  typeof v.sequence === 'number' &&
                  v.sequence < MAX_SEQ_MINUS_ONE
              )
            : false;

          const showZdagConfirmed =
            isSptTx &&
            hasSequenceData &&
            !rbfEnabled &&
            !isTxCanceled &&
            !isConfirmed;
          const confirmationETA = !isConfirmed
            ? formatSyscoinConfirmationETA(rawTransaction)
            : null;

          if (showZdagConfirmed) {
            return (
              <Tooltip
                content={
                  confirmationETA
                    ? `Estimated block confirmation: ${confirmationETA}`
                    : null
                }
              >
                <p className="text-xs font-normal text-brand-green">
                  Z-DAG confirmed
                </p>
              </Tooltip>
            );
          }

          return (
            <Tooltip
              content={
                confirmationETA
                  ? `Estimated confirmation: ${confirmationETA}`
                  : null
              }
            >
              {getTxStatus(isTxCanceled, isConfirmed)}
            </Tooltip>
          );
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
                  {value.length >= 20 && canCopy ? (
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
