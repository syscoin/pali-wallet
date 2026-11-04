import { useEffect, useRef } from 'react';

import { useContextualState } from 'hooks/useContextualState';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type { ITransactionInfoEvm } from 'types/useTransactionsInfo';

import type { EvmSavedTransaction } from '../../../../../../wallet/evmSignedReplay';

type Page = {
  nextCursor: string | null;
  transactions: readonly EvmSavedTransaction[];
};
type State = { loading: boolean; page: Page };
const EMPTY: State = {
  loading: false,
  page: { transactions: [], nextCursor: null },
};

/** Project the shared public summary without inventing unsigned calldata or receipt fields. */
export const savedTransactionHistoryRow = (
  tx: EvmSavedTransaction
): ITransactionInfoEvm =>
  ({
    hash: tx.hash,
    chainId: Number(tx.chainId),
    from: tx.from,
    to: tx.to,
    value: tx.value,
    nonce: String(tx.nonce),
    type: tx.type,
    timestamp: Math.floor(tx.createdAt / 1000),
    gas: tx.gasLimit,
    gasPrice: tx.feePerGas,
    dataBytes: tx.dataBytes,
    isCancel: tx.operation === 'cancel',
    isSpeedUp: tx.operation === 'speed-up',
    ...(tx.originalHash ? { replacesHash: tx.originalHash } : {}),
    ...(tx.tokenTransfer?.token
      ? {
          tokenRecipient: tx.tokenTransfer.recipient,
          tokenTransfer: {
            chainId: Number(tx.chainId),
            contractAddress: tx.to,
            recipient: tx.tokenTransfer.recipient,
            value: tx.tokenTransfer.amountUnits,
            decimals: tx.tokenTransfer.token.decimals,
            symbol: tx.tokenTransfer.token.symbol,
          },
        }
      : {}),
  } as unknown as ITransactionInfoEvm);

/** One bounded authenticated local page; explorer fetching stays with the existing history flow. */
export const useSavedEvmTransactions = (enabled: boolean, scope: string) => {
  const [state, setState] = useContextualState<State>(scope, EMPTY);
  const context = useRef({ scope, revision: 0, request: 0, active: true });
  if (context.current.scope !== scope)
    context.current = {
      scope,
      revision: context.current.revision + 1,
      request: 0,
      active: true,
    };
  const renderRevision = context.current.revision;
  const fetchPage = async (beforeHash?: string) => {
    const revision = renderRevision;
    if (
      !enabled ||
      !context.current.active ||
      context.current.revision !== revision
    )
      return;
    const request = ++context.current.request;
    const current = () =>
      enabled &&
      context.current.active &&
      context.current.revision === revision &&
      context.current.request === request;
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const page = (await controllerEmitter(
        ['wallet', 'getSavedEvmTransactions'],
        [beforeHash, 30]
      )) as Page;
      if (!current() || !Array.isArray(page?.transactions)) return;
      setState((previous) => {
        const rows = beforeHash
          ? [...previous.page.transactions, ...page.transactions]
          : [...page.transactions, ...previous.page.transactions];
        const byHash = new Map<string, EvmSavedTransaction>();
        for (const row of rows)
          if (!byHash.has(row.hash)) byHash.set(row.hash, row);
        const knownHashes = new Set(
          previous.page.transactions.map((row) => row.hash)
        );
        const overlaps = page.transactions.some((row) =>
          knownHashes.has(row.hash)
        );
        return {
          loading: false,
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
      // Local records remain visible when a later read fails; never claim remote history is complete.
    } finally {
      if (current()) setState((previous) => ({ ...previous, loading: false }));
    }
  };
  useEffect(() => {
    context.current.active = true;
    void fetchPage();
    const refresh = () => void fetchPage();
    window.addEventListener('focus', refresh);
    return () => {
      context.current.active = false;
      context.current.request++;
      window.removeEventListener('focus', refresh);
    };
  }, [scope, enabled]);
  return {
    transactions: enabled
      ? state.page.transactions.map(savedTransactionHistoryRow)
      : [],
    hasMore: enabled && state.page.nextCursor !== null,
    loading: enabled && state.loading,
    loadMore: () => fetchPage(state.page.nextCursor ?? undefined),
  };
};
