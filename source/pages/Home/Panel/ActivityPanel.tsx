import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ExternalLinkSvg } from 'components/Icon/Icon';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useRequestScope } from 'hooks/useRequestScope';
import { useUtils } from 'hooks/useUtils';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store, { RootState } from 'state/store';
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
import { canPublishAccountAddress } from 'utils/smartAccount/addressIdentity';
import { buildExplorerUrl, selectExplorerUrl } from 'utils/strings';

import { EvmTransactionsList } from './components/Transactions/EVM/EvmList';
import { useSavedEvmTransactions } from './components/Transactions/EVM/useSavedEvmTransactions';
import { UtxoTransactionsList } from './components/Transactions/UTXO/UtxoList';

export const TransactionsPanel = () => {
  // ✅ OPTIMIZED: Use compound selectors to reduce re-renders
  const { account: activeAccount, transactions: accountTransactions } =
    useSelector(selectActiveAccountWithTransactions);
  const { activeNetwork, isBitcoinBased, isSwitchingAccount } =
    useSelector(selectVaultCoreData);
  const explorer = useSelector(selectExplorerUrl);
  const activeAccountType = useSelector(
    (state: RootState) => state.vault.activeAccount.type
  );
  const hasHistoryStatus = isBitcoinBased || Boolean(activeNetwork.apiUrl);
  const historyMayBeIncomplete = !isBitcoinBased && !activeNetwork.apiUrl;

  const { t } = useTranslation();
  const { alert } = useUtils();
  const historyStatus = useSelector(
    (state: RootState) => state.vaultGlobal.transactionHistoryStatus
  );
  const scope = useSelector(getWalletNavigationScope);
  const currentHistory =
    historyStatus?.scope.account === scope.account &&
    historyStatus?.scope.network === scope.network
      ? historyStatus
      : undefined;
  const historyState = currentHistory?.state;
  const scopeKey = `${scope.account}:${scope.network}`;
  const clearedAt =
    activeAccount?.evmActivityClearedAtByChainId?.[activeNetwork.chainId];
  const saved = useSavedEvmTransactions(
    !isBitcoinBased,
    clearedAt === undefined ? scopeKey : `${scopeKey}:${clearedAt}`
  );
  const beginRetry = useRequestScope(scopeKey);
  const retryPending = useRef<() => boolean>();
  const [retryScope, setRetryScope] = useState<string>();
  const isRetrying = retryScope === scopeKey && retryPending.current?.();
  const retryHistory = async () => {
    if (retryPending.current?.()) return;
    const isCurrent = beginRetry();
    retryPending.current = isCurrent;
    const previousStatus =
      store.getState().vaultGlobal.transactionHistoryStatus;
    setRetryScope(scopeKey);
    try {
      await controllerEmitter(['wallet', 'refreshTransactionHistory'], [scope]);
    } catch {
      const status = store.getState().vaultGlobal.transactionHistoryStatus;
      if (
        isCurrent() &&
        (status?.state !== 'error' ||
          status.requestId === previousStatus?.requestId ||
          status.scope.account !== scope.account ||
          status.scope.network !== scope.network)
      )
        alert.error(t('send.unableToLoad'));
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
    const byHash = new Map<string, ITransactionInfoEvm>();
    for (const row of saved.transactions)
      byHash.set(row.hash.toLowerCase(), row);
    for (const row of (ethTxs || []) as unknown as ITransactionInfoEvm[]) {
      const key = row.hash?.toLowerCase();
      if (key) byHash.set(key, row);
    }
    return Array.from(byHash.values());
  }, [
    accountTransactions,
    activeNetwork.chainId,
    isBitcoinBased,
    saved.transactions,
  ]);
  const transactions = isBitcoinBased ? utxoTransactions : evmTransactions;

  const hasTransactions = transactions.length > 0;
  const savedActivityLoading = saved.loading;
  const savedActivityUnavailable = saved.unavailable;

  // ✅ MEMOIZED: Component definitions to prevent recreation
  const NoTransactionsComponent = useMemo(
    () => (
      <div className="flex items-center justify-center pt-3 pb-6 text-brand-white text-sm">
        <p
          role={!isBitcoinBased ? 'status' : undefined}
          className={
            !isBitcoinBased ? 'min-w-0 break-words px-4 text-center' : undefined
          }
        >
          {t(
            historyMayBeIncomplete
              ? 'home.historyMayBeIncomplete'
              : isBitcoinBased
              ? 'home.youHaveNoTxs'
              : 'home.noIndexedActivity'
          )}
        </p>
      </div>
    ),
    [historyMayBeIncomplete, isBitcoinBased, t]
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
    if (
      !activeAccount ||
      !explorer ||
      !canPublishAccountAddress(
        activeAccount,
        activeAccountType,
        activeNetwork.chainId
      )
    )
      return null;

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

    const openExplorer = () => {
      const state = store.getState();
      const currentRef = state.vault.activeAccount;
      const currentAccount =
        state.vault.accounts[currentRef.type]?.[currentRef.id];
      const currentScope = getWalletNavigationScope();
      if (
        currentScope.account !== scope.account ||
        currentScope.network !== scope.network ||
        selectExplorerUrl(state) !== explorer ||
        !canPublishAccountAddress(
          currentAccount,
          currentRef.type,
          state.vault.activeNetwork.chainId
        )
      )
        return;
      window.open(
        buildExplorerUrl(explorer, pathSegment, identifier),
        '_blank'
      );
    };

    return (
      <div className="flex min-w-0 items-center justify-center gap-2">
        <ExternalLinkSvg />
        <button
          type="button"
          className="min-w-0 break-words text-center text-sm font-normal underline bg-transparent border-none cursor-pointer"
          onClick={openExplorer}
        >
          {t('home.seeAllTxs')}
        </button>
      </div>
    );
  }, [
    activeAccount,
    activeAccountType,
    activeNetwork.chainId,
    explorer,
    isBitcoinBased,
    scope.account,
    scope.network,
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
  const showHistoryRetry =
    hasHistoryStatus &&
    historyState !== 'ready' &&
    (historyState !== 'pending' || isRetrying);
  const historyRetry = showHistoryRetry && (
    <div
      className={
        hasTransactions
          ? 'flex min-w-0 items-center justify-center gap-3 text-sm text-brand-gray200'
          : 'mt-4 text-center text-sm text-brand-gray200'
      }
    >
      <p role="status" className="min-h-[1.25rem] min-w-0 break-words">
        {isRetrying
          ? t('networkConnection.loadingTransactions')
          : historyUnavailable
          ? t('send.unableToLoad')
          : null}
      </p>
      <button
        type="button"
        className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-brand-royalbluemedium px-4 text-brand-white hover:bg-brand-royalblue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalbluemedium ${
          hasTransactions ? '' : 'mt-2'
        }`}
        disabled={historyState === 'pending' || isRetrying}
        onClick={retryHistory}
      >
        {t('receive.retry')}
      </button>
    </div>
  );

  return (
    <>
      {(isLoading || savedActivityLoading) &&
        !hasTransactions &&
        !isRetrying &&
        TransactionSkeleton}
      {!hasTransactions && historyRetry}
      {savedActivityUnavailable && (
        <div className="mt-4 text-center text-sm text-brand-gray200">
          <p role="status">{t('home.savedActivityUnavailable')}</p>
          <button
            type="button"
            className="mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-brand-royalbluemedium px-4 text-brand-white hover:bg-brand-royalblue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalbluemedium"
            disabled={savedActivityLoading}
            onClick={() => void saved.retry()}
          >
            {t('home.retrySavedActivity')}
          </button>
        </div>
      )}
      {!isLoading && !savedActivityLoading && !hasTransactions && (
        <div
          id="activity-panel-empty"
          className="w-full mt-8 text-white bg-brand-blue600"
        >
          {!historyUnavailable &&
            !savedActivityUnavailable &&
            NoTransactionsComponent}
          {OpenTransactionExplorer && (
            <div className="mt-5">{OpenTransactionExplorer}</div>
          )}
          {/* <Fullscreen /> */}
        </div>
      )}

      {hasTransactions && (
        <div
          id="activity-panel-list"
          className="p-4 mt-8 w-full  mb-9 text-white text-base bg-brand-blue600"
        >
          {historyMayBeIncomplete && (
            <p role="status" className="mb-3 text-sm text-brand-gray200">
              {t('home.historyMayBeIncomplete')}
            </p>
          )}
          {isBitcoinBased ? (
            <UtxoTransactionsList userTransactions={utxoTransactions} />
          ) : (
            <EvmTransactionsList
              explorerHasMore={currentHistory?.explorerHasMore === true}
              userTransactions={evmTransactions}
              savedTransactions={saved.transactions}
              savedHasMore={saved.hasMore}
              savedLoading={savedActivityLoading}
              loadMoreSaved={saved.loadMore}
            />
          )}
          {(hasHistoryStatus || OpenTransactionExplorer) && (
            <div className="mt-5 flex h-11 items-center justify-center gap-4">
              {OpenTransactionExplorer}
              {historyRetry}
            </div>
          )}
        </div>
      )}
    </>
  );
};
