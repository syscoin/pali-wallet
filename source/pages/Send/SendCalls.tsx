import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';

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
      executions: SmartAccountExecutionIntent[];
      key: string;
    }
  >();
  const quoteCalls = (callsData.calls || []).filter(
    (_, index) =>
      effectiveSelectedCalls[index] &&
      transactionStatuses?.[index]?.status !== 'success'
  );
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
      const executions: SmartAccountExecutionIntent[] = [];
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
        executions.push({
          target,
          data: call.data || '0x',
          value: call.value || '0x0',
        });
      }
      if (cancelled) return;
      const preparedQuote = await prepareSmartAccountFeeQuote({
        accountAddress: approvedContext.account.address,
        accountId: approvedContext.account.id,
        controllerEmitter,
        executions,
        expectedContext: approvedContext,
      });
      if (!cancelled) {
        setFeeQuote({ ...preparedQuote, executions, key: feeQuoteKey });
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
  const markSubmissionStarted = async () => {
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
            txHashes: [],
          },
        ]
      );
      lastStartedSubmissionRef.current = submissionId;
      terminalSubmissionRef.current = undefined;
      pendingCompletionRef.current = undefined;
      setProgressSubmissionId(submissionId);
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
    } catch (error) {
      console.error('Failed to record definite sendCalls rejection', error);
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

      const receipts: any[] = [];
      const from = callsData.from || approvedContext.account.address;

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

      // Get the starting nonce once via MainController (avoids web3Provider issues)
      const startingNonce = requestSmartAccount.supportsAtomicBatch
        ? 0
        : ((await controllerEmitter(
            ['wallet', 'getRecommendedNonceForBatch'],
            [from]
          )) as number);
      if (!mountedRef.current || settlementStartedRef.current) return;
      // Track the nonce we actually use to avoid gaps when skipping transactions
      let currentNonce = startingNonce;

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
            onBeforeSubmit: async () => {
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
              await markSubmissionStarted();
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
          const errorMessage = unknown
            ? t('send.submissionStatusUnknown')
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

      // Sign and send each transaction with incremented nonces
      for (let i = 0; i < selectedCallsData.length; i++) {
        if (!mountedRef.current || settlementStartedRef.current) return;
        let submissionInvoked = false;
        const call = selectedCallsData[i];
        const originalIndex = selectedIndices[i];
        setProcessingIndex(originalIndex);

        // Update status to signing
        setTransactionStatuses((prev) => {
          const newStatuses = [...prev];
          newStatuses[originalIndex] = { status: 'signing' };
          return newStatuses;
        });

        try {
          // Resolve ENS names in 'to' if needed and ensure we only send hex addresses
          let toResolved: string | undefined = call.to;
          const toRaw = String(call.to || '');
          if (toRaw) {
            const lower = toRaw.toLowerCase();
            const isHex = lower.startsWith('0x');
            const isEns = lower.endsWith('.eth');
            if (!isHex) {
              if (isEns) {
                const cached = ensNameToAddress[lower];
                // Prefer batch result (if available), then cache
                let resolved: string | null =
                  (batchEnsMap && lower in batchEnsMap
                    ? batchEnsMap[lower]
                    : undefined) ??
                  cached ??
                  null;
                if (!resolved) {
                  try {
                    resolved = (await controllerEmitter(
                      ['wallet', 'resolveEns'],
                      [toRaw]
                    )) as string | null;
                  } catch (_) {
                    resolved = null;
                  }
                }
                if (!resolved) {
                  // If atomic batch required, abort entire process
                  if (callsData.atomicRequired) {
                    setTransactionStatuses((prev) => {
                      const newStatuses = prev
                        ? [...prev]
                        : new Array(callsData.calls.length).fill({
                            status: 'pending',
                          });
                      newStatuses[originalIndex] = {
                        status: 'error',
                        error: t('send.unableToResolveEns'),
                      } as any;
                      return newStatuses;
                    });
                    setLoading(false);
                    setProcessingIndex(-1);
                    alert.error(t('send.unableToResolveEns'));
                    return;
                  }
                  // Stop at the unsent call so retries preserve request order.
                  setTransactionStatuses((prev) => {
                    const newStatuses = prev
                      ? [...prev]
                      : new Array(callsData.calls.length).fill({
                          status: 'pending',
                        });
                    newStatuses[originalIndex] = {
                      status: 'error',
                      error: t('send.unableToResolveEns'),
                    } as any;
                    return newStatuses;
                  });
                  receipts.push({ status: '0x0' });
                  break;
                }
                toResolved = resolved;
              } else {
                // Not a hex address or recognized ENS name; treat as invalid
                if (callsData.atomicRequired) {
                  setTransactionStatuses((prev) => {
                    const newStatuses = prev
                      ? [...prev]
                      : new Array(callsData.calls.length).fill({
                          status: 'pending',
                        });
                    newStatuses[originalIndex] = {
                      status: 'error',
                      error: t('send.invalidDestination'),
                    } as any;
                    return newStatuses;
                  });
                  setLoading(false);
                  setProcessingIndex(-1);
                  alert.error(t('send.invalidDestination'));
                  return;
                }
                setTransactionStatuses((prev) => {
                  const newStatuses = prev
                    ? [...prev]
                    : new Array(callsData.calls.length).fill({
                        status: 'pending',
                      });
                  newStatuses[originalIndex] = {
                    status: 'error',
                    error: t('send.invalidDestination'),
                  } as any;
                  return newStatuses;
                });
                receipts.push({ status: '0x0' });
                break;
              }
            }
          }

          // Prepare transaction
          // Include 'to' whenever a hex address is provided (including zero address)
          const candidateTo =
            toResolved && toResolved.startsWith('0x') ? toResolved : undefined;
          const toField = candidateTo;

          const tx: any = {
            from,
            chainId: approvedContext.chainId,
            value: call.value || '0x0',
            data: call.data || '0x',
            nonce: currentNonce, // Increment only when a tx is actually sent to avoid gaps
            ...(toField ? { to: toField } : {}),
          };

          // Update status to sending
          setTransactionStatuses((prev) => {
            const newStatuses = [...prev];
            newStatuses[originalIndex] = { status: 'sending' };
            return newStatuses;
          });

          // Use the same method as SendTransaction
          await markSubmissionStarted();
          if (!mountedRef.current || settlementStartedRef.current) return;
          submissionInvoked = true;
          const response = (await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [
              tx,
              false,
              undefined,
              undefined,
              { expectedContext: approvedContext },
            ],
            approvedAccount.isTrezorWallet || approvedAccount.isLedgerWallet
              ? 300000
              : 10000,
            false
          )) as any;

          const txHash = response.hash || response;
          acknowledgedCallsRef.current.add(originalIndex);

          try {
            // Persist each acknowledged hash before the next sender can start.
            await recordBroadcastHash(txHash);
          } catch (error) {
            console.error('Failed to persist acknowledged call', error);
            stopUnknownSubmission([originalIndex], txHash);
            return;
          }
          receipts.push({
            transactionHash: txHash,
            status: '0x1',
          });

          // Update status to success
          setTransactionStatuses((prev) => {
            const newStatuses = [...prev];
            newStatuses[originalIndex] = { status: 'success', txHash };
            return newStatuses;
          });

          // Only advance nonce when a transaction was successfully broadcast
          currentNonce += 1;

          // No delay needed - using incremented nonces prevents conflicts
        } catch (error) {
          console.error(`Failed to process call ${i}:`, error);
          const txHash = /^0x[0-9a-fA-F]{64}$/.test(
            error?.transactionHash || ''
          )
            ? error.transactionHash
            : undefined;
          if (txHash) {
            acknowledgedCallsRef.current.add(originalIndex);
            try {
              await recordBroadcastHash(txHash);
            } catch (persistenceError) {
              console.error(
                'Failed to persist acknowledged call error',
                persistenceError
              );
              stopUnknownSubmission([originalIndex], txHash);
              return;
            }
            receipts.push({ transactionHash: txHash, status: '0x1' });
            setTransactionStatuses((prev) => {
              const newStatuses = [...prev];
              newStatuses[originalIndex] = { status: 'success', txHash };
              return newStatuses;
            });
            currentNonce += 1;
            if (error?.message === EVM_TRANSACTION_CONTEXT_CHANGED) {
              if (i + 1 < selectedCallsData.length)
                receipts.push({
                  status: '0x0',
                  error: EVM_TRANSACTION_CONTEXT_CHANGED,
                });
              break;
            }
            continue;
          }
          const unknown =
            submissionInvoked && error?.transactionNotBroadcast !== true;
          if (unknown) unknownSubmissionRef.current = true;
          if (error?.transactionNotBroadcast === true)
            await markSubmissionNotBroadcast();
          const errorMessage = unknown
            ? t('send.submissionStatusUnknown')
            : getSafeSmartAccountCallErrorMessage(
                error,
                t('send.sendError'),
                t('transactions.psbtSigningContextChanged')
              );
          receipts.push({
            status: '0x0',
            error: errorMessage,
          });

          // Update status to error
          setTransactionStatuses((prev) => {
            const newStatuses = [...prev];
            newStatuses[originalIndex] = {
              status: unknown ? 'unknown' : 'error',
              error: errorMessage,
            };
            return newStatuses;
          });
          if (unknown) {
            setLoading(false);
            setProcessingIndex(-1);
            alert.error(errorMessage);
            return;
          }
          // A retry must remain an ordered suffix of the original request.
          // Do not submit later calls past one that never reached broadcast.
          break;
        }
      }

      setProcessingIndex(-1);
      setLoading(false);

      // Check if any transactions succeeded
      const successCount = receipts.filter((r) => r.status === '0x1').length;
      const hasErrors = receipts.some((r) => r.status === '0x0');
      await recordCompletedSubmission(
        hasErrors,
        receipts
          .map((receipt) => receipt.transactionHash)
          .filter((txHash): txHash is string => Boolean(txHash))
      );

      if (successCount > 0) {
        if (hasErrors) {
          alert.success(
            t('send.partialSuccess', {
              count: successCount,
              total: selectedCallsData.length,
            })
          );
        } else {
          alert.success(t('send.txSuccessfull'));
        }

        // Completion will be handled by useEffect when all transactions are successful
      } else {
        // All transactions failed
        alert.error(t('send.allTransactionsFailed'));
      }
    } catch (error) {
      console.error('Failed to process batch calls', error);
      setIsPqSigning(false);
      setLoading(false);
      setConfirmed(false);
      setProcessingIndex(-1);
      alert.error(
        t(
          error?.message === EVM_TRANSACTION_CONTEXT_CHANGED
            ? 'transactions.psbtSigningContextChanged'
            : 'send.sendError'
        )
      );
    } finally {
      submissionInFlightRef.current = false;
    }
  };

  const handleReject = async () => {
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
        await recordCompletedSubmission(pending.failed, pending.txHashes);
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

                          // If the dapp passed an ENS name, prefer ENS as text; tooltip should be resolved address if available
                          if (toRaw.toLowerCase().endsWith('.eth')) {
                            const resolved =
                              ensNameToAddress[toRaw.toLowerCase()];
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
            disabled={loading || rejecting}
          >
            {confirmed || canReturnBundleId() || pendingCompletionRef.current
              ? t('buttons.close')
              : t('buttons.reject')}
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={handleApprove}
            disabled={
              loading ||
              rejecting ||
              confirmed ||
              Boolean(pendingCompletionRef.current) ||
              !hasUnsuccessfulSelected ||
              !hasCurrentFeeQuote ||
              Boolean(feeQuoteError)
            }
            loading={loading}
          >
            {loading
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
