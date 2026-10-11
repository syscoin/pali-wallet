import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { EnhancedEvmTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import {
  TransactionHeader,
  TransactionDetailsList,
  TransactionEventLogs,
  DecodedTransactionParams,
} from 'components/TransactionDetails';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { useContextualState } from 'hooks/useContextualState';
import { useController } from 'hooks/useController';
import type { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountTransactions,
  selectValidEnsCache,
} from 'state/vault/selectors';
import { IDecodedTx } from 'types/transactions';
import {
  getEvmHistoryAddressCopyRisk,
  getTrustedEvmRecipients,
} from 'utils/addressPoisoning';
import { formatMethodName } from 'utils/commonMethodSignatures';
import { formatUnits } from 'utils/ethersV6Compat';
import { parseEvmInteger } from 'utils/evmNonce';
import {
  buildEvmMinedNonceIndex,
  getEvmSettlementStatus,
  hasEvmCancellationIntent,
  evmSettlementLabel,
  evmSettlementClass,
} from 'utils/evmReplacement';
import { camelCaseToText } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from 'utils/smartAccount/contracts';
import { isRoutescanApiUrl } from 'utils/tokenDiscovery';
import {
  getTransactionDisplayInfo,
  getSmartAccountDisplayTransaction,
  getSmartAccountExecutionTransactions,
} from 'utils/transactions';
import { isTransactionInBlock } from 'utils/transactionUtils';

import {
  compactReplacementWinner,
  mergeReplacementWinnerIndex,
  replacementHash,
  ReplacementWinner,
} from './replacementWinner';

// Transaction details cache with TTL (5 minutes)
const txDetailsCache = new Map<string, { data: any; timestamp: number }>();
const decodedTxCache = new Map<
  string,
  { data: IDecodedTx | null; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// A cached pending lookup must not overwrite newer authoritative activity status.
const mergeTransactionDetails = (summary: any, enhanced: any) => {
  const merged = { ...summary, ...enhanced };
  // Intent and replacement links are wallet annotations, not RPC fields.
  for (const field of [
    'isCancel',
    'isSpeedUp',
    'isReplaced',
    'replacesHash',
    'replacementRootHash',
  ]) {
    if (summary?.[field] !== undefined) merged[field] = summary[field];
    else delete merged[field];
  }
  if (
    summary &&
    enhanced &&
    (Number(summary.confirmations ?? -1) >
      Number(enhanced.confirmations ?? -1) ||
      (isTransactionInBlock(summary) && !isTransactionInBlock(enhanced)))
  ) {
    for (const field of [
      'blockNumber',
      'blockHash',
      'confirmations',
      'timestamp',
      'status',
      'success',
      'isError',
      'txreceipt_status',
      'isCanceled',
      'isCancel',
    ]) {
      if (summary[field] !== undefined) merged[field] = summary[field];
    }
  }
  return merged;
};

export const EvmTransactionDetailsEnhanced = ({
  hash,
  tx,
  replacementWinnerHash,
  replacementWinner,
}: {
  hash: string;
  replacementWinner?: ReplacementWinner;
  replacementWinnerHash?: string;
  tx?: IEvmTransactionResponse;
}) => {
  const { controllerEmitter } = useController();
  // Use valid (non-expired) ENS cache for security
  const ensCache = useSelector(selectValidEnsCache);
  const { activeNetwork } = useSelector((state: RootState) => state.vault);
  const { chainId, currency, apiUrl } = activeNetwork;

  // Use proper selectors
  const currentAccount = useSelector(selectActiveAccount);
  const normalizedHash = hash.toLowerCase();
  const walletScope = useSelector(getWalletNavigationScope, shallowEqual);
  const scope = `${walletScope.account}:${walletScope.network}:${normalizedHash}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const matchesChain = (data: any) =>
    data?.chainId === undefined || parseEvmInteger(data.chainId) === chainId;
  const matchingTx =
    tx?.hash?.toLowerCase() === normalizedHash && matchesChain(tx)
      ? tx
      : undefined;
  const matchesHash = (data: any) =>
    typeof data?.hash === 'string' &&
    data.hash.toLowerCase() === normalizedHash &&
    matchesChain(data);
  const usableLookup = (data: any) =>
    matchesHash(data) &&
    (matchingTx ||
      (typeof data.from === 'string' &&
        data.value !== undefined &&
        data.value !== null));
  const activeAccountTransactions = useSelector(
    selectActiveAccountTransactions
  );
  const history = activeAccountTransactions?.ethereum?.[chainId] || [];
  const minedNonceIndex = useMemo(
    () => buildEvmMinedNonceIndex(history, chainId),
    [activeAccountTransactions, chainId]
  );
  const winnerHash =
    replacementHash(normalizedHash) &&
    replacementHash(replacementWinnerHash) !== normalizedHash
      ? replacementHash(replacementWinnerHash)
      : undefined;
  const hasLiveWinner = Boolean(
    winnerHash &&
      history.some((row: any) => replacementHash(row?.hash) === winnerHash)
  );
  const winnerScope = `${scope}:${winnerHash || ''}`;
  const [winnerLookup, setWinnerLookup] = useContextualState<{
    candidate?: ReplacementWinner;
    settled: boolean;
  }>(winnerScope, { settled: false });
  const trustedRecipients = useMemo(
    () =>
      getTrustedEvmRecipients(
        activeAccountTransactions?.ethereum?.[chainId] || [],
        currentAccount?.address || ''
      ),
    [activeAccountTransactions, chainId, currentAccount?.address]
  );

  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();

  const { getTxStatusIcons, getTxType } = useTransactionsListConfig();

  const [, copy] = useCopyClipboard();
  const [enhancedDetails, setEnhancedDetails] = useContextualState<any>(
    scope,
    null
  );
  const [isLoadingDetails, setIsLoadingDetails] = useContextualState(
    scope,
    false
  );
  const [decodedTxData, setDecodedTxData] =
    useContextualState<IDecodedTx | null>(scope, null);

  // State for transaction display info - moved up to be available for useEffect dependencies
  const [transactionDisplayInfo, setTransactionDisplayInfo] =
    useContextualState<{
      actualRecipient: string;
      displaySymbol: string;
      displayValue: number | string;
      isErc20Transfer: boolean;
      isNft: boolean;
      tokenId?: string;
    } | null>(scope, null);

  let isTxSent: boolean;
  const mergedTransaction = useMemo(
    () =>
      matchingTx || enhancedDetails
        ? mergeTransactionDetails(matchingTx, enhancedDetails)
        : undefined,
    [matchingTx, enhancedDetails]
  );
  // An EntryPoint bundle may contain many accounts. Never fall back to its first
  // operation when restoring this account's details from an outer hash alone.
  const displayContext = useMemo(() => {
    if (!mergedTransaction)
      return { transaction: undefined, isOperation: false };
    const input = String(
      mergedTransaction.input || mergedTransaction.data || ''
    );
    if (!input.startsWith(paliEntryPointInterface.getSighash('handleOps'))) {
      return { transaction: mergedTransaction, isOperation: false };
    }
    const entryPoint = getPaliEntryPointAddress(chainId).toLowerCase();
    const accountAddress = currentAccount?.address?.toLowerCase();
    const anchored = {
      ...mergedTransaction,
      smartAccountExecutionFrom: currentAccount?.address,
    };
    const executions = getSmartAccountExecutionTransactions(anchored, {
      requireMatchingSmartAccount: true,
    });
    if (String(mergedTransaction.to || '').toLowerCase() !== entryPoint) {
      return { transaction: undefined, isOperation: true, success: undefined };
    }
    let success: boolean | undefined;
    for (const log of Array.isArray(mergedTransaction.logs)
      ? mergedTransaction.logs
      : []) {
      if (
        String(log?.address || '').toLowerCase() !== entryPoint ||
        (log.transactionHash &&
          String(log.transactionHash).toLowerCase() !== normalizedHash)
      )
        continue;
      try {
        const event = paliEntryPointInterface.parseLog(log);
        if (
          event?.name === 'UserOperationEvent' &&
          String(event.args.sender).toLowerCase() === accountAddress
        ) {
          success = (success ?? true) && Boolean(event.args.success);
        }
      } catch {
        /* Other receipt events do not prove this operation's outcome. */
      }
    }
    if (
      success === undefined &&
      isTransactionInBlock(matchingTx) &&
      String(
        (matchingTx as any)?.smartAccountExecutionFrom || ''
      ).toLowerCase() === accountAddress
    ) {
      const status = (matchingTx as any)?.txreceipt_status;
      if (status === '0' || status === '1') success = status === '1';
    }
    return {
      transaction:
        success === true && executions.length
          ? getSmartAccountDisplayTransaction(anchored)
          : undefined,
      isOperation: true,
      success,
    };
  }, [
    mergedTransaction,
    matchingTx,
    currentAccount?.address,
    chainId,
    normalizedHash,
  ]);
  const displayTransaction = displayContext.transaction;
  let transactionTx: IEvmTransactionResponse | undefined = mergedTransaction;
  const candidate = winnerLookup.settled
    ? winnerLookup.candidate
    : replacementWinner;
  const settlementIndex = useMemo(
    () =>
      mergeReplacementWinnerIndex(
        history,
        mergedTransaction,
        replacementHash(candidate?.hash) === winnerHash ? candidate : undefined,
        chainId,
        minedNonceIndex
      ),
    [mergedTransaction, candidate, winnerHash, minedNonceIndex, chainId]
  );

  // A paginated proof is provisional. Revalidate once per scoped details visit,
  // without using the original transaction's five-minute lookup cache.
  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && scopeRef.current === scope;
    if (!winnerHash || hasLiveWinner) {
      setWinnerLookup({ settled: true });
      return;
    }
    const fetchWinner = async () => {
      try {
        const result: any = await controllerEmitter(
          ['wallet', 'getEvmTransactionFromProvider'],
          [winnerHash]
        );
        if (isCurrent())
          setWinnerLookup({
            settled: true,
            candidate:
              replacementHash(result?.hash) === winnerHash
                ? compactReplacementWinner(result, chainId)
                : undefined,
          });
      } catch {
        if (isCurrent()) setWinnerLookup({ settled: true });
      }
    };
    fetchWinner();
    return () => {
      cancelled = true;
    };
  }, [scope, winnerHash, hasLiveWinner]);

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

  // Lookup and caches belong to this exact account, network, endpoint and hash.
  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && scopeRef.current === scope;
    const fetchEnhancedDetails = async () => {
      if (!hash) return;
      const cached = txDetailsCache.get(scope);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setEnhancedDetails(cached.data);
        return;
      }

      setIsLoadingDetails(true);
      try {
        let enhancedData = null;
        // Routescan's Etherscan API has no Blockscout gettxinfo action.
        if (apiUrl && !isRoutescanApiUrl(apiUrl, chainId)) {
          enhancedData = await controllerEmitter(
            ['wallet', 'getEvmTransactionFromAPI'],
            [hash, apiUrl]
          );
        }
        if (!isCurrent()) return;
        if (!usableLookup(enhancedData)) {
          enhancedData = await controllerEmitter(
            ['wallet', 'getEvmTransactionFromProvider'],
            [hash]
          );
        }
        if (!isCurrent()) return;
        if (usableLookup(enhancedData)) {
          txDetailsCache.set(scope, {
            data: enhancedData,
            timestamp: Date.now(),
          });
          if (txDetailsCache.size > 100)
            txDetailsCache.delete(txDetailsCache.keys().next().value);
          setEnhancedDetails(enhancedData);
        } else {
          setEnhancedDetails(null);
        }
      } catch (error) {
        if (isCurrent()) {
          console.error('Failed to fetch enhanced transaction details:', error);
          setEnhancedDetails(null);
        }
      } finally {
        if (isCurrent()) setIsLoadingDetails(false);
      }
    };
    fetchEnhancedDetails();
    return () => {
      cancelled = true;
    };
  }, [hash, scope]);

  // Effect to decode transaction data when we have transaction data
  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && scopeRef.current === scope;
    const processTransactionDecoding = async () => {
      // Check cache first
      const cached = decodedTxCache.get(scope);
      const now = Date.now();

      if (cached && now - cached.timestamp < CACHE_TTL) {
        setDecodedTxData(cached.data);
        return;
      }

      const currentTransaction = transactionTx;

      if (currentTransaction) {
        try {
          const mergedTx = currentTransaction;

          let decodedData: IDecodedTx | null = null;

          // Always decode transactions with input data to get full parameter details
          // This ensures we show decoded data even if transactionDisplayInfo isn't ready yet
          if (!mergedTx.input || mergedTx.input === '0x') {
            // Simple ETH transfers with no input data
            decodedData = {
              method: 'Send',
              types: [],
              inputs: [],
              names: [],
            };
          } else {
            // Always decode transactions with input data to get full details
            try {
              decodedData = (await controllerEmitter(
                ['wallet', 'decodeEvmTransactionData'],
                [mergedTx]
              )) as IDecodedTx;
            } catch (decodeError) {
              console.error('Failed to decode transaction data:', decodeError);
              // Fallback based on what we know
              if (transactionDisplayInfo?.isErc20Transfer) {
                decodedData = {
                  method: transactionDisplayInfo.isNft
                    ? 'NFT Transfer'
                    : 'Token Transfer',
                  types: [],
                  inputs: [],
                  names: [],
                };
              }
            }
          }

          if (!isCurrent()) return;
          // Cache the result
          decodedTxCache.set(scope, {
            data: decodedData,
            timestamp: now,
          });

          if (decodedTxCache.size > 100)
            decodedTxCache.delete(decodedTxCache.keys().next().value);
          setDecodedTxData(decodedData);
        } catch (error) {
          if (isCurrent()) {
            console.error('Error decoding transaction:', error);
            setDecodedTxData(null);
          }
        }
      }
    };

    processTransactionDecoding();
    return () => {
      cancelled = true;
    };
  }, [
    hash,
    scope,
    matchingTx,
    enhancedDetails,
    transactionDisplayInfo,
    // controllerEmitter is omitted as it's a stable reference from useController
  ]);

  const formattedTransaction = [];

  // Removed redux dependency; rely on passed tx and enhanced details

  // Display enrichment can await token reads; discard it after the view changes.
  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && scopeRef.current === scope;
    const getDisplayInfo = async () => {
      const baseTx = displayTransaction;
      if (!baseTx) {
        setTransactionDisplayInfo(null);
        return;
      }
      try {
        const displayInfo = await getTransactionDisplayInfo(baseTx, currency);
        if (isCurrent()) setTransactionDisplayInfo(displayInfo);
      } catch (error) {
        if (isCurrent()) {
          console.error('Failed to get transaction display info:', error);
          setTransactionDisplayInfo(null);
        }
      }
    };
    if (hash) getDisplayInfo();
    return () => {
      cancelled = true;
    };
  }, [hash, scope, displayTransaction, currency]);

  // Build details from the available transaction (passed + enhanced)
  if (transactionTx) {
    // Provider/explorer detail DTOs add display-only fields to the activity shape.
    const txLocal: Record<string, any> = { ...transactionTx };

    txLocal.value = !!txLocal.value?.hex ? txLocal.value?.hex : txLocal.value;

    transactionTx = txLocal as any;

    isTxSent =
      typeof displayTransaction?.from === 'string' &&
      displayTransaction.from.toLowerCase() ===
        currentAccount?.address?.toLowerCase();

    const mergedTx = txLocal;
    if (displayContext.isOperation) {
      // Outer receipt success does not establish an inner user operation's result.
      if (displayContext.success === undefined) delete mergedTx.success;
      else mergedTx.success = displayContext.success;
    }

    // Use the decoded transaction data for method information
    if (decodedTxData && decodedTxData.method) {
      mergedTx.method = decodedTxData.method;
    } else if (!mergedTx.method) {
      // Fallback for backwards compatibility
      mergedTx.method =
        mergedTx.input && mergedTx.input !== '0x'
          ? 'Contract Interaction'
          : 'Send';
    }

    for (const [key, value] of Object.entries(mergedTx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? t('send.yes') : t('send.no');

      // For ERC-20 transfers, replace the "to" field with actual recipient
      let finalValue = value;
      if (
        key === 'to' &&
        transactionDisplayInfo?.isErc20Transfer &&
        transactionDisplayInfo.actualRecipient
      ) {
        finalValue = transactionDisplayInfo.actualRecipient;
      }

      const formattedValue: any = {
        value: typeof finalValue === 'boolean' ? formattedBoolean : finalValue,
        label: formattedKey,
        canCopy: false,
      };

      // Special formatting for certain fields
      if (key === 'gasUsed' || key === 'gasLimit') {
        const asString = String(finalValue);
        const isHex = asString.startsWith('0x');
        let numeric = 0;
        try {
          numeric = isHex ? parseInt(asString, 16) : parseInt(asString, 10);
        } catch {
          numeric = NaN as unknown as number;
        }
        formattedValue.value = Number.isFinite(numeric)
          ? numeric.toLocaleString()
          : 'N/A';
      } else if (
        key === 'gasPrice' ||
        key === 'maxFeePerGas' ||
        key === 'maxPriorityFeePerGas'
      ) {
        // Normalize BigNumberish (hex or decimal) and format as Gwei
        let bigNumberish: any = finalValue as any;
        if (bigNumberish && typeof bigNumberish === 'object') {
          // ethers objects may contain hex fields
          if (typeof (bigNumberish as any).hex === 'string') {
            bigNumberish = (bigNumberish as any).hex;
          } else if (typeof (bigNumberish as any)._hex === 'string') {
            bigNumberish = (bigNumberish as any)._hex;
          }
        }
        try {
          const gwei = formatUnits(bigNumberish ?? '0', 'gwei');
          const num = Number(gwei);
          formattedValue.value = Number.isFinite(num)
            ? `${num.toFixed(2)} Gwei`
            : 'N/A';
        } catch {
          formattedValue.value = 'N/A';
        }
      } else if (key === 'revertReason' && finalValue) {
        formattedValue.value = finalValue;
        formattedValue.className = 'text-brand-redDark';
      } else if (key === 'success') {
        formattedValue.value = finalValue ? 'Success' : 'Failed';
        formattedValue.className = finalValue
          ? 'text-brand-green'
          : 'text-brand-redDark';
      } else if (key === 'timestamp') {
        formattedValue.value = finalValue
          ? new Date(Number(finalValue) * 1000).toLocaleString()
          : 'N/A';
      } else if (key === 'method' && finalValue) {
        // Apply translation for method names
        formattedValue.value = formatMethodName(
          String(finalValue),
          currency.toUpperCase(),
          t
        );
      }

      if (String(finalValue).length >= 20 && key !== 'image') {
        formattedValue.canCopy = true;
      }

      const isValid =
        typeof finalValue !== 'object' &&
        finalValue !== undefined &&
        finalValue !== null;

      if (isValid) formattedTransaction.push(formattedValue);
    }
  }

  // Always use enhanced labels since provider data is now normalized to same structure as API
  const labelsToUse = EnhancedEvmTxDetailsLabelsToKeep;

  // Enhance details with ENS cache for From/To where applicable
  const withEns = formattedTransaction.map((item: any) => {
    if (item?.label && typeof item.value === 'string') {
      const labelLower = String(item.label).toLowerCase();
      if (labelLower === 'from' || labelLower === 'to') {
        const addrLower = item.value.toLowerCase();
        const cached = (ensCache as any)?.[addrLower];
        if (cached?.name) {
          const name = cached.name as string;
          const short =
            name.length > 24 ? `${name.slice(0, 14)}…${name.slice(-8)}` : name;
          return {
            ...item,
            value: short,
            tooltip: item.value,
          };
        }
      }
    }
    return item;
  });

  const formattedTransactionDetails = withEns
    .filter(({ label }) => labelsToUse.includes(label))
    .sort(
      (a, b) => labelsToUse.indexOf(a.label) - labelsToUse.indexOf(b.label)
    );

  // Handle copy actions with appropriate messages
  const handleCopy = (value: string, label: string) => {
    const copyRisk = getEvmHistoryAddressCopyRisk({
      accountAddress: currentAccount?.address || '',
      address: value,
      label,
      transaction: transactionTx,
      trustedRecipients,
    });
    if (copyRisk) {
      alert.warning(
        copyRisk.kind === 'lookalike'
          ? t('send.addressPoisoningBlocked', {
              address: copyRisk.trustedAddress,
            })
          : t('send.addressPoisoningHistoryCopyBlocked')
      );
      return;
    }

    copy(value ?? '');
    alert.info(getCopyMessage(label));
  };

  if (!transactionTx && !isLoadingDetails) {
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

  const accountAddress = currentAccount?.address?.toLowerCase();
  const hasAccountDirection =
    displayTransaction &&
    (matchingTx ||
      (accountAddress &&
        [
          displayTransaction?.from,
          displayTransaction?.to,
          transactionDisplayInfo?.actualRecipient,
        ].some(
          (address) =>
            typeof address === 'string' &&
            address.toLowerCase() === accountAddress
        )));
  const settlement = getEvmSettlementStatus(
    displayContext.isOperation && displayContext.success !== undefined
      ? {
          ...transactionTx,
          // eslint-disable-next-line camelcase -- RPC receipt status field.
          txreceipt_status: displayContext.success ? '1' : '0',
        }
      : transactionTx,
    chainId,
    settlementIndex
  );
  const isCancellation = hasEvmCancellationIntent(
    transactionTx,
    history,
    chainId
  );
  const directionLabel = hasAccountDirection
    ? getTxType(displayTransaction || transactionTx, isTxSent)
    : 'Transaction';
  const txType = isCancellation
    ? t('transactions.cancellation')
    : directionLabel;
  return (
    <>
      <TransactionHeader
        txType={txType}
        statusIcon={getTxStatusIcons(directionLabel, true)}
        displayInfo={displayTransaction ? transactionDisplayInfo : null}
        txStatus={
          <p
            className={`text-xs font-normal ${evmSettlementClass(settlement)}`}
          >
            {t(evmSettlementLabel(settlement))}
          </p>
        }
        isLoading={isLoadingDetails}
      />

      <TransactionDetailsList
        details={formattedTransactionDetails}
        onCopy={handleCopy}
      />

      {/* Display decoded transaction parameters */}
      <DecodedTransactionParams decodedData={decodedTxData} />

      {/* Display event logs */}
      <TransactionEventLogs
        logs={Array.isArray(enhancedDetails?.logs) ? enhancedDetails.logs : []}
      />
    </>
  );
};
