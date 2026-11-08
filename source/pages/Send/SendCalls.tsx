import {
  snapshotPreparedEvmTransaction,
  type PreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';

import { createSmartAccountCallsExecutions } from '../../shared/dappCalls';
import { createEoaCallsSequence } from '../../wallet/evmCallsSequence';
import { Button, Icon, Tooltip } from 'components/index';
import { LoadingComponent, PqSigningOverlay } from 'components/Loading';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectEnsNameToAddress } from 'state/vault/selectors';
import { dispatchBackgroundEvent } from 'utils/browser';
import { getMethodName } from 'utils/commonMethodSignatures';
import { formatEther } from 'utils/ethersV6Compat';
import { BigNumber } from 'utils/ethersV6Compat';
import { defaultAbiCoder } from 'utils/ethersV6Compat';
import {
  EVM_TRANSACTION_CONTEXT_CHANGED,
  legacyEvmNonceErrorKey,
  IEvmTransactionContext,
} from 'utils/evmTransactionContext';
import { ellipsis } from 'utils/format';
import { clearTransactionNavigationState } from 'utils/navigationState';
import {
  getSmartAccountLocalOwnerContexts,
  isSmartAccountFeeQuoteChanged,
  prepareSmartAccountFeeQuote,
  signAndSubmitSmartAccountExecutions,
  SMART_ACCOUNT_FEE_QUOTE_CHANGED,
  type SmartAccountExecutionIntent,
  type SmartAccountFeeQuote,
} from 'utils/smartAccount';

interface ISendCallsData {
  approvedContext: IEvmTransactionContext;
  atomicRequired: boolean;
  // Bundle id reserved by the background handler before this popup opened
  // (the app-provided id when the dapp supplied one, otherwise a random
  // wallet-minted id). Returned to the dapp as-is and finalized in the
  // bundle registry with the broadcast tx hashes.
  bundleId: string;
  calls: Array<{
    capabilities?: Record<string, any>;
    data?: string;
    to?: string;
    value?: string;
  }>;
  capabilities?: Record<string, any>;
  chainId: string;
  from?: string;
  // Original EIP-5792 app-provided bundle id field from the request.
  id?: string;
  reservationId: string;
  version: string;
}

type EoaFeeReview = Readonly<{
  id: string;
  maximumFeeUnits: string;
  maximumTotalUnits: string;
  transaction: PreparedEvmTransaction;
  validForMs: number;
}>;

const formatDecodedCallValue = (value: any): string => {
  if (BigNumber.isBigNumber(value)) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatDecodedCallValue).join(', ')}]`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
};

// ABI inputs and displayed field names share one decoder. Some methods carry
// trailing bytes that must decode successfully but are reviewed as raw data.
const COMMON_CALL_FIELDS: Record<string, [string, string]> = {
  '0x095ea7b3': ['address,uint256', 'spender,amount'],
  '0xa9059cbb': ['address,uint256', 'to,amount'],
  '0x23b872dd': ['address,address,uint256', 'from,to,amountOrTokenId'],
  '0x39509351': ['address,uint256', 'spender,addedValue'],
  '0xa457c2d7': ['address,uint256', 'spender,subtractedValue'],
  '0xa22cb465': ['address,bool', 'operator,approved'],
  '0x42842e0e': ['address,address,uint256', 'from,to,tokenId'],
  '0xb88d4fde': ['address,address,uint256,bytes', 'from,to,tokenId'],
  '0xf242432a': ['address,address,uint256,uint256,bytes', 'from,to,id,amount'],
  '0x2eb2c2d6': [
    'address,address,uint256[],uint256[],bytes',
    'from,to,ids,amounts',
  ],
};

const decodeCommonCallData = (data?: string) => {
  if (!data || data === '0x' || data.length < 10) {
    return null;
  }

  const selector = data.slice(0, 10).toLowerCase();
  const fallbackName = getMethodName(selector);
  const fallback = fallbackName ? { name: fallbackName, params: null } : null;
  const fields = COMMON_CALL_FIELDS[selector];
  if (!fields) return fallback;

  try {
    const values = defaultAbiCoder.decode(
      fields[0].split(','),
      `0x${data.slice(10)}`
    );
    return {
      name: fallbackName,
      params: Object.fromEntries(
        fields[1].split(',').map((name, index) => [name, values[index]])
      ),
    };
  } catch {
    return fallback;
  }
};

const getSafeSmartAccountCallErrorMessage = (
  error: any,
  fallback: string,
  contextChangedMessage: string
) => {
  const message = error?.message ? String(error.message) : '';
  if (message === EVM_TRANSACTION_CONTEXT_CHANGED) return contextChangedMessage;
  const normalized = message.toLowerCase();
  const isRawRpcError =
    normalized.includes('"jsonrpc"') ||
    normalized.includes('execution reverted') ||
    normalized.includes('0x220266b6') ||
    normalized.includes('"data":"0x') ||
    normalized.includes('data: 0x') ||
    normalized.includes('pali_smart_account_signature_error');

  return message && !isRawRpcError ? message : fallback;
};

export const SendCalls = () => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const { controllerEmitter } = useController();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeAccountIdentity = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const activeSlip44 = useSelector(
    (state: RootState) => state.vaultGlobal?.activeSlip44
  );

  // Get data from query parameters or location state
  const { host, eventName, ...externalData } = useQueryData();

  const callsData: ISendCallsData = externalData;
  const [approvedContext] = useState(() => callsData.approvedContext);
  const approvedAccount =
    accounts[approvedContext.account.type]?.[approvedContext.account.id];

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [rejecting, setRejecting] = useState(false);
  const [isPqSigning, setIsPqSigning] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [processingIndex, setProcessingIndex] = useState<number>(-1);
  const [transactionStatuses, setTransactionStatuses] = useState<
    Array<{
      error?: string;
      status:
        | 'pending'
        | 'signing'
        | 'sending'
        | 'success'
        | 'error'
        | 'unknown';
      txHash?: string;
    }>
  >();
  const submissionInFlightRef = React.useRef(false);
  const rejectionStartedRef = React.useRef(false);
  const lastStartedSubmissionRef = React.useRef<string>();
  const mountedRef = React.useRef(true);
  const settlementStartedRef = React.useRef(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout>>();
  const unknownSubmissionRef = React.useRef(false);
  const acknowledgedCallsRef = React.useRef(new Set<number>());
  const eoaSequenceRef =
    React.useRef<ReturnType<typeof createEoaCallsSequence>>();
  const [eoaFeeReview, setEoaFeeReview] = useState<{
    index: number;
    quote: EoaFeeReview;
  }>();
  const [reviewedDestinations, setReviewedDestinations] = useState<
    Readonly<Record<number, string>>
  >({});
  const eoaDecisionRef = React.useRef<{
    expires: number;
    index: number;
    quote: EoaFeeReview;
    reject(reason: Error): void;
    resolve(value: EoaFeeReview): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const eoaRunRef = React.useRef<Promise<void>>();
  const eoaLifetimeRef = React.useRef(0);
  const eoaStartedRef = React.useRef(false);
  const durableHashesRef = React.useRef(new Set<string>());
  const terminalSubmissionRef = React.useRef<{ submissionId?: string }>();
  const pendingCompletionRef = React.useRef<{
    failed: boolean;
    submissionId?: string;
    txHashes: string[];
  }>();
  const [completionRevision, setCompletionRevision] = useState(0);
  const [progressSubmissionId, setProgressSubmissionId] = useState<string>();
  const [requestSmartAccount] = useState(() => ({
    supportsAtomicBatch: Boolean(
      approvedAccount?.isSmartAccount &&
        approvedAccount.smartAccount?.chainId === approvedContext.chainId
    ),
  }));

  // Reverse ENS cache: name -> address (lowercased)
  const ensNameToAddress = useSelector(selectEnsNameToAddress);
  const effectiveSelectedCalls = useMemo(
    () => new Array(callsData.calls?.length || 0).fill(true),
    [callsData.calls]
  );

  // Every original call is reviewed. Non-atomic execution permits partial
  // outcomes, not arbitrary omission of calls from the approved request.
  useEffect(() => {
    setInitialLoading(false);
  }, [callsData.calls]);

  // Calculate total value
  const totalValue = useMemo(() => {
    if (!callsData.calls) return '0';

    return callsData.calls
      .reduce((sum, call, index) => {
        if (!effectiveSelectedCalls[index] || !call.value) return sum;
        try {
          return sum.add(BigNumber.from(call.value));
        } catch {
          return sum;
        }
      }, BigNumber.from(0))
      .toString();
  }, [callsData.calls, effectiveSelectedCalls]);

  const allTransactionsSuccessful = useMemo(() => {
    if (!transactionStatuses || !callsData.calls) return false;
    // Check if all transactions in the original batch have succeeded
    return callsData.calls.every(
      (_, index) =>
        transactionStatuses[index] &&
        transactionStatuses[index].status === 'success'
    );
  }, [transactionStatuses, callsData.calls]);

  // Check if there are any selected transactions that haven't succeeded yet
  const hasUnknownSubmission = transactionStatuses?.some(
    (status) => status?.status === 'unknown'
  );
  const hasUnsuccessfulSelected = useMemo(
    () =>
      !hasUnknownSubmission &&
      effectiveSelectedCalls.some(
        (selected, index) =>
          selected &&
          (!transactionStatuses?.[index] ||
            transactionStatuses[index].status !== 'success')
      ),
    [effectiveSelectedCalls, hasUnknownSubmission, transactionStatuses]
  );

  const [feeQuoteRevision, setFeeQuoteRevision] = useState(0);
  const [feeQuoteNeedsRefresh, setFeeQuoteNeedsRefresh] = useState(false);
  const [feeQuoteError, setFeeQuoteError] = useState<string>();
  const [feeQuote, setFeeQuote] = useState<
    SmartAccountFeeQuote & {
      destinations: Readonly<Record<number, string>>;
      executions: SmartAccountExecutionIntent[];
      key: string;
    }
  >();
  const quoteCallIndices = (callsData.calls || [])
    .map((_, index) => index)
    .filter(
      (index) =>
        effectiveSelectedCalls[index] &&
        transactionStatuses?.[index]?.status !== 'success'
    );
  const quoteCalls = quoteCallIndices.map((index) => callsData.calls[index]);
  const feeQuoteKey = requestSmartAccount.supportsAtomicBatch
    ? JSON.stringify([
        approvedContext,
        approvedAccount?.address,
        approvedAccount?.smartAccount?.auth,
        approvedAccount?.smartAccount?.installedModules,
        activeNetwork.chainId,
        activeNetwork.url,
        activeAccountIdentity,
        activeSlip44,
        quoteCalls,
        quoteCalls.map(
          (call) => ensNameToAddress[String(call.to).toLowerCase()]
        ),
      ])
    : '';
  const hasCurrentFeeQuote =
    !requestSmartAccount.supportsAtomicBatch ||
    Boolean(feeQuote?.key === feeQuoteKey && !feeQuoteNeedsRefresh);
  const currentFeeQuoteKeyRef = React.useRef(feeQuoteKey);
  currentFeeQuoteKeyRef.current = feeQuoteKey;

  useEffect(() => {
    if (!requestSmartAccount.supportsAtomicBatch || !quoteCalls.length) return;
    let cancelled = false;
    setFeeQuoteError(undefined);
    const quoteBatch = async () => {
      if (
        activeNetwork.chainId !== approvedContext.chainId ||
        activeNetwork.url !== approvedContext.rpcUrl
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      const resolvedCalls: { data: string; to: string; value: string }[] = [];
      for (const call of quoteCalls) {
        const raw = String(call.to || '');
        let target = raw;
        if (raw.toLowerCase().endsWith('.eth')) {
          const resolved =
            ensNameToAddress[raw.toLowerCase()] ||
            (await controllerEmitter(['wallet', 'resolveEns'], [raw]));
          if (typeof resolved !== 'string' || !resolved)
            throw new Error(t('send.unableToResolveEns'));
          target = resolved;
        }
        if (!/^0x[\da-f]{40}$/i.test(target))
          throw new Error(t('send.smartAccountContractDeploymentUnsupported'));
        resolvedCalls.push({
          to: target,
          data: call.data || '0x',
          value: call.value || '0x0',
        });
      }
      const executions = [...createSmartAccountCallsExecutions(resolvedCalls)];
      if (cancelled) return;
      const preparedQuote = await prepareSmartAccountFeeQuote({
        accountAddress: approvedContext.account.address,
        accountId: approvedContext.account.id,
        controllerEmitter,
        executions,
        expectedContext: approvedContext,
      });
      if (!cancelled) {
        const destinations = Object.freeze(
          Object.fromEntries(
            quoteCallIndices.map((index, position) => [
              index,
              executions[position].target,
            ])
          )
        );
        setFeeQuote({
          ...preparedQuote,
          destinations,
          executions,
          key: feeQuoteKey,
        });
        setFeeQuoteNeedsRefresh(false);
      }
    };
    quoteBatch().catch(() => {
      if (!cancelled) setFeeQuoteError(t('send.unableToCalculateFees'));
    });
    return () => {
      cancelled = true;
    };
    // The serialized key includes the exact ordered selection and context.
  }, [feeQuoteKey, feeQuoteRevision]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      eoaLifetimeRef.current++;
      const decision = eoaDecisionRef.current;
      eoaDecisionRef.current = undefined;
      if (decision) {
        clearTimeout(decision.timer);
        decision.reject(
          Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
            transactionNotBroadcast: true,
          })
        );
        void controllerEmitter(
          ['wallet', 'discardNativeEvmFeeReview'],
          [decision.quote.id]
        ).catch(() => undefined);
      }
      clearTimeout(closeTimerRef.current);
    };
  }, []);

  const canReturnBundleId = () =>
    Boolean(
      callsData.bundleId &&
        terminalSubmissionRef.current &&
        terminalSubmissionRef.current.submissionId ===
          lastStartedSubmissionRef.current &&
        durableHashesRef.current.size > 0 &&
        !pendingCompletionRef.current &&
        !unknownSubmissionRef.current
    );

  const rememberDurableHashes = (hashes: string[]) => {
    for (const hash of hashes)
      if (/^0x[\da-f]{64}$/i.test(hash)) durableHashesRef.current.add(hash);
  };

  // Both completion paths own one response. A retained callback or timer may
  // not settle another view after this popup closes or unmounts.
  const finishPopup = async (returnBundleId: boolean) => {
    if (!mountedRef.current || settlementStartedRef.current) return;
    settlementStartedRef.current = true;
    rejectionStartedRef.current = true;
    clearTimeout(closeTimerRef.current);
    setRejecting(true);
    try {
      await clearTransactionNavigationState();
    } catch (error) {
      console.error('Failed to clean navigation after completing calls', error);
    }
    if (!mountedRef.current) return;
    if (returnBundleId)
      dispatchBackgroundEvent(`${eventName}.${host}`, {
        id: callsData.bundleId,
        capabilities: {},
      });
    window.close();
  };

  // Persist broadcast tx hashes (and any pre-broadcast failure) incrementally
  // so a partially broadcast non-atomic batch still resolves in
  // wallet_getCallsStatus / wallet_showCallsStatus — as partially reverted
  // (600) or offchain failure (400) — even if a later call errors or the
  // popup is closed mid-flight. The registry record is an idempotent
  // overwrite; the final all-success pass rewrites it with failed: false.
  const lastRecordedBundleRef = React.useRef<string>('');
  const markSubmissionStarted = async (
    smartAccountExecutionContextId?: string
  ) => {
    try {
      const submissionId = uuidv4();
      await controllerEmitter(
        ['wallet', 'recordSendCallsBundle'],
        [
          host,
          callsData.bundleId,
          {
            atomic:
              requestSmartAccount.supportsAtomicBatch ||
              callsData.atomicRequired,
            chainId: approvedContext.chainId,
            smartAccount: requestSmartAccount.supportsAtomicBatch,
            reservationId: callsData.reservationId,
            previousSubmissionId: lastStartedSubmissionRef.current,
            submissionId,
            submissionStarted: true,
            smartAccountExecutionContextId,
            txHashes: [],
          },
        ]
      );
      lastStartedSubmissionRef.current = submissionId;
      terminalSubmissionRef.current = undefined;
      pendingCompletionRef.current = undefined;
      setProgressSubmissionId(submissionId);
      return submissionId;
    } catch (error) {
      console.error('Failed to persist sendCalls submission boundary', error);
      throw new Error(t('send.sendError'));
    }
  };
  const markSubmissionNotBroadcast = async () => {
    try {
      await controllerEmitter(
        ['wallet', 'recordSendCallsBundle'],
        [
          host,
          callsData.bundleId,
          {
            atomic:
              requestSmartAccount.supportsAtomicBatch ||
              callsData.atomicRequired,
            chainId: approvedContext.chainId,
            reservationId: callsData.reservationId,
            submissionId: lastStartedSubmissionRef.current,
            smartAccount: requestSmartAccount.supportsAtomicBatch,
            submissionNotBroadcast: true,
            txHashes: [],
          },
        ]
      );
      return true;
    } catch (error) {
      console.error('Failed to record definite sendCalls rejection', error);
      return false;
    }
  };
  const recordCompletedSubmission = async (
    failed: boolean,
    txHashes: string[]
  ) => {
    const submissionId = lastStartedSubmissionRef.current;
    const completion = { failed, txHashes, submissionId };
    pendingCompletionRef.current = completion;
    await controllerEmitter(
      ['wallet', 'recordSendCallsBundle'],
      [
        host,
        callsData.bundleId,
        {
          atomic:
            requestSmartAccount.supportsAtomicBatch || callsData.atomicRequired,
          chainId: approvedContext.chainId,
          reservationId: callsData.reservationId,
          smartAccount: requestSmartAccount.supportsAtomicBatch,
          submissionCompleted: true,
          submissionId,
          failed,
          txHashes,
        },
      ]
    );
    rememberDurableHashes(txHashes);
    if (pendingCompletionRef.current === completion)
      pendingCompletionRef.current = undefined;
    terminalSubmissionRef.current = { submissionId };
    if (mountedRef.current) setCompletionRevision((revision) => revision + 1);
  };
  const recordBroadcastHash = async (txHash: string) => {
    await controllerEmitter(
      ['wallet', 'recordSendCallsBundle'],
      [
        host,
        callsData.bundleId,
        {
          atomic:
            requestSmartAccount.supportsAtomicBatch || callsData.atomicRequired,
          chainId: approvedContext.chainId,
          reservationId: callsData.reservationId,
          smartAccount: requestSmartAccount.supportsAtomicBatch,
          submissionId: lastStartedSubmissionRef.current,
          txHashes: [txHash],
        },
      ]
    );
    rememberDurableHashes([txHash]);
  };
  const stopUnknownSubmission = (indices: number[], txHash?: string) => {
    unknownSubmissionRef.current = true;
    setTransactionStatuses((prev) => {
      const statuses = [...prev];
      for (const index of indices)
        statuses[index] = {
          status: 'unknown',
          txHash,
          error: t('send.submissionStatusUnknown'),
        };
      return statuses;
    });
    setLoading(false);
    setProcessingIndex(-1);
    alert.error(t('send.submissionStatusUnknown'));
  };
  useEffect(() => {
    if (!transactionStatuses || !callsData.bundleId) return;
    const smartAccount = requestSmartAccount.supportsAtomicBatch;
    const txHashes = Array.from(
      new Set(
        transactionStatuses
          .map((status) => status?.txHash)
          .filter((hash): hash is string => Boolean(hash))
      )
    );
    const failed = transactionStatuses.some(
      (status) => status?.status === 'error'
    );
    // Nothing broadcast and nothing failed yet: keep the pending reservation.
    if (txHashes.length === 0 && !failed) return;
    const bundleDescriptor = {
      atomic: smartAccount ? true : callsData.atomicRequired,
      chainId: approvedContext.chainId,
      failed,
      smartAccount,
      reservationId: callsData.reservationId,
      // Only the awaited terminal write can complete an attempt. A progress
      // effect must not race a failed completion write into a false success.
      submissionCompleted: false,
      submissionId: progressSubmissionId,
      txHashes,
    };
    const serialized = JSON.stringify(bundleDescriptor);
    if (serialized === lastRecordedBundleRef.current) return;
    lastRecordedBundleRef.current = serialized;
    controllerEmitter(
      ['wallet', 'recordSendCallsBundle'],
      [host, callsData.bundleId, bundleDescriptor]
    ).catch((error) => {
      // Allow a later snapshot to retry the write.
      lastRecordedBundleRef.current = '';
      console.error('Failed to record sendCalls bundle progress', error);
    });
  }, [
    approvedContext.chainId,
    allTransactionsSuccessful,
    callsData.atomicRequired,
    callsData.bundleId,
    callsData.reservationId,
    controllerEmitter,
    host,
    progressSubmissionId,
    requestSmartAccount.supportsAtomicBatch,
    transactionStatuses,
  ]);

  // Watch for when all transactions are completed and dispatch response
  useEffect(() => {
    if (
      mountedRef.current &&
      !settlementStartedRef.current &&
      allTransactionsSuccessful &&
      !confirmed &&
      transactionStatuses &&
      canReturnBundleId()
    ) {
      setConfirmed(true);
      closeTimerRef.current = setTimeout(() => {
        if (canReturnBundleId()) void finishPopup(true);
      }, 2000);
    }
  }, [
    approvedContext.chainId,
    allTransactionsSuccessful,
    callsData.atomicRequired,
    callsData.bundleId,
    callsData.reservationId,
    completionRevision,
    confirmed,
    controllerEmitter,
    eventName,
    host,
    progressSubmissionId,
    requestSmartAccount.supportsAtomicBatch,
    transactionStatuses,
  ]);

  const handleApprove = async () => {
    if (
      !mountedRef.current ||
      settlementStartedRef.current ||
      rejectionStartedRef.current ||
      submissionInFlightRef.current ||
      pendingCompletionRef.current ||
      unknownSubmissionRef.current ||
      callsData.calls?.every((_, index) =>
        acknowledgedCallsRef.current.has(index)
      ) ||
      hasUnknownSubmission ||
      !hasCurrentFeeQuote ||
      Boolean(feeQuoteError)
    )
      return;
    submissionInFlightRef.current = true;
    const generation = eoaLifetimeRef.current;
    try {
      setIsPqSigning(false);
      setLoading(true);
      setConfirmed(false); // Reset confirmed state for each attempt

      if (
        approvedAccount?.address?.toLowerCase() !==
          approvedContext.account.address.toLowerCase() ||
        (callsData.from &&
          callsData.from.toLowerCase() !==
            approvedContext.account.address.toLowerCase())
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);

      if (
        callsData.atomicRequired &&
        !requestSmartAccount.supportsAtomicBatch
      ) {
        setLoading(false);
        alert.error(t('send.atomicNotSupportedDescription'));
        return;
      }

      // Only acknowledged calls may be omitted on retry, never user-selected
      // subsets. The ref also protects retained handlers from stale renders.
      const shouldSubmitCall = (_: unknown, index: number) =>
        !acknowledgedCallsRef.current.has(index);
      const selectedCallsData = callsData.calls.filter(shouldSubmitCall);
      const selectedIndices = callsData.calls
        .map((_, index) => index)
        .filter((index) => shouldSubmitCall(callsData.calls[index], index));

      const from = callsData.from || approvedContext.account.address;

      let sequence = eoaSequenceRef.current;
      if (!requestSmartAccount.supportsAtomicBatch && !sequence) {
        try {
          sequence = createEoaCallsSequence({
            version: callsData.version,
            atomicRequired: callsData.atomicRequired,
            calls: callsData.calls,
            ...(callsData.capabilities === undefined
              ? {}
              : { capabilities: callsData.capabilities }),
            from,
            chainId: approvedContext.chainId,
          });
          eoaSequenceRef.current = sequence;
        } catch (error) {
          await recordCompletedSubmission(true, []);
          throw error;
        }
      }

      // Pre-resolve ENS names in batch when multiple ENS destinations are present
      let batchEnsMap: Record<string, string | null> = {};
      try {
        const ensNamesToResolve = Array.from(
          new Set(
            selectedCallsData
              .map((call) => String(call.to || '').toLowerCase())
              .filter((to) => to && !to.startsWith('0x') && to.endsWith('.eth'))
              .filter((toLower) => !(toLower in ensNameToAddress))
          )
        );
        if (
          !requestSmartAccount.supportsAtomicBatch &&
          ensNamesToResolve.length >= 2
        ) {
          batchEnsMap = (await controllerEmitter(
            ['wallet', 'batchResolveEns'],
            [ensNamesToResolve]
          )) as Record<string, string | null>;
        }
      } catch (e) {
        // Non-fatal; fall back to per-name resolution inside the loop
        batchEnsMap = {};
      }

      // Reset status only for selected transactions (for retry functionality)
      setTransactionStatuses((prev) => {
        const newStatuses = prev
          ? [...prev]
          : new Array(callsData.calls.length).fill({ status: 'pending' });
        selectedIndices.forEach((index) => {
          newStatuses[index] = { status: 'pending' };
        });
        return newStatuses;
      });

      if (requestSmartAccount.supportsAtomicBatch) {
        let smartSubmissionInvoked = false;
        try {
          const approvedQuote = feeQuote;
          if (
            !approvedQuote ||
            approvedQuote.key !== currentFeeQuoteKeyRef.current
          )
            throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
              transactionNotBroadcast: true,
            });
          setReviewedDestinations((previous) =>
            Object.freeze({ ...previous, ...approvedQuote.destinations })
          );
          for (const originalIndex of selectedIndices) {
            setProcessingIndex(originalIndex);
            setTransactionStatuses((prev) => {
              const newStatuses = [...prev];
              newStatuses[originalIndex] = { status: 'signing' };
              return newStatuses;
            });
          }

          const response = (await signAndSubmitSmartAccountExecutions({
            accountAddress: approvedContext.account.address,
            accountId: approvedContext.account.id,
            authenticatorContexts: getSmartAccountLocalOwnerContexts({
              accounts,
              controllerEmitter,
            }),
            controllerEmitter,
            executions: approvedQuote.executions,
            expectedContext: approvedContext,
            maximumUserOpFeeWei: approvedQuote.maximumFeeWei,
            onPrepared: () => {
              if (
                !mountedRef.current ||
                settlementStartedRef.current ||
                approvedQuote.key !== currentFeeQuoteKeyRef.current
              )
                throw Object.assign(
                  new Error(EVM_TRANSACTION_CONTEXT_CHANGED),
                  {
                    transactionNotBroadcast: true,
                  }
                );
            },
            onAssertionResolved: () => {
              selectedIndices.forEach((index) => {
                setTransactionStatuses((prev) => {
                  const newStatuses = [...prev];
                  newStatuses[index] = { status: 'sending' };
                  return newStatuses;
                });
              });
            },
            onAuthenticatorSigningResolved: (authenticator) => {
              if (authenticator === 'slh-dsa') {
                setIsPqSigning(false);
              }
            },
            onAuthenticatorSigningStarted: (authenticator) => {
              if (authenticator === 'slh-dsa') {
                setIsPqSigning(true);
              }
            },
            onSubmissionNotBroadcast: async () => {
              if (!(await markSubmissionNotBroadcast()))
                throw new Error(t('send.sendError'));
              smartSubmissionInvoked = false;
            },
            onBeforeSubmit: async ({ executionContextId }) => {
              if (
                !mountedRef.current ||
                settlementStartedRef.current ||
                approvedQuote.key !== currentFeeQuoteKeyRef.current
              )
                throw Object.assign(
                  new Error(EVM_TRANSACTION_CONTEXT_CHANGED),
                  {
                    transactionNotBroadcast: true,
                  }
                );
              await markSubmissionStarted(executionContextId);
              if (!mountedRef.current)
                throw Object.assign(
                  new Error(EVM_TRANSACTION_CONTEXT_CHANGED),
                  {
                    transactionNotBroadcast: true,
                  }
                );
              smartSubmissionInvoked = true;
            },
            smartAccount: approvedAccount.smartAccount,
          })) as any;
          const txHash = response.hash || response;
          selectedIndices.forEach((index) =>
            acknowledgedCallsRef.current.add(index)
          );

          try {
            await recordCompletedSubmission(false, [txHash]);
          } catch (error) {
            console.error('Failed to persist acknowledged smart batch', error);
            stopUnknownSubmission(selectedIndices, txHash);
            return;
          }

          selectedIndices.forEach((index) => {
            setTransactionStatuses((prev) => {
              const newStatuses = [...prev];
              newStatuses[index] = { status: 'success', txHash };
              return newStatuses;
            });
          });
          setProcessingIndex(-1);
          setLoading(false);
          alert.success(t('send.txSuccessfull'));
          return;
        } catch (error) {
          if (
            error?.message === SMART_ACCOUNT_FEE_QUOTE_CHANGED &&
            smartSubmissionInvoked
          )
            error = Object.assign(new Error(error.message), error, {
              transactionNotBroadcast: false,
            });
          if (isSmartAccountFeeQuoteChanged(error) && !smartSubmissionInvoked) {
            setFeeQuoteNeedsRefresh(true);
            setFeeQuoteError(t('send.smartAccountFeeQuoteChanged'));
            setLoading(false);
            setProcessingIndex(-1);
            return;
          }
          console.error('Failed to process smart account batch calls', error);
          const txHash = /^0x[0-9a-fA-F]{64}$/.test(
            error?.transactionHash || ''
          )
            ? error.transactionHash
            : undefined;
          const unknown =
            !txHash &&
            smartSubmissionInvoked &&
            error?.transactionNotBroadcast !== true;
          if (unknown) unknownSubmissionRef.current = true;
          if (!txHash && error?.transactionNotBroadcast === true)
            await markSubmissionNotBroadcast();
          if (!unknown && smartSubmissionInvoked) {
            if (txHash)
              selectedIndices.forEach((index) =>
                acknowledgedCallsRef.current.add(index)
              );
            try {
              await recordCompletedSubmission(!txHash, txHash ? [txHash] : []);
            } catch (persistenceError) {
              console.error(
                'Failed to persist smart batch outcome',
                persistenceError
              );
              if (txHash) {
                stopUnknownSubmission(selectedIndices, txHash);
                return;
              }
            }
          }
          const legacyKey = legacyEvmNonceErrorKey(error);
          const errorMessage = unknown
            ? t('send.submissionStatusUnknown')
            : legacyKey
            ? t(legacyKey)
            : getSafeSmartAccountCallErrorMessage(
                error,
                t('send.sendError'),
                t('transactions.psbtSigningContextChanged')
              );
          selectedIndices.forEach((index) => {
            setTransactionStatuses((prev) => {
              const newStatuses = [...prev];
              newStatuses[index] = {
                status: txHash ? 'success' : unknown ? 'unknown' : 'error',
                ...(txHash ? { txHash } : { error: errorMessage }),
              };
              return newStatuses;
            });
          });
          setLoading(false);
          setProcessingIndex(-1);
          if (txHash) alert.success(t('send.txSuccessfull'));
          else alert.error(errorMessage);
          return;
        } finally {
          setIsPqSigning(false);
        }
      }

      if (!sequence) throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      const outcome = await sequence.run({
        assertCurrent() {
          if (
            !mountedRef.current ||
            generation !== eoaLifetimeRef.current ||
            settlementStartedRef.current ||
            rejectionStartedRef.current
          )
            throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
        },
        nonce: async () =>
          (await controllerEmitter(
            ['wallet', 'getRecommendedNonceForBatch'],
            [from]
          )) as number,
        async resolveAddress(call) {
          const raw = String(call.to || '');
          const lower = raw.toLowerCase();
          if (!raw) return undefined;
          if (lower.startsWith('0x')) return raw;
          if (!lower.endsWith('.eth'))
            throw new Error(t('send.invalidDestination'));
          let resolved =
            (lower in batchEnsMap ? batchEnsMap[lower] : undefined) ??
            ensNameToAddress[lower] ??
            null;
          if (!resolved) {
            try {
              const address = await controllerEmitter(
                ['wallet', 'resolveEns'],
                [raw]
              );
              resolved = typeof address === 'string' ? address : null;
            } catch {
              resolved = null;
            }
          }
          if (!resolved) throw new Error(t('send.unableToResolveEns'));
          return resolved;
        },
        begin: () => markSubmissionStarted(),
        async prepare(transaction, index): Promise<EoaFeeReview> {
          const value = (await controllerEmitter(
            ['wallet', 'reviewDappEvmFee'],
            [transaction]
          )) as EoaFeeReview;
          const quote = Object.freeze({
            ...value,
            transaction: snapshotPreparedEvmTransaction(value.transaction),
          });
          if (
            !mountedRef.current ||
            generation !== eoaLifetimeRef.current ||
            settlementStartedRef.current ||
            !Number.isSafeInteger(quote.validForMs) ||
            quote.validForMs <= 0 ||
            quote.validForMs > 90_000 ||
            typeof quote.id !== 'string'
          ) {
            void controllerEmitter(
              ['wallet', 'discardNativeEvmFeeReview'],
              [quote.id]
            ).catch(() => undefined);
            throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
          }
          return new Promise<EoaFeeReview>((resolve, reject) => {
            const timer = setTimeout(() => {
              if (eoaDecisionRef.current?.quote !== quote) return;
              eoaDecisionRef.current = undefined;
              if (mountedRef.current) setEoaFeeReview(undefined);
              void controllerEmitter(
                ['wallet', 'discardNativeEvmFeeReview'],
                [quote.id]
              ).catch(() => undefined);
              reject(
                Object.assign(new Error(t('privacy.deposit.expired')), {
                  transactionNotBroadcast: true,
                })
              );
            }, quote.validForMs);
            eoaDecisionRef.current = {
              index,
              quote,
              timer,
              expires: Date.now() + quote.validForMs,
              resolve,
              reject,
            };
            setReviewedDestinations((previous) =>
              Object.freeze({
                ...previous,
                [index]: quote.transaction.to || '',
              })
            );
            setEoaFeeReview({ index, quote });
            setLoading(false);
          });
        },
        send: (review, submissionId) =>
          controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [
              review.transaction,
              review.transaction.type === 0,
              undefined,
              undefined,
              {
                expectedContext: approvedContext,
                genericReviewId: review.id,
                sendCallsSubmissionId: submissionId,
              },
            ],
            approvedAccount.isTrezorWallet || approvedAccount.isLedgerWallet
              ? 300000
              : 10000,
            false
          ),
        persistHash: recordBroadcastHash,
        persistStopped: async (attempt) => {
          await controllerEmitter(
            ['wallet', 'recordStoppedEoaCalls'],
            [
              host,
              callsData.bundleId,
              callsData.reservationId,
              lastStartedSubmissionRef.current,
              attempt,
            ]
          );
        },
        recordNotBroadcast: markSubmissionNotBroadcast,
        persistCompletion: (value) =>
          recordCompletedSubmission(value.failed, [...value.hashes]),
        update(progress) {
          if (progress.hash) acknowledgedCallsRef.current.add(progress.index);
          if (progress.status === 'unknown') {
            stopUnknownSubmission([progress.index], progress.hash);
            return;
          }
          if (!mountedRef.current || settlementStartedRef.current) return;
          if (progress.status === 'signing' || progress.status === 'sending')
            setProcessingIndex(progress.index);
          const error = progress.failure?.cause;
          const legacyKey = legacyEvmNonceErrorKey(error);
          const errorMessage = progress.failure
            ? legacyKey
              ? t(legacyKey)
              : getSafeSmartAccountCallErrorMessage(
                  error,
                  t('send.sendError'),
                  t('transactions.psbtSigningContextChanged')
                )
            : undefined;
          setTransactionStatuses((previous) => {
            const statuses = previous
              ? [...previous]
              : new Array(callsData.calls.length).fill({ status: 'pending' });
            statuses[progress.index] = {
              status: progress.status,
              ...(progress.hash ? { txHash: progress.hash } : {}),
              ...(errorMessage ? { error: errorMessage } : {}),
            };
            return statuses;
          });
        },
      });
      if (
        outcome.status !== 'finished' ||
        !mountedRef.current ||
        settlementStartedRef.current
      )
        return;
      setProcessingIndex(-1);
      setLoading(false);
      if (outcome.hashes.length) {
        alert.success(
          outcome.failed
            ? t('send.partialSuccess', {
                count: outcome.hashes.length,
                total: selectedCallsData.length,
              })
            : t('send.txSuccessfull')
        );
      } else alert.error(t('send.allTransactionsFailed'));
    } catch (error) {
      console.error('Failed to process batch calls', error);
      setIsPqSigning(false);
      setLoading(false);
      setConfirmed(false);
      setProcessingIndex(-1);
      alert.error(
        t(
          legacyEvmNonceErrorKey(error) ||
            (error?.message === EVM_TRANSACTION_CONTEXT_CHANGED
              ? 'transactions.psbtSigningContextChanged'
              : 'send.sendError')
        )
      );
    } finally {
      submissionInFlightRef.current = false;
    }
  };

  const startEoaBatch = () => {
    const run = handleApprove();
    eoaRunRef.current = run;
    void run.finally(() => {
      if (eoaRunRef.current === run) eoaRunRef.current = undefined;
    });
  };
  const startEoaRef = React.useRef(startEoaBatch);
  startEoaRef.current = startEoaBatch;
  useEffect(() => {
    if (
      initialLoading ||
      requestSmartAccount.supportsAtomicBatch ||
      eoaStartedRef.current
    )
      return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || eoaStartedRef.current || !mountedRef.current) return;
      eoaStartedRef.current = true;
      startEoaRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [initialLoading, requestSmartAccount.supportsAtomicBatch]);

  const confirmEoaCall = (id: string) => {
    const pending = eoaDecisionRef.current;
    if (!pending || pending.quote.id !== id || !mountedRef.current || rejecting)
      return;
    eoaDecisionRef.current = undefined;
    clearTimeout(pending.timer);
    setEoaFeeReview(undefined);
    if (Date.now() >= pending.expires) {
      pending.reject(
        Object.assign(new Error(t('privacy.deposit.expired')), {
          transactionNotBroadcast: true,
        })
      );
      return;
    }
    setLoading(true);
    pending.resolve(pending.quote);
  };

  const handleReject = async () => {
    const decision = eoaDecisionRef.current;
    if (decision && mountedRef.current && !settlementStartedRef.current) {
      eoaDecisionRef.current = undefined;
      clearTimeout(decision.timer);
      setEoaFeeReview(undefined);
      setRejecting(true);
      decision.reject(
        Object.assign(new Error('User rejected request'), {
          code: 4001,
          transactionNotBroadcast: true,
        })
      );
      void controllerEmitter(
        ['wallet', 'discardNativeEvmFeeReview'],
        [decision.quote.id]
      ).catch(() => undefined);
      await eoaRunRef.current;
      await finishPopup(canReturnBundleId());
      return;
    }
    if (
      !mountedRef.current ||
      settlementStartedRef.current ||
      rejectionStartedRef.current ||
      submissionInFlightRef.current
    )
      return;
    const pending = pendingCompletionRef.current;
    if (
      pending &&
      !unknownSubmissionRef.current &&
      durableHashesRef.current.size > 0
    ) {
      // Recovery retries storage only, never signing or submission.
      submissionInFlightRef.current = true;
      setRejecting(true);
      try {
        if (eoaSequenceRef.current)
          await eoaSequenceRef.current.retryCompletion();
        else await recordCompletedSubmission(pending.failed, pending.txHashes);
      } catch (error) {
        console.error(
          'Failed to persist calls completion before closing',
          error
        );
        if (mountedRef.current) {
          setRejecting(false);
          alert.error(t('send.sendError'));
        }
        return;
      } finally {
        submissionInFlightRef.current = false;
      }
    }
    await finishPopup(canReturnBundleId());
  };

  if (initialLoading) {
    return <LoadingComponent />;
  }

  if (!callsData || !callsData.calls || callsData.calls.length === 0) {
    return (
      <div className="h-screen flex flex-col">
        {/* Content */}
        <div className="items-center justify-center px-6">
          <div className="bg-bkg-3 rounded-2xl p-8 max-w-md w-full text-center">
            <div className="mb-6">
              <Icon
                name="warning"
                className="text-brand-yellowAccent mx-auto mb-4"
                size={48}
              />
            </div>
            <h2 className="text-xl font-medium text-brand-white mb-3">
              {t('send.noCallsProvided')}
            </h2>
            <p className="text-brand-gray200 text-sm mb-6">
              {t('send.noCallsProvidedDescription')}
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                variant="secondary"
                type="button"
                onClick={handleReject}
                disabled={rejecting}
              >
                {t('buttons.close')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-brand-blue600 p-4">
        <p className="text-sm text-brand-white break-all">{host}</p>
        <p className="text-sm text-brand-white break-all">
          {t('send.from')}: {approvedContext.account.address}
        </p>
        <p className="text-brand-gray200 text-sm mt-1">
          {callsData.atomicRequired
            ? t('send.atomicBatchRequired')
            : t('send.executingMultipleCalls', {
                count: callsData.calls.length,
              })}
        </p>
      </div>

      {/* Warning for atomic requirement */}
      {hasUnknownSubmission && (
        <p role="status" className="p-4 text-sm text-brand-yellow">
          {t('send.submissionStatusUnknown')}
        </p>
      )}
      {callsData.atomicRequired &&
        !requestSmartAccount.supportsAtomicBatch &&
        !loading && (
          <div className="bg-brand-yellowBg p-3 mx-4 mt-4 rounded-lg border border-brand-yellow">
            <div className="flex items-start gap-2">
              <Icon
                name="warning"
                className="text-brand-yellow mt-0.5"
                size={20}
              />
              <div>
                <p className="text-sm text-brand-white font-medium">
                  {t('send.atomicNotSupported')}
                </p>
                <p className="text-xs text-brand-gray200 mt-1">
                  {t('send.atomicNotSupportedDescription')}
                </p>
              </div>
            </div>
          </div>
        )}

      {/* Calls list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-40 remove-scrollbar">
        <div className="mt-4 space-y-3">
          {callsData.calls.map((call, index) => (
            <div
              key={index}
              className={`bg-bkg-3 rounded-lg p-4 border overflow-hidden ${
                effectiveSelectedCalls[index]
                  ? 'border-brand-blue400'
                  : 'border-brand-gray300 opacity-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      id={`call-${index}`}
                      checked={effectiveSelectedCalls[index]}
                      readOnly
                      className="w-4 h-4 text-brand-blue600 rounded"
                      disabled
                    />
                    <label
                      htmlFor={`call-${index}`}
                      className="text-sm font-medium text-brand-white cursor-pointer"
                    >
                      {t('send.call')} #{index + 1}
                    </label>
                    {transactionStatuses && transactionStatuses[index] && (
                      <>
                        {transactionStatuses[index].status === 'signing' && (
                          <span className="text-xs text-brand-yellow ml-2 flex items-center">
                            <Icon
                              name="loading"
                              className="animate-spin mr-1"
                              size={12}
                            />
                            {t('send.signing')}...
                          </span>
                        )}
                        {transactionStatuses[index].status === 'sending' && (
                          <span className="text-xs text-brand-blue ml-2 flex items-center">
                            <Icon
                              name="loading"
                              className="animate-spin mr-1"
                              size={12}
                            />
                            {t('send.sending')}...
                          </span>
                        )}
                        {transactionStatuses[index].status === 'success' && (
                          <span className="text-xs text-brand-green ml-2">
                            ✓ {t('send.sent')}
                          </span>
                        )}
                        {transactionStatuses[index].status === 'error' && (
                          <span className="text-xs text-brand-red ml-2">
                            ⚠ {t('send.failed')}
                          </span>
                        )}
                        {transactionStatuses[index].status === 'unknown' && (
                          <span className="text-xs text-brand-yellow ml-2">
                            {t('send.pending')}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {call.to && (
                    <div className="ml-6">
                      <p className="text-xs text-brand-gray200">
                        {t('send.to')}:
                      </p>
                      <div className="text-sm text-brand-white font-mono">
                        {(() => {
                          const toRaw = String(call.to);
                          // If the dapp passed an address, just show ellipsized address with tooltip=address
                          if (toRaw.startsWith('0x')) {
                            return (
                              <Tooltip content={toRaw}>
                                <span>{ellipsis(toRaw, 10, 10)}</span>
                              </Tooltip>
                            );
                          }

                          // The displayed target belongs to the exact review used
                          // for signing, independently of later ENS cache updates.
                          if (toRaw.toLowerCase().endsWith('.eth')) {
                            const status = transactionStatuses?.[index]?.status;
                            const resolved =
                              requestSmartAccount.supportsAtomicBatch
                                ? status === 'signing' ||
                                  status === 'sending' ||
                                  status === 'success' ||
                                  status === 'unknown'
                                  ? reviewedDestinations[index]
                                  : hasCurrentFeeQuote
                                  ? feeQuote?.destinations[index]
                                  : undefined
                                : reviewedDestinations[index];
                            return (
                              <Tooltip content={resolved || toRaw}>
                                <span>{toRaw}</span>
                              </Tooltip>
                            );
                          }

                          // Fallback: show as provided
                          return (
                            <Tooltip content={toRaw}>
                              <span>{toRaw}</span>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {call.value && call.value !== '0x0' && (
                    <div className="ml-6 mt-2">
                      <p className="text-xs text-brand-gray200">
                        {t('send.value')}:
                      </p>
                      <p className="text-sm text-brand-white">
                        {formatEther(call.value)} {activeNetwork.currency}
                      </p>
                    </div>
                  )}

                  {call.data && call.data !== '0x' && (
                    <div className="ml-6 mt-2">
                      <p className="text-xs text-brand-gray200">
                        {t('send.data')}:
                      </p>
                      {(() => {
                        const decodedCallData = decodeCommonCallData(call.data);
                        return (
                          <div>
                            {decodedCallData && (
                              <p className="text-sm text-brand-white">
                                {decodedCallData.name}
                              </p>
                            )}
                            {decodedCallData?.params && (
                              <div className="mt-1 space-y-1">
                                {Object.entries(decodedCallData.params).map(
                                  ([key, value]) => (
                                    <p
                                      className="text-xs text-brand-gray200 font-mono break-all"
                                      key={key}
                                    >
                                      {key}:{' '}
                                      {formatDecodedCallValue(value as any)}
                                    </p>
                                  )
                                )}
                              </div>
                            )}
                            <details className="mt-1">
                              <summary
                                tabIndex={0}
                                style={{
                                  scrollMarginBottom:
                                    'var(--pali-toast-footer-clearance)',
                                }}
                                className="cursor-pointer text-xs text-brand-gray200 font-mono break-all"
                              >
                                {t('send.hex')}: {ellipsis(call.data, 20, 4)}
                              </summary>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-brand-gray200 font-mono">
                                {call.data}
                              </pre>
                            </details>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {transactionStatuses && transactionStatuses[index]?.error && (
                    <div className="ml-6 mt-2">
                      <p className="text-xs text-brand-red">
                        {t('send.error')}:
                      </p>
                      <p className="text-sm text-brand-red break-words">
                        {ellipsis(transactionStatuses[index].error, 60, 10)}
                      </p>
                    </div>
                  )}

                  {processingIndex === index && (
                    <div className="ml-6 mt-2">
                      <div className="flex items-center gap-2">
                        <div className="animate-pulse bg-brand-blue rounded h-1 flex-1"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Total value */}
        {eoaFeeReview && (
          <section
            className="m-4 rounded-lg bg-bkg-2 p-4"
            aria-label={t('send.networkFee')}
          >
            <p className="text-sm text-brand-gray200">
              {t('transactions.replay.maximumFee')}
            </p>
            <p className="break-all text-lg font-bold text-brand-white">
              {formatEther(eoaFeeReview.quote.maximumFeeUnits)}{' '}
              {activeNetwork.currency}
            </p>
            <p className="mt-2 text-sm text-brand-gray200">{t('send.total')}</p>
            <p className="break-all text-brand-white">
              {formatEther(eoaFeeReview.quote.maximumTotalUnits)}{' '}
              {activeNetwork.currency}
            </p>
          </section>
        )}
        {requestSmartAccount.supportsAtomicBatch && (
          <div className="mt-4 p-4 bg-bkg-2 rounded-lg">
            <p className="text-sm text-brand-gray200">
              {t('send.smartAccountMaxFee')}
            </p>
            <p className="text-lg font-bold text-brand-white">
              {hasCurrentFeeQuote && feeQuote
                ? `${formatEther(feeQuote.maximumFeeWei)} ${
                    activeNetwork.currency
                  }`
                : feeQuoteError
                ? t('send.feeUnavailable')
                : t('send.calculating')}
            </p>
            <p className="text-xs text-brand-gray200 mt-1">
              {t('send.smartAccountFeeDetails')}
            </p>
            {feeQuoteError && (
              <div role="alert" className="mt-2 text-sm text-brand-red">
                <p>{feeQuoteError}</p>
                <Button
                  type="button"
                  disabled={loading || rejecting}
                  onClick={() => {
                    setFeeQuoteNeedsRefresh(true);
                    setFeeQuoteRevision((revision) => revision + 1);
                  }}
                >
                  {t('send.refreshFeeQuote')}
                </Button>
              </div>
            )}
          </div>
        )}
        {totalValue !== '0' && (
          <div className="mt-4 p-4 bg-bkg-2 rounded-lg">
            <div className="flex min-w-0 justify-between items-center gap-3">
              <p className="shrink-0 text-sm text-brand-gray200">
                {t('send.totalValue')}:
              </p>
              <p className="min-w-0 text-right text-lg font-bold text-brand-white [overflow-wrap:anywhere]">
                {formatEther(totalValue)} {activeNetwork.currency}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        <PqSigningOverlay
          expectedSeconds={90}
          show={isPqSigning}
          subtitle={t('settings.slhDsaSigningOverlayDescription')}
          title={t('settings.slhDsaSigningInProgress')}
          warningSeconds={180}
        />
        {/* Progress indicator */}
        {loading && transactionStatuses && (
          <div className="mb-3 px-4">
            <div className="flex items-center justify-between text-xs text-brand-gray200 mb-1">
              <span>{t('send.progress')}</span>
              <span>
                {
                  transactionStatuses.filter(
                    (s) => s && (s.status === 'success' || s.status === 'error')
                  ).length
                }{' '}
                / {effectiveSelectedCalls.filter((s) => s).length}
              </span>
            </div>
            <div className="w-full bg-bkg-2 rounded-full h-2">
              <div
                className="bg-brand-blue h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    (transactionStatuses.filter(
                      (s) =>
                        s && (s.status === 'success' || s.status === 'error')
                    ).length /
                      effectiveSelectedCalls.filter((s) => s).length) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <Button
            variant="secondary"
            type="button"
            onClick={handleReject}
            disabled={(loading && !eoaFeeReview) || rejecting}
          >
            {confirmed || canReturnBundleId() || pendingCompletionRef.current
              ? t('buttons.close')
              : t('buttons.reject')}
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() =>
              requestSmartAccount.supportsAtomicBatch
                ? void handleApprove()
                : eoaFeeReview
                ? confirmEoaCall(eoaFeeReview.quote.id)
                : startEoaBatch()
            }
            disabled={
              (loading && !eoaFeeReview) ||
              rejecting ||
              confirmed ||
              Boolean(pendingCompletionRef.current) ||
              !hasUnsuccessfulSelected ||
              !hasCurrentFeeQuote ||
              Boolean(feeQuoteError)
            }
            loading={loading && !eoaFeeReview}
          >
            {eoaFeeReview
              ? `${t('buttons.confirm')} ${eoaFeeReview.index + 1}/${
                  callsData.calls.length
                }`
              : loading
              ? confirmed
                ? t('send.sending')
                : t('send.signing')
              : confirmed
              ? t('send.complete')
              : t('send.sign')}
          </Button>
        </div>
      </ToastActionFooter>
    </div>
  );
};
