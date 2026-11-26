import { useEffect, useMemo, useRef } from 'react';

import {
  EVM_ACTIVITY_CURSOR_STALE,
  EVM_TRANSACTION_HISTORY_SOURCE,
  mergeEvmExplorerTransactions,
} from '../../../../../../shared/evmHistory';
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
import type { SmartAccountCancellationRequest } from '../../../../../../wallet/smartAccountCancellation';
import type { SmartAccountReplayIntent } from '../../../../../../wallet/smartAccountSignedReplay';

type ActivityRow = ITransactionInfoEvm & {
  retainedPhase?: EvmActivitySummary['phase'];
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
    lastObservation: Map<string, number>;
    observationPending?: boolean;
    pending?: Promise<void>;
    rebase?: boolean;
    revision: number;
    scopeKey: string;
  }>({
    active: false,
    includeLocal,
    epoch: 0,
    revision: 0,
    scopeKey,
    lastObservation: new Map(),
  });
  if (
    context.current.scopeKey !== scopeKey ||
    context.current.includeLocal !== includeLocal
  )
    context.current = {
      active: false,
      lastObservation: new Map(),
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
    const readPage = async (cursor?: string) =>
      (await controllerEmitter(
        ['wallet', 'getSavedEvmTransactions'],
        [cursor ?? null, 30, scope]
      )) as Page;
    const read = async () => {
      let rebase = visit.rebase === true;
      const cursor = rebase ? undefined : beforeHash;
      try {
        let page: Page;
        try {
          page = await readPage(cursor);
        } catch (error) {
          if (
            !cursor ||
            !(error instanceof Error) ||
            error.message !== EVM_ACTIVITY_CURSOR_STALE
          )
            throw error;
          if (!current()) return;
          // The journal can remove the anchor while this Activity visit is open.
          // Read the current head once and replace the invalid local page chain.
          rebase = true;
          visit.rebase = true;
          page = await readPage();
        }
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
          (page.nextCursor !== null &&
            (typeof page.nextCursor !== 'string' ||
              page.nextCursor === beforeHash))
        )
          throw new Error('Activity page unavailable');
        const transactions = page.transactions.map((row) => ({
          ...projectEvmActivityRow(row),
          ...(row.smartAccount ? { retainedPhase: row.phase } : {}),
        }));
        visit.rebase = false;
        setState((previous) => {
          const rows = rebase
            ? transactions
            : beforeHash
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
            signedOperations:
              beforeHash && !rebase
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
                !rebase && !beforeHash && overlaps
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
            failedCursor: rebase ? undefined : beforeHash,
            ...(rebase ? { page: { ...previous.page, nextCursor: null } } : {}),
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
  const transactions = useMemo(() => {
    if (!includeLocal) return indexedTransactions;
    const localRows = state.page.transactions;
    const savedByHash = new Map(
      localRows.map((row) => [row.hash.toLowerCase(), row])
    );
    const hydrated = indexedTransactions.map((row) => {
      if (
        row.historySource !== EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned ||
        typeof row.hash !== 'string'
      )
        return row;
      const local = savedByHash.get(row.hash.toLowerCase());
      // The worker added only public placement and summary fields. Keep the
      // already-loaded signed intent for display without storing its bytes.
      return local?.smartAccount ? { ...local, ...row } : row;
    });
    return mergeEvmExplorerTransactions(
      hydrated,
      [],
      chainId,
      false,
      localRows
    );
  }, [includeLocal, indexedTransactions, chainId, state.page.transactions]);
  const indexedHashes = useMemo(
    () =>
      new Set(
        indexedTransactions.flatMap((row) =>
          typeof row.hash === 'string' ? [row.hash.toLowerCase()] : []
        )
      ),
    [indexedTransactions]
  );
  const candidates = transactions.slice(0, 30).filter((row: ActivityRow) => {
    const hash = typeof row.hash === 'string' ? row.hash.toLowerCase() : '';
    return (
      hash &&
      row.smartAccount &&
      row.smartAccount.account.toLowerCase() ===
        accountAddress?.toLowerCase() &&
      !row.smartAccount.cancellation &&
      (row.retainedPhase === 'signed' ||
        row.retainedPhase === 'attempted' ||
        row.retainedPhase === 'submitted') &&
      !indexedHashes.has(hash) &&
      /^0x[0-9a-f]{64}$/.test(hash)
    );
  });
  const refreshSavedPlacement = async () => {
    if (!visit.active || visit.observationPending || !candidates.length) return;
    const now = Date.now();
    const lastChecked = (row: ITransactionInfoEvm) =>
      visit.lastObservation.get(row.hash.toLowerCase()) ?? -Infinity;
    const [next] = [...candidates].sort(
      (a, b) => lastChecked(a) - lastChecked(b)
    );
    if (now - lastChecked(next) < 14_000) return;
    const hash = next.hash.toLowerCase();
    visit.lastObservation.set(hash, now);
    visit.observationPending = true;
    try {
      await controllerEmitter(
        ['wallet', 'observeSavedSmartAccountActivity'],
        [hash, scope]
      );
    } catch {
      // An unavailable receipt leaves the saved row unresolved.
    } finally {
      visit.observationPending = false;
    }
  };
  const {
    smartCancellationHashes,
    smartCancellationRetries,
    pendingSmartCancellationTargets,
  } = useMemo(() => {
    const hashes = new Set<string>();
    const retries = new Map<
      string,
      Required<SmartAccountCancellationRequest>
    >();
    const targets = new Map<string, string>();
    if (includeLocal && accountAddress) {
      for (const row of state.page.transactions) {
        const smart = row.smartAccount;
        if (
          row.chainId !== chainId ||
          smart?.account.toLowerCase() !== accountAddress.toLowerCase()
        )
          continue;
        const hash = row.hash.toLowerCase();
        if (smart.pendingCancellationOf)
          targets.set(hash, smart.pendingCancellationOf);
        if (smart.cancellationRetry) retries.set(hash, smart.cancellationRetry);
        if (smart.operationCount === 1 && !smart.cancellation) hashes.add(hash);
      }
    }
    return {
      smartCancellationHashes: hashes,
      smartCancellationRetries: retries,
      pendingSmartCancellationTargets: targets,
    };
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
    hasUnresolvedSavedPlacement: candidates.length > 0,
    refreshSavedPlacement,
    signedOperations: includeLocal
      ? state.signedOperations
      : EMPTY.signedOperations,
    olderRows,
    smartCancellationHashes,
    smartCancellationRetries,
    pendingSmartCancellationTargets,
    unavailable: includeLocal && state.unavailable,
    retry: () => fetchPage(state.failedCursor),
  };
};
