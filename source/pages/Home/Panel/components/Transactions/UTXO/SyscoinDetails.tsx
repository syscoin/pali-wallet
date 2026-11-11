import React, {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { readHistoryCount } from '../../../../../../shared/blockbookAccountHistory';
import { parseSyscoinAssetGuid } from '../../../../../../shared/syscoinAssetIds';
import {
  boundUtxoActivityParticipants,
  type UtxoActivityParticipants,
} from '../../../../../../shared/utxoActivityParticipants';
import {
  bindUtxoDetailObservation,
  isSerializedUtxoObservation,
  UTXO_DETAIL_OBSERVATION,
  type UtxoSummaryStatus,
} from '../../../../../../shared/utxoDetailFreshness';
import {
  getSendingAddresses,
  getReceivingAddresses,
  mergeAccountSummaryWithFullTransaction,
} from '../../../../../../shared/utxoTransactionDetails';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { TokenIcon } from 'components/TokenIcon';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import type {
  ISysTransaction,
  UtxoActivityDetailsReply,
} from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';
import { ellipsis } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  getSyscoinActivityAssetLabel,
  getSyscoinTransactionTypeLabel,
  getSyscoinTransactionTypeStyle,
  getSyscoinOperationAmount,
  formatSyscoinTokenAmount,
  isSyscoinTokenOperation,
  getSyscoinNativeTransferAmount,
  getSyscoinAccountChange,
  formatSyscoinConfirmationETA,
  hasNonReplaceableUtxoSequences,
} from 'utils/syscoinTransactionUtils';
import { getTokenLogo } from 'utils/tokens';
import {
  translateConfirmationEta,
  translateTransactionLabel,
  translateTransactionType,
} from 'utils/transactionDisplay';
import { isTransactionInBlock } from 'utils/transactionUtils';

import {
  getUtxoSummaryObservation,
  watchUtxoTransactionDetails,
  type UtxoActivityDetailRead,
} from './utxoTransactionDetails';

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = memo(() => (
  <Icon
    wrapperClassname="flex items-center justify-center"
    name="copy"
    className="px-1 text-brand-white hover:text-content-accent"
  />
));
CopyIcon.displayName = 'CopyIcon';

interface ISyscoinTransactionDetailsProps {
  hash: string;
  routeSummaryObservation?: UtxoSummaryStatus;
  tx?: ISysTransaction;
}

export const SyscoinTransactionDetails = ({
  hash,
  tx,
  routeSummaryObservation,
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

  const { alert } = useUtils();
  const { t, i18n } = useTranslation();

  const [enhancedTransaction, setEnhancedTransaction] = useState<{
    data: ISysTransaction;
    scope: string;
  } | null>(null);
  const [compactParticipants, setCompactParticipants] = useState<{
    data: UtxoActivityParticipants;
    key: string;
    scope: string;
  } | null>(null);
  const compact = useMemo(() => {
    const candidates =
      accountTransaction &&
      boundUtxoActivityParticipants({
        from: getSendingAddresses(accountTransaction),
        to: getReceivingAddresses(accountTransaction),
      });
    return candidates ? { candidates, key: JSON.stringify(candidates) } : null;
  }, [accountTransaction]);
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const copyContextRef = useRef({ active: true, sequence: 0 });
  useEffect(() => {
    copyContextRef.current.active = true;
    return () => {
      copyContextRef.current.active = false;
      copyContextRef.current.sequence += 1;
    };
  }, [scope]);
  const observation = getUtxoSummaryObservation(accountTransaction);
  const observationRef = useRef({
    summary: observation,
    routeSummary: routeSummaryObservation,
  });
  observationRef.current = {
    summary: observation,
    routeSummary: routeSummaryObservation,
  };
  const matchingEnhancedTransaction =
    enhancedTransaction?.scope === scope ? enhancedTransaction : null;
  // Cache only chain data; always merge the latest account summary at render time.
  const rawTransaction: any = matchingEnhancedTransaction
    ? mergeAccountSummaryWithFullTransaction(
        accountTransaction,
        matchingEnhancedTransaction.data,
        observation?.revision ?? observation?.facts
      )
    : accountTransaction;
  const tokenIntent = getSyscoinOperationAmount(rawTransaction);
  // Resolve presentation metadata from this account and chain by immutable GUID,
  // never by an issuer-controlled symbol or an unrelated transaction asset.
  const intentGuid = parseSyscoinAssetGuid(tokenIntent?.assetGuid);
  const tokenAsset = intentGuid
    ? activeAssets.syscoin.find(
        (asset) =>
          parseSyscoinAssetGuid(asset.assetGuid) === intentGuid &&
          asset.chainId === activeNetwork.chainId
      )
    : undefined;
  const tokenSymbol = getSyscoinActivityAssetLabel(
    intentGuid,
    tokenAsset?.symbol
  );

  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && scopeRef.current === scope;

    if (!hash || !networkUrl) return;
    setEnhancedTransaction(null);
    const stop = watchUtxoTransactionDetails(
      scope,
      hash,
      async () => {
        const summaryAtRead = observationRef.current;
        const candidate = compactRef.current;
        const result = (await controllerEmitter(
          ['wallet', 'getSysTransactionFromBlockbook'],
          [
            hash,
            networkUrl,
            {
              scope: walletScope,
              compact: candidate
                ? { ...candidate.candidates, txid: normalizedHash }
                : null,
            },
          ]
        )) as UtxoActivityDetailsReply | null;
        if (result?.txid !== normalizedHash) return null;
        const data = result.transaction;
        if (!data || typeof data !== 'object' || Array.isArray(data))
          return {
            txid: normalizedHash,
            transaction: null,
            compact:
              candidate && result.compact
                ? { key: candidate.key, data: result.compact }
                : null,
          };
        const { [UTXO_DETAIL_OBSERVATION]: dispatch, ...body } =
          data as ISysTransaction & {
            [UTXO_DETAIL_OBSERVATION]?: unknown;
          };
        return {
          txid: body.txid,
          transaction: bindUtxoDetailObservation(body, {
            ...summaryAtRead,
            dispatch: isSerializedUtxoObservation(dispatch)
              ? dispatch
              : undefined,
          }),
          compact: null,
        };
      },
      isCurrent,
      (detail: UtxoActivityDetailRead | null) => {
        if (!isCurrent() || !detail) return;
        if (detail.transaction)
          setEnhancedTransaction({ scope, data: detail.transaction });
        else if (
          detail.compact &&
          detail.compact.key === compactRef.current?.key
        )
          setCompactParticipants({ scope, ...detail.compact });
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
  }, [hash, networkUrl, normalizedHash, scope, walletScope]);

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

  const handleCopyWithMessage = async (value: string, label: string) => {
    if (!copyContextRef.current.active || scopeRef.current !== scope) return;
    const sequence = ++copyContextRef.current.sequence;
    const isCurrent = () =>
      copyContextRef.current.active &&
      scopeRef.current === scope &&
      copyContextRef.current.sequence === sequence;
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent()) alert.info(getCopyMessage(label));
    } catch {
      if (isCurrent()) alert.error(t('transactions.copyFailed'));
    }
  };

  const isTxCanceled = rawTransaction?.isCanceled === true;
  const isConfirmed = isTransactionInBlock(rawTransaction);
  const isTxSent = rawTransaction?.direction === 'sent';
  const etaSeconds = readHistoryCount(rawTransaction?.confirmationETASeconds);
  const confirmationETA =
    !isConfirmed && etaSeconds !== null
      ? formatSyscoinConfirmationETA({ confirmationETASeconds: etaSeconds })
      : null;
  const nativeIntent = getSyscoinNativeTransferAmount(
    accountTransaction,
    rawTransaction
  );
  const nativeAccountChange = getSyscoinAccountChange(accountTransaction);

  const formattedTransactionDetails: {
    canCopy: boolean;
    label: string;
    value: string;
  }[] = [];

  // Extract SPT information from raw transaction
  const tokenTransfers = Array.isArray(rawTransaction?.tokenTransfers)
    ? rawTransaction.tokenTransfers
    : [];
  const tokenGuids = tokenTransfers.flatMap((transfer) => {
    const guid = parseSyscoinAssetGuid(transfer?.token);
    return guid ? [guid] : [];
  });
  const tokenType = rawTransaction?.tokenType;

  const hasAssetInfo =
    Array.isArray(rawTransaction?.vout) &&
    rawTransaction.vout.some((output) =>
      parseSyscoinAssetGuid(output?.assetInfo?.assetGuid)
    );

  const hasTokenInfo = tokenGuids.length > 0 || tokenType || hasAssetInfo;

  if (rawTransaction) {
    const vettedCompact =
      compactParticipants?.scope === scope &&
      compactParticipants.key === compact?.key
        ? compactParticipants.data
        : null;
    const from = matchingEnhancedTransaction
      ? getSendingAddresses(rawTransaction)
      : vettedCompact?.from ?? [];
    const to = matchingEnhancedTransaction
      ? getReceivingAddresses(rawTransaction)
      : vettedCompact?.to ?? [];
    const txid =
      typeof rawTransaction.txid === 'string' &&
      /^[a-f0-9]{64}$/i.test(rawTransaction.txid)
        ? rawTransaction.txid
        : null;
    const blockHash =
      isConfirmed &&
      typeof rawTransaction.blockHash === 'string' &&
      /^[a-f0-9]{64}$/i.test(rawTransaction.blockHash)
        ? rawTransaction.blockHash
        : null;
    const confirmations = readHistoryCount(rawTransaction.confirmations);
    const blockTime = readHistoryCount(rawTransaction.blockTime);
    const blockDate = blockTime && new Date(blockTime * 1000);
    const fee =
      typeof rawTransaction.fees === 'string' ||
      Number.isSafeInteger(rawTransaction.fees)
        ? String(rawTransaction.fees)
        : '';
    const unavailable = t('settings.unavailable');
    formattedTransactionDetails.push(
      { label: 'Txid', value: txid ?? unavailable, canCopy: txid !== null },
      {
        label: 'From',
        value: from.length ? from.join(', ') : unavailable,
        canCopy: from.length > 0,
      },
      {
        label: 'To',
        value: to.length ? to.join(', ') : unavailable,
        canCopy: to.length > 0,
      },
      {
        label: 'Block Hash',
        value: isConfirmed ? blockHash ?? unavailable : t('send.pending'),
        canCopy: blockHash !== null,
      },
      {
        label: 'Confirmations',
        value: confirmations === null ? unavailable : String(confirmations),
        canCopy: false,
      }
    );
    if (confirmationETA)
      formattedTransactionDetails.push({
        label: 'Estimated Confirmation',
        value: confirmationETA,
        canCopy: false,
      });
    formattedTransactionDetails.push(
      {
        label: 'Block Time',
        value: !isConfirmed
          ? t('send.pending')
          : blockDate && Number.isFinite(blockDate.getTime())
          ? blockDate.toLocaleString(i18n?.resolvedLanguage || i18n?.language)
          : unavailable,
        canCopy: false,
      },
      {
        label: 'Fees',
        value: /^\d{1,78}$/.test(fee)
          ? `${formatSyscoinValue(fee)} ${currency?.toUpperCase() || 'SYS'}`
          : unavailable,
        canCopy: false,
      }
    );
  }

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

  return (
    <>
      <div className="flex flex-col justify-center items-center w-full mb-2">
        <p className="text-brand-gray200 text-xs font-light">
          {translateTransactionType(
            accountTransaction
              ? getTxType(rawTransaction, isTxSent)
              : getSyscoinTransactionTypeLabel(rawTransaction?.tokenType),
            t
          )}
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
              const logo =
                tokenAsset?.image ||
                getTokenLogo(
                  tokenSymbol,
                  true,
                  intentGuid,
                  activeNetwork.chainId,
                  decimals
                );

              return (
                <div className="flex items-center justify-center gap-2 max-w-full">
                  <span
                    className="group relative inline-flex shrink-0 cursor-default"
                    aria-hidden="true"
                  >
                    <TokenIcon
                      key={`${activeNetwork.chainId}:${intentGuid}:${logo}`}
                      assetGuid={intentGuid}
                      chainId={activeNetwork.chainId}
                      decimals={decimals}
                      logo={logo || undefined}
                      symbol={tokenSymbol}
                      size={24}
                      className="shadow-md group-hover:shadow-xl motion-safe:group-hover:scale-110 transition-all duration-200 ease-out motion-reduce:transition-none"
                    />
                    <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none pointer-events-none" />
                  </span>
                  <p className="text-white text-base min-w-0 break-words">
                    {formatSyscoinTokenAmount(intent.amount, decimals) ??
                      t('settings.unavailable')}{' '}
                    {tokenSymbol}
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

          const showZdagConfirmed =
            isSptTx &&
            hasNonReplaceableUtxoSequences(rawTransaction?.vin) &&
            !isTxCanceled &&
            !isConfirmed;

          if (showZdagConfirmed) {
            return (
              <Tooltip
                content={
                  confirmationETA
                    ? t('transactions.estimatedBlockConfirmation', {
                        eta: translateConfirmationEta(confirmationETA, t),
                      })
                    : null
                }
              >
                <p className="text-xs font-normal text-brand-green">
                  {t('transactions.zdagConfirmed')}
                </p>
              </Tooltip>
            );
          }

          return (
            <Tooltip
              content={
                confirmationETA
                  ? t('transactions.estimatedConfirmation', {
                      eta: translateConfirmationEta(confirmationETA, t),
                    })
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
          <p className="text-xs font-normal text-white">
            {translateTransactionLabel('Transaction Type', t)}
          </p>
          {(() => {
            const sptInfo = getSyscoinTransactionTypeStyle(tokenType);
            return (
              <div
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-all duration-200 hover:scale-105 hover:brightness-110 cursor-default"
                style={sptInfo.bgStyle}
              >
                <span className="text-xs">{sptInfo.icon}</span>
                <span className="text-xs font-medium text-white">
                  {translateTransactionType(sptInfo.label, t)}
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {tokenGuids.map((guid: string, index: number) => (
        <div
          key={`token-${index}`}
          className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300"
        >
          <p className="text-xs font-normal text-white">
            {t('send.assetGuid')}
          </p>
          <span className="flex items-center">
            <Tooltip content={guid} childrenClassName="flex">
              <p className="text-xs font-normal text-white">
                {guid.length > 12 ? ellipsis(guid, 6, 6) : guid}
              </p>
              <IconButton
                aria-label={`${t('buttons.copy')}: ${t('send.assetGuid')}`}
                onClick={() => handleCopyWithMessage(guid, 'Asset Guid')}
              >
                <CopyIcon />
              </IconButton>
            </Tooltip>
          </span>
        </div>
      ))}

      {formattedTransactionDetails.map(
        ({ label, value, canCopy }: any, index: number) => (
          <Fragment key={`${hash}-${label}-${index}`}>
            {label.length > 0 && value !== undefined && (
              <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
                <p className="text-xs font-normal text-white">
                  {translateTransactionLabel(label, t)}
                </p>
                <span>
                  {value.length >= 20 && canCopy ? (
                    <Tooltip content={value} childrenClassName="flex">
                      <p className="text-xs font-normal text-white">
                        {ellipsis(value, 2, 4)}
                      </p>
                      {canCopy && (
                        <IconButton
                          aria-label={`${t(
                            'buttons.copy'
                          )}: ${translateTransactionLabel(label, t)}`}
                          onClick={() => handleCopyWithMessage(value, label)}
                        >
                          <CopyIcon />
                        </IconButton>
                      )}
                    </Tooltip>
                  ) : (
                    <p className="text-xs font-normal text-white">
                      {label === 'Estimated Confirmation'
                        ? translateConfirmationEta(String(value), t)
                        : value}
                    </p>
                  )}
                </span>
              </div>
            )}
          </Fragment>
        )
      )}
    </>
  );
};
