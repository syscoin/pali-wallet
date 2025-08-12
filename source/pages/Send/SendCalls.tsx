import { BigNumber } from '@ethersproject/bignumber';
import { formatEther } from '@ethersproject/units';
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';

import {
  PrimaryButton,
  SecondaryButton,
  Icon,
  Tooltip,
} from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectEnsNameToAddress } from 'state/vault/selectors';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/format';
import { clearNavigationState } from 'utils/navigationState';

interface ISendCallsData {
  atomicRequired: boolean;
  calls: Array<{
    capabilities?: Record<string, any>;
    data?: string;
    to?: string;
    value?: string;
  }>;
  capabilities?: Record<string, any>;
  chainId: string;
  from?: string;
  version: string;
}

export const SendCalls = () => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const { controllerEmitter } = useController();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  // Get data from query parameters or location state
  const { host, eventName, ...externalData } = useQueryData();

  const callsData: ISendCallsData = externalData;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [selectedCalls, setSelectedCalls] = useState<boolean[]>([]);
  const [processingIndex, setProcessingIndex] = useState<number>(-1);
  const [transactionStatuses, setTransactionStatuses] = useState<
    Array<{
      error?: string;
      status: 'pending' | 'signing' | 'sending' | 'success' | 'error';
      txHash?: string;
    }>
  >();

  // Reverse ENS cache: name -> address (lowercased)
  const ensNameToAddress = useSelector(selectEnsNameToAddress);

  // Initialize selected calls
  useEffect(() => {
    if (callsData.calls && callsData.calls.length > 0) {
      setSelectedCalls(new Array(callsData.calls.length).fill(true));
    }
    setInitialLoading(false);
  }, [callsData.calls]);

  // Calculate total value
  const totalValue = useMemo(() => {
    if (!callsData.calls) return '0';

    return callsData.calls
      .reduce((sum, call, index) => {
        if (!selectedCalls[index] || !call.value) return sum;
        try {
          return sum.add(BigNumber.from(call.value));
        } catch {
          return sum;
        }
      }, BigNumber.from(0))
      .toString();
  }, [callsData.calls, selectedCalls]);

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
  const hasUnsuccessfulSelected = useMemo(
    () =>
      selectedCalls.some(
        (selected, index) =>
          selected &&
          (!transactionStatuses?.[index] ||
            transactionStatuses[index].status !== 'success')
      ),
    [selectedCalls, transactionStatuses]
  );

  // Watch for when all transactions are completed and dispatch response
  useEffect(() => {
    if (allTransactionsSuccessful && !confirmed && transactionStatuses) {
      setConfirmed(true);

      const response = {
        id: `0x${uuidv4().replace(/-/g, '')}`,
        capabilities: {},
      };

      // Close window after a short delay
      setTimeout(() => {
        clearNavigationState();
        // Dispatch event right before closing
        dispatchBackgroundEvent(`${eventName}.${host}`, response);
        window.close();
      }, 2000);
    }
  }, [allTransactionsSuccessful, confirmed, transactionStatuses, eventName]);

  const handleApprove = async () => {
    try {
      setLoading(true);
      setConfirmed(false); // Reset confirmed state for each attempt

      // Filter calls based on selection AND exclude already successful transactions
      const selectedCallsData = callsData.calls.filter(
        (_, index) =>
          selectedCalls[index] &&
          (!transactionStatuses?.[index] ||
            transactionStatuses[index].status !== 'success')
      );
      const selectedIndices = callsData.calls
        .map((_, index) => index)
        .filter(
          (index) =>
            selectedCalls[index] &&
            (!transactionStatuses?.[index] ||
              transactionStatuses[index].status !== 'success')
        );

      const receipts: any[] = [];
      const from = callsData.from || activeAccount.address;

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
        if (ensNamesToResolve.length >= 2) {
          batchEnsMap = (await controllerEmitter(
            ['wallet', 'batchResolveEns'],
            [ensNamesToResolve, { fallbackToProvider: false }]
          )) as Record<string, string | null>;
        }
      } catch (e) {
        // Non-fatal; fall back to per-name resolution inside the loop
        batchEnsMap = {};
      }

      // Get the starting nonce once via MainController (avoids web3Provider issues)
      const startingNonce = (await controllerEmitter(
        ['wallet', 'getRecommendedNonceForBatch'],
        [from]
      )) as number;
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

      // Sign and send each transaction with incremented nonces
      for (let i = 0; i < selectedCallsData.length; i++) {
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
                  // Non-atomic: mark this call as error and continue with others
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
                  continue;
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
                continue;
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
          const response = (await controllerEmitter(
            ['wallet', 'sendAndSaveEthTransaction'],
            [tx, false] // false = not legacy transaction
          )) as any;

          const txHash = response.hash || response;

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
          receipts.push({
            status: '0x0',
            error: error.message,
          });

          // Update status to error
          setTransactionStatuses((prev) => {
            const newStatuses = [...prev];
            newStatuses[originalIndex] = {
              status: 'error',
              error: error.message,
            };
            return newStatuses;
          });
        }
      }

      setProcessingIndex(-1);
      setLoading(false);

      // Check if any transactions succeeded
      const successCount = receipts.filter((r) => r.status === '0x1').length;
      const hasErrors = receipts.some((r) => r.status === '0x0');

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
      setLoading(false);
      setConfirmed(false);
      setProcessingIndex(-1);
      alert.error(t('send.sendError'));
    }
  };

  const handleReject = () => {
    clearNavigationState();
    window.close();
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
              <SecondaryButton type="button" onClick={handleReject}>
                {t('buttons.close')}
              </SecondaryButton>
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
        <p className="text-brand-gray200 text-sm mt-1">
          {callsData.atomicRequired
            ? t('send.atomicBatchRequired')
            : t('send.executingMultipleCalls', {
                count: callsData.calls.length,
              })}
        </p>
      </div>

      {/* Warning for atomic requirement */}
      {callsData.atomicRequired && (
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
                selectedCalls[index]
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
                      checked={selectedCalls[index]}
                      onChange={(e) => {
                        const newSelection = [...selectedCalls];
                        newSelection[index] = e.target.checked;
                        setSelectedCalls(newSelection);
                      }}
                      className="w-4 h-4 text-brand-blue600 rounded"
                      disabled={
                        loading ||
                        (transactionStatuses &&
                          transactionStatuses[index]?.status === 'success')
                      }
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
                      <p className="text-sm text-brand-white font-mono">
                        {ellipsis(call.data, 20, 4)}
                      </p>
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
        {totalValue !== '0' && (
          <div className="mt-4 p-4 bg-bkg-2 rounded-lg">
            <div className="flex justify-between items-center">
              <p className="text-sm text-brand-gray200">
                {t('send.totalValue')}:
              </p>
              <p className="text-lg font-bold text-brand-white">
                {formatEther(totalValue)} {activeNetwork.currency}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
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
                / {selectedCalls.filter((s) => s).length}
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
                      selectedCalls.filter((s) => s).length) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <SecondaryButton
            type="button"
            onClick={handleReject}
            disabled={loading}
          >
            {confirmed ? t('buttons.close') : t('buttons.reject')}
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={handleApprove}
            disabled={loading || confirmed || !hasUnsuccessfulSelected}
            loading={loading}
          >
            {loading
              ? confirmed
                ? t('send.sending')
                : t('send.signing')
              : confirmed
              ? t('send.complete')
              : t('send.sign')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};
