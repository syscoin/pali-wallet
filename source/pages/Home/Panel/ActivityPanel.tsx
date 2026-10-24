import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ExternalLinkSvg } from 'components/Icon/Icon';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useRequestScope } from 'hooks/useRequestScope';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import {
  selectActiveAccountWithTransactions,
  selectVaultCoreData,
} from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import type {
  ITransactionInfoEvm,
  ITransactionInfoUtxo,
} from 'types/useTransactionsInfo';
import { getWalletNavigationScope } from 'utils/navigationState';
import { buildExplorerUrl } from 'utils/strings';

import { EvmTransactionsList } from './components/Transactions/EVM/EvmList';
import { UtxoTransactionsList } from './components/Transactions/UTXO/UtxoList';

export const TransactionsPanel = () => {
  // ✅ OPTIMIZED: Use compound selectors to reduce re-renders
  const { account: activeAccount, transactions: accountTransactions } =
    useSelector(selectActiveAccountWithTransactions);
  const { activeNetwork, isBitcoinBased, isSwitchingAccount } =
    useSelector(selectVaultCoreData);
  const hasHistoryStatus = isBitcoinBased || Boolean(activeNetwork.apiUrl);

  const { t } = useTranslation();
  const historyStatus = useSelector(
    (state: RootState) => state.vaultGlobal.transactionHistoryStatus
  );
  const scope = useSelector(getWalletNavigationScope);
  const historyState =
    historyStatus?.scope.account === scope.account &&
    historyStatus?.scope.network === scope.network
      ? historyStatus.state
      : undefined;
  const scopeKey = `${scope.account}:${scope.network}`;
  const beginRetry = useRequestScope(scopeKey);
  const retryPending = useRef<() => boolean>();
  const [retryScope, setRetryScope] = useState<string>();
  const isRetrying = retryScope === scopeKey && retryPending.current?.();
  const retryHistory = async () => {
    if (retryPending.current?.()) return;
    const isCurrent = beginRetry();
    retryPending.current = isCurrent;
    setRetryScope(scopeKey);
    try {
      await controllerEmitter(['wallet', 'refreshTransactionHistory'], [scope]);
    } catch {
      // The scoped background status owns the error; keep the retry visible.
    } finally {
      if (isCurrent()) {
        retryPending.current = undefined;
        setRetryScope(undefined);
      }
    }
  };

  const utxoTransactions = useMemo<ITransactionInfoUtxo[]>(() => {
    if (!isBitcoinBased) {
      return [];
    }
    const sysTxs =
      accountTransactions[TransactionsType.Syscoin][activeNetwork.chainId];
    return (sysTxs || []) as unknown as ITransactionInfoUtxo[];
  }, [accountTransactions, activeNetwork.chainId, isBitcoinBased]);
  const evmTransactions = useMemo<ITransactionInfoEvm[]>(() => {
    if (isBitcoinBased) {
      return [];
    }
    const ethTxs =
      accountTransactions[TransactionsType.Ethereum][activeNetwork.chainId];
    return (ethTxs || []) as unknown as ITransactionInfoEvm[];
  }, [accountTransactions, activeNetwork.chainId, isBitcoinBased]);
  const transactions = isBitcoinBased ? utxoTransactions : evmTransactions;

  const hasTransactions = useMemo(
    () => transactions.length > 0,
    [transactions.length]
  );

  // ✅ MEMOIZED: Component definitions to prevent recreation
  const NoTransactionsComponent = useMemo(
    () => (
      <div className="flex items-center justify-center pt-3 pb-6 text-brand-white text-sm">
        <p>{t('home.youHaveNoTxs')}</p>
      </div>
    ),
    [t]
  );

  const TransactionSkeleton = useMemo(
    () => (
      <div className="p-4 mt-8 w-full mb-9 text-white text-base bg-brand-blue600">
        <div className="space-y-3">
          {[...Array(3)].map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-x-3 p-3 bg-brand-blue500 rounded-lg"
            >
              <div className="flex min-w-0 items-center space-x-3">
                <SkeletonLoader
                  width="40px"
                  height="40px"
                  className="shrink-0"
                />
                <div className="min-w-0 w-[120px] space-y-1">
                  <SkeletonLoader
                    width="100%"
                    height="16px"
                    className="max-w-[120px]"
                  />
                  <SkeletonLoader
                    width="100%"
                    height="12px"
                    className="max-w-[80px]"
                  />
                </div>
              </div>
              <div className="shrink-0 text-right space-y-1">
                <SkeletonLoader width="100px" height="16px" />
                <SkeletonLoader width="60px" height="12px" />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-brand-gray200">
          {t('networkConnection.loadingTransactions')}
        </p>
      </div>
    ),
    [t]
  );

  // ✅ OPTIMIZED: Memoized explorer component with proper dependencies
  const OpenTransactionExplorer = useMemo(() => {
    if (!activeAccount) return null;

    const { xpub, address: userAddress, isImported } = activeAccount as any;

    // Use xpub for UTXO accounts when available, including imported extended-key accounts.
    // Only fall back to /address for:
    // - EVM chains (always address)
    // - UTXO single-address imports (WIF) where xpub === address
    // - missing xpub
    const isSingleAddressUtxoImport =
      Boolean(isImported) && Boolean(xpub) && xpub === userAddress;
    const useAddressPathForUtxo =
      isBitcoinBased && (!xpub || isSingleAddressUtxoImport);
    const pathSegment = isBitcoinBased
      ? useAddressPathForUtxo
        ? 'address'
        : 'xpub'
      : 'address';
    const identifier = isBitcoinBased
      ? useAddressPathForUtxo
        ? userAddress
        : xpub
      : userAddress;

    const openExplorer = () =>
      window.open(
        buildExplorerUrl(
          activeNetwork.explorer || activeNetwork.url,
          pathSegment,
          identifier
        ),
        '_blank'
      );

    return (
      <div className="flex mt-5 items-center justify-center gap-2">
        <ExternalLinkSvg />
        <button
          type="button"
          className="w-max underline text-sm font-normal bg-transparent border-none cursor-pointer"
          onClick={openExplorer}
        >
          {t('home.seeAllTxs')}
        </button>
      </div>
    );
  }, [
    activeAccount,
    activeNetwork.explorer,
    activeNetwork.url,
    isBitcoinBased,
    t,
  ]);

  // Configured explorer history, like UTXO, requires an actual scoped read.
  // Networks without an explorer retain the existing RPC settle behavior.
  const isPollingUpdate = useSelector(
    (state: RootState) => state.vaultGlobal.isPollingUpdate
  );
  const settleKey = `${(activeAccount as any)?.address ?? ''}:${
    activeNetwork.chainId
  }`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const hasSettled = settledKey === settleKey;
  const sawPollRef = useRef(false);

  useEffect(() => {
    sawPollRef.current = false;
  }, [settleKey]);

  useEffect(() => {
    if (hasTransactions) setSettledKey(settleKey);
  }, [hasTransactions, settleKey]);

  useEffect(() => {
    if (isPollingUpdate) {
      sawPollRef.current = true;
      return;
    }
    if (sawPollRef.current) setSettledKey(settleKey);
  }, [isPollingUpdate, settleKey]);

  useEffect(() => {
    if (hasSettled) return;
    // Zero-tx accounts never get a settle signal (empty fetches don't
    // dispatch), so fall through to the empty state quickly instead of
    // holding the skeleton for seconds.
    const timeout = setTimeout(() => setSettledKey(settleKey), 1200);
    return () => clearTimeout(timeout);
  }, [settleKey, hasSettled]);

  const isLoading = useMemo(
    () =>
      isSwitchingAccount ||
      (!hasTransactions &&
        (hasHistoryStatus
          ? historyState !== 'ready' && historyState !== 'error'
          : !hasSettled)),
    [
      isSwitchingAccount,
      hasSettled,
      hasTransactions,
      hasHistoryStatus,
      historyState,
    ]
  );
  const historyUnavailable = hasHistoryStatus && historyState === 'error';

  return (
    <>
      {isLoading && !hasTransactions && TransactionSkeleton}
      {hasHistoryStatus && historyState !== 'ready' && (
        <div className="mt-8 text-center text-sm text-brand-gray200">
          {historyUnavailable && <p role="status">{t('send.unableToLoad')}</p>}
          <button
            type="button"
            className="underline"
            disabled={historyState === 'pending' || isRetrying}
            onClick={retryHistory}
          >
            {t('receive.retry')}
          </button>
        </div>
      )}
      {!isLoading && !hasTransactions && (
        <div
          id="activity-panel-empty"
          className="w-full mt-8 text-white bg-brand-blue600"
        >
          {!historyUnavailable && NoTransactionsComponent}
          {OpenTransactionExplorer}
          {/* <Fullscreen /> */}
        </div>
      )}

      {hasTransactions && (
        <div
          id="activity-panel-list"
          className="p-4 mt-8 w-full  mb-9 text-white text-base bg-brand-blue600"
        >
          {isBitcoinBased ? (
            <UtxoTransactionsList userTransactions={utxoTransactions} />
          ) : (
            <EvmTransactionsList userTransactions={evmTransactions} />
          )}
          {OpenTransactionExplorer}
        </div>
      )}
    </>
  );
};
