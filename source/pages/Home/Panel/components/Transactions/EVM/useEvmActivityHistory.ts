import { useEffect, useMemo, useRef } from 'react';

import { mergeEvmExplorerTransactions } from '../../../../../../shared/evmHistory';
import { SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT } from '../../../../../../shared/smartAccountControllerAuthority';
import { projectEvmActivityRow } from '../../../../../../wallet/evmActivityRow';
import { useContextualState } from 'hooks/useContextualState';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type { ITransactionInfoEvm } from 'types/useTransactionsInfo';
import type { IWalletNavigationScope } from 'utils/navigationState';

import type {
  EvmActivitySummary,
  SmartAccountSignedActivity,
} from '../../../../../../wallet/evmActivityRow';
import type { SmartAccountReplayIntent } from '../../../../../../wallet/smartAccountSignedReplay';

type ActivityRow = ITransactionInfoEvm & {
  smartAccount?: SmartAccountReplayIntent;
};

type Page = {
  nextCursor: string | null;
  signedOperations?: readonly SmartAccountSignedActivity[];
  transactions: readonly EvmActivitySummary[];
};
type State = {
  failedCursor?: string;
  loading: boolean;
  page: { nextCursor: string | null; transactions: ActivityRow[] };
  signedOperations: readonly SmartAccountSignedActivity[];
  unavailable: boolean;
};
const EMPTY: State = {
  loading: true,
  page: { transactions: [], nextCursor: null },
  signedOperations: [],
  unavailable: false,
};

export type EvmActivityOlderRows = {
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loading: boolean;
};

const noTransactions: ITransactionInfoEvm[] = [];

/** The scoped Activity rows include locally tracked transactions before indexing catches up. */
export const useEvmActivityHistory = ({
  includeLocal,
  scope,
  clearedAt,
  accountAddress,
  chainId,
  indexedTransactions = noTransactions,
}: {
  accountAddress?: string;
  chainId: number;
  clearedAt?: number;
  includeLocal: boolean;
  indexedTransactions?: ITransactionInfoEvm[];
  scope: IWalletNavigationScope;
}) => {
  const scopeKey = JSON.stringify([scope.account, scope.network, clearedAt]);
  const context = useRef<{
    active: boolean;
    epoch: number;
    includeLocal: boolean;
    pending?: Promise<void>;
    revision: number;
    scopeKey: string;
  }>({ active: false, includeLocal, epoch: 0, revision: 0, scopeKey });
  if (
    context.current.scopeKey !== scopeKey ||
    context.current.includeLocal !== includeLocal
  )
    context.current = {
      active: false,
      includeLocal,
      epoch: 0,
      revision: context.current.revision + 1,
      scopeKey,
    };
  const visit = context.current;
  const [state, setState] = useContextualState<State>(
    String(visit.revision),
    EMPTY
  );
  const fetchPage = async (beforeHash?: string) => {
    if (!includeLocal || !visit.active || context.current !== visit) return;
    if (visit.pending) return visit.pending;
    const epoch = visit.epoch;
    const current = () =>
      visit.active && context.current === visit && visit.epoch === epoch;
    setState((previous) => ({ ...previous, loading: true }));
    const read = async () => {
      try {
        const page = (await controllerEmitter(
          ['wallet', 'getSavedEvmTransactions'],
          [beforeHash ?? null, 30, scope]
        )) as Page;
        if (!current()) return;
        if (
          !Array.isArray(page?.transactions) ||
          page.transactions.length > 30 ||
          page.transactions.some((row) => typeof row?.hash !== 'string') ||
          (page.signedOperations !== undefined &&
            (!Array.isArray(page.signedOperations) ||
              page.signedOperations.length > 30 ||
              page.signedOperations.some(
                (row: SmartAccountSignedActivity) =>
                  !row ||
                  typeof row.account !== 'string' ||
                  typeof row.operationHash !== 'string' ||
                  !/^0x[\da-f]{64}$/i.test(row.operationHash) ||
                  (row.replacesOperationHash !== undefined &&
                    (typeof row.replacesOperationHash !== 'string' ||
                      !/^0x[\da-f]{64}$/i.test(row.replacesOperationHash))) ||
                  !Number.isSafeInteger(row.createdAt) ||
                  (row.status !== 'unresolved' && row.status !== 'unavailable')
              ))) ||
          (page.nextCursor !== null && typeof page.nextCursor !== 'string')
        )
          throw new Error('Activity page unavailable');
        const transactions = page.transactions.map(projectEvmActivityRow);
        setState((previous) => {
          const rows = beforeHash
            ? [...previous.page.transactions, ...transactions]
            : [...transactions, ...previous.page.transactions];
          const byHash = new Map<string, ActivityRow>();
          for (const row of rows)
            if (!byHash.has(row.hash.toLowerCase()))
              byHash.set(row.hash.toLowerCase(), row);
          const knownHashes = new Set(
            previous.page.transactions.map((row) => row.hash.toLowerCase())
          );
          const overlaps = transactions.some((row) =>
            knownHashes.has(row.hash.toLowerCase())
          );
          return {
            loading: false,
            unavailable: false,
            signedOperations: beforeHash
              ? previous.signedOperations
              : (page.signedOperations ?? []).filter(
                  (row) =>
                    row.chainId === String(chainId) &&
                    row.account.toLowerCase() ===
                      accountAddress?.toLowerCase() &&
                    (clearedAt === undefined || row.createdAt > clearedAt)
                ),
            page: {
              nextCursor:
                !beforeHash && overlaps
                  ? previous.page.nextCursor
                  : page.nextCursor,
              transactions: Array.from(byHash.values()),
            },
          };
        });
      } catch {
        // Rows that already loaded stay visible while the failed page can be retried.
        if (current())
          setState((previous) => ({
            ...previous,
            loading: false,
            unavailable: true,
            failedCursor: beforeHash,
          }));
      }
    };
    visit.pending = read().finally(() => {
      if (current()) visit.pending = undefined;
    });
    return visit.pending;
  };
  useEffect(() => {
    if (!includeLocal) return;
    visit.active = true;
    void fetchPage();
    const refresh = () => void fetchPage();
    const refreshAfterAuthorization = async () => {
      const epoch = visit.epoch;
      await visit.pending;
      if (visit.epoch === epoch) await fetchPage();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener(
      SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT,
      refreshAfterAuthorization
    );
    return () => {
      visit.active = false;
      visit.epoch++;
      visit.pending = undefined;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(
        SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT,
        refreshAfterAuthorization
      );
    };
  }, [scopeKey, includeLocal]);
  const transactions = useMemo(
    () =>
      includeLocal
        ? mergeEvmExplorerTransactions(
            indexedTransactions,
            [],
            chainId,
            false,
            state.page.transactions
          )
        : indexedTransactions,
    [includeLocal, indexedTransactions, chainId, state.page.transactions]
  );
  const smartCancellationHashes = useMemo(() => {
    const hashes = new Set<string>();
    if (!includeLocal || !accountAddress) return hashes;
    for (const row of state.page.transactions) {
      const smart = row.smartAccount;
      if (
        row.chainId === chainId &&
        smart?.account.toLowerCase() === accountAddress.toLowerCase() &&
        smart?.operationCount === 1 &&
        !smart.cancellation
      )
        hashes.add(row.hash.toLowerCase());
    }
    return hashes;
  }, [includeLocal, accountAddress, chainId, state.page.transactions]);
  const olderRows: EvmActivityOlderRows = {
    hasMore: includeLocal && state.page.nextCursor !== null,
    loading: includeLocal && state.loading,
    loadMore: async () => {
      if (state.page.nextCursor !== null)
        await fetchPage(state.page.nextCursor);
    },
  };
  return {
    transactions,
    signedOperations: includeLocal
      ? state.signedOperations
      : EMPTY.signedOperations,
    olderRows,
    smartCancellationHashes,
    unavailable: includeLocal && state.unavailable,
    retry: () => fetchPage(state.failedCursor),
  };
};
