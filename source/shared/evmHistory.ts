import { isTransactionInBlock as isHistoryTransactionInBlock } from './transactionBlockStatus.ts';

export const EVM_TRANSACTION_HISTORY_SOURCE = {
  ExplorerPending: 'explorer-pendingtxlist',
  ExplorerTokenTransfer: 'explorer-tokentx',
  ExplorerTransaction: 'explorer-txlist',
  LocalSigned: 'local-signed',
} as const;

export type EvmTransactionHistorySource =
  (typeof EVM_TRANSACTION_HISTORY_SOURCE)[keyof typeof EVM_TRANSACTION_HISTORY_SOURCE];

export const parseEvmInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed =
    typeof value === 'string' && value.toLowerCase().startsWith('0x')
      ? parseInt(value, 16)
      : Number(value);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Explorer normalization and representative selection used by both wallet hosts.
 * Transport bounds, persistence and UI rendering remain platform adapters. */
export const mapExplorerReceiptStatus = (item: any) => {
  const binaryStatus = (value: unknown): '0' | '1' | null => {
    if (
      value === 0 ||
      value === '0' ||
      (typeof value === 'string' && /^0x0+$/i.test(value))
    )
      return '0';
    if (
      value === 1 ||
      value === '1' ||
      (typeof value === 'string' && /^0x0*1$/i.test(value))
    )
      return '1';
    return null;
  };
  const error = binaryStatus(
    typeof item.isError === 'boolean' ? Number(item.isError) : item.isError
  );
  const status =
    binaryStatus(item.txreceipt_status) ??
    (error === null ? null : error === '0' ? '1' : '0');
  return {
    // A receipt status describes success; isError describes the opposite.
    // Keep both coherent when explicit receipt status overrides explorer flags.
    // eslint-disable-next-line camelcase
    txreceipt_status: status,
    isError: status === null ? null : status === '0' ? '1' : '0',
  };
};

// Initial and paginated explorer reads use exactly the same normalization.
export const mapEvmExplorerTransaction = (
  item: any,
  chainIdForMap: number,
  overrideTo?: string,
  historySource: EvmTransactionHistorySource = EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction
) => {
  let timestamp = parseInt(item.timeStamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const oneYearFromNow = now + 365 * 24 * 60 * 60;
  if (
    !timestamp ||
    isNaN(timestamp) ||
    timestamp < 0 ||
    timestamp > oneYearFromNow
  ) {
    timestamp = now;
  }
  const blockNumberParsed =
    item.blockNumber !== undefined && item.blockNumber !== null
      ? parseInt(item.blockNumber)
      : undefined;
  const confirmationsParsed =
    item.confirmations !== undefined && item.confirmations !== null
      ? parseInt(item.confirmations)
      : 0;
  const nonceParsed =
    item.nonce !== undefined && item.nonce !== null
      ? parseInt(item.nonce)
      : undefined;
  return {
    hash: item.hash,
    from: item.from,
    to: overrideTo ?? item.to,
    value: item.value,
    blockNumber: blockNumberParsed,
    blockHash: item.blockHash,
    timestamp,
    confirmations: confirmationsParsed,
    chainId: chainIdForMap,
    input: item.input,
    gasPrice: item.gasPrice,
    gas: item.gas || item.gasLimit,
    nonce: nonceParsed,
    type: parseEvmInteger(item.type),
    r: item.r,
    s: item.s,
    v: parseEvmInteger(item.v),
    historySource,
    ...mapExplorerReceiptStatus(item),
  } as any;
};

export const mapEvmExplorerTokenTransfer = (event: any, chainId: number) => ({
  ...mapEvmExplorerTransaction(
    event,
    chainId,
    event.contractAddress,
    EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer
  ),
  tokenRecipient: event.to,
  tokenTransfer: {
    chainId,
    contractAddress: event.contractAddress,
    recipient: event.to,
    value: event.tokenValue ?? event.value,
    decimals: event.tokenDecimal,
    symbol: event.tokenSymbol,
    tokenId: event.tokenID ?? event.tokenId,
    tokenStandard: event.tokenType ?? event.tokenStandard,
  },
});

export function explorerApiError(
  reply: any,
  status: number
): string | undefined {
  return !reply
    ? `Explorer API status ${status}`
    : (reply.status === '0' || reply.message === 'NOTOK') &&
      !Array.isArray(reply.result) &&
      reply.message !== 'No transactions found'
    ? String(reply.result || reply.message || 'Explorer API error')
    : undefined;
}

const evmHistorySourcePriority = (tx: any): number => {
  const source = (tx as any).historySource;
  if (source === EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned) return 1;
  if (
    source === EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer ||
    (source !== EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction &&
      source !== EVM_TRANSACTION_HISTORY_SOURCE.ExplorerPending &&
      (tx as any).tokenRecipient !== undefined)
  )
    return 0;
  return 2;
};

/** Merge normalized display rows; never use source priority for signing authority. */
function mergeNormalizedEvmHistory<
  T extends { hash: string; timestamp?: number }
>(base: readonly T[], additional: readonly T[]): T[] {
  const byHash = new Map<string, T>();
  const key = (tx: T) =>
    String(tx.hash || (tx as any).txid || '').toLowerCase();

  for (const tx of base) {
    const hash = key(tx);
    if (hash) byHash.set(hash, tx);
  }
  for (const tx of additional) {
    const hash = key(tx);
    if (!hash) continue;
    const existing = byHash.get(hash);
    // Real explorer bodies replace local summaries and token placeholders.
    // Equal-priority rows retain the established initial-page precedence.
    if (
      !existing ||
      evmHistorySourcePriority(tx) > evmHistorySourcePriority(existing)
    )
      byHash.set(hash, tx);
  }
  return Array.from(byHash.values());
}

/** Prefer the real transaction body over token-event placeholders. */
export function mergeEvmExplorerTransactions<
  T extends { hash: string; timestamp?: number }
>(
  base: readonly T[],
  tokenEvents: readonly any[],
  chainId: number,
  annotateBase = false,
  additionalBase?: readonly T[]
): T[] {
  const baseRows = additionalBase
    ? mergeNormalizedEvmHistory(base, additionalBase)
    : base;
  const byHash = new Map<string, any>();
  for (const event of tokenEvents) {
    const hash = String(
      annotateBase ? event.hash || '' : event.hash
    ).toLowerCase();
    if (hash && !byHash.has(hash)) byHash.set(hash, event);
  }
  const merged = baseRows.map((tx) => {
    const event = byHash.get(String(tx.hash || '').toLowerCase());
    return annotateBase && event ? { ...tx, tokenRecipient: event.to } : tx;
  });
  const seen = new Set(baseRows.map((tx) => String(tx.hash).toLowerCase()));
  for (const [hash, event] of byHash) {
    if (seen.has(hash)) continue;
    merged.push(mapEvmExplorerTokenTransfer(event, chainId));
    seen.add(hash);
  }
  return merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export type EvmHistoryDirection = 'sent' | 'received' | 'self' | 'unknown';
export function getEvmHistoryDirection(
  tx: {
    from?: string | null;
    to?: string | null;
    tokenRecipient?: string | null;
  },
  owner: string,
  transfers: readonly { from: string; to: string }[] = []
): EvmHistoryDirection {
  const address = owner.toLowerCase();
  const outgoing =
    tx.from?.toLowerCase() === address ||
    transfers.some((event) => event.from.toLowerCase() === address);
  const incoming =
    (tx.tokenRecipient || tx.to)?.toLowerCase() === address ||
    transfers.some((event) => event.to.toLowerCase() === address);
  return outgoing && incoming
    ? 'self'
    : outgoing
    ? 'sent'
    : incoming
    ? 'received'
    : 'unknown';
}
export function belongsToEvmHistoryAccount(
  tx: {
    from?: string | null;
    smartAccountExecutionFrom?: string;
    to?: string | null;
    tokenRecipient?: string | null;
  },
  owner: string
): boolean {
  return (
    getEvmHistoryDirection(tx, owner) !== 'unknown' ||
    tx.smartAccountExecutionFrom?.toLowerCase?.() === owner.toLowerCase()
  );
}
export const selectEvmHistoryRepresentatives = <
  T extends { confirmations: number }
>(
  transactions: readonly T[],
  limit = 30
): T[] => {
  // Group transactions by their ID and keep the best version
  const txMap = new Map<string, any>();
  // A token event's sender and outer nonce do not identify an EOA transaction.
  // Once its real body is present, keep that body's existing nonce grouping.
  const outerHashes = new Set<string>();
  for (const input of transactions) {
    const tx = input as any;
    const hash = 'hash' in tx ? tx.hash : tx.txid;
    if (evmHistorySourcePriority(tx) > 0 && typeof hash === 'string' && hash)
      outerHashes.add(hash.toLowerCase());
  }

  for (const input of transactions) {
    const tx = input as any;
    const tokenPlaceholder = evmHistorySourcePriority(tx) === 0;
    if (
      tokenPlaceholder &&
      outerHashes.has(('hash' in tx ? tx.hash : tx.txid).toLowerCase())
    )
      continue;
    // For EVM transactions, nonce is only unique per sender. Include `from`
    // so inbound and outbound txs with the same nonce do not collapse together.
    // For UTXO or transactions without a sender nonce, use hash/txid.
    let id: string;
    if (
      !tokenPlaceholder &&
      'nonce' in tx &&
      typeof tx.nonce === 'number' &&
      'from' in tx &&
      tx.from
    ) {
      id = `${tx.from.toLowerCase()}:${tx.nonce}`;
    } else {
      id = ('hash' in tx ? tx.hash : tx.txid).toLowerCase();
    }

    // Normal deduplication by hash
    const existing = txMap.get(id);
    const sameTransaction =
      existing &&
      ('hash' in existing ? existing.hash : existing.txid).toLowerCase() ===
        ('hash' in tx ? tx.hash : tx.txid).toLowerCase();

    // Two mined rows under the same id with different block hashes mean a
    // reorg moved the transaction; the later-observed row (provider rows are
    // merged after vault rows) carries the canonical placement and must win
    // even though a later block height yields fewer confirmations.
    const isReorgReplacement = Boolean(
      existing &&
        isHistoryTransactionInBlock(existing) &&
        isHistoryTransactionInBlock(tx) &&
        (existing as any).blockHash &&
        (tx as any).blockHash &&
        String((existing as any).blockHash).toLowerCase() !==
          String((tx as any).blockHash).toLowerCase()
    );

    // Update if: no existing tx, more confirmations, reorg replacement, or
    // transaction just got into a block
    const shouldUpdate =
      !existing ||
      tx.confirmations > existing.confirmations ||
      isReorgReplacement ||
      (existing &&
        !isHistoryTransactionInBlock(existing) &&
        isHistoryTransactionInBlock(tx));

    if (shouldUpdate) {
      // If this is a new tx or has better status, it becomes our candidate
      const mergedTx = existing ? { ...tx } : tx;

      // Timestamps belong to a hash, not the nonce shared by its replacements.
      if (existing && sameTransaction) {
        const TSTAMP_PROP = 'timestamp' as string;
        const BLOCKTIME_PROP = 'blockTime' as string;

        if (
          existing[TSTAMP_PROP] &&
          (!mergedTx[TSTAMP_PROP] ||
            existing[TSTAMP_PROP] < mergedTx[TSTAMP_PROP])
        ) {
          (mergedTx as any)[TSTAMP_PROP] = existing[TSTAMP_PROP];
        }

        if (
          existing[BLOCKTIME_PROP] &&
          (!mergedTx[BLOCKTIME_PROP] ||
            existing[BLOCKTIME_PROP] < mergedTx[BLOCKTIME_PROP])
        ) {
          (mergedTx as any)[BLOCKTIME_PROP] = existing[BLOCKTIME_PROP];
        }
      }

      txMap.set(id, mergedTx);
    } else if (existing) {
      // The existing tx has same or more confirmations, but enrich it with
      // authoritative explorer metadata and earlier timestamps. Older vault
      // rows may predate the source/type fields used for EOA nonce filtering.
      const TSTAMP_PROP = 'timestamp' as string;
      const BLOCKTIME_PROP = 'blockTime' as string;

      let updated = false;
      const mergedTx = { ...existing };

      for (const metadataProperty of ['historySource', 'type', 'r', 's', 'v']) {
        if (
          (tx as any)[metadataProperty] !== undefined &&
          (tx as any)[metadataProperty] !== (existing as any)[metadataProperty]
        ) {
          (mergedTx as any)[metadataProperty] = (tx as any)[metadataProperty];
          updated = true;
        }
      }

      if (
        sameTransaction &&
        tx[TSTAMP_PROP] &&
        (!existing[TSTAMP_PROP] || tx[TSTAMP_PROP] < existing[TSTAMP_PROP])
      ) {
        (mergedTx as any)[TSTAMP_PROP] = tx[TSTAMP_PROP];
        updated = true;
      }

      if (
        sameTransaction &&
        tx[BLOCKTIME_PROP] &&
        (!existing[BLOCKTIME_PROP] ||
          tx[BLOCKTIME_PROP] < existing[BLOCKTIME_PROP])
      ) {
        (mergedTx as any)[BLOCKTIME_PROP] = tx[BLOCKTIME_PROP];
        updated = true;
      }

      if (updated) {
        txMap.set(id, mergedTx);
      }
    }
  }

  // Convert to array and sort
  const deduplicatedTxs = Array.from(txMap.values());

  // Sort by confirmations ascending (pending first), then by timestamp descending
  deduplicatedTxs.sort((a, b) => {
    if (a.confirmations !== b.confirmations) {
      return a.confirmations - b.confirmations; // pending (0) first
    }
    // If confirmations are equal, sort by timestamp descending
    const aTime = (a as any).timestamp || (a as any).blockTime || 0;
    const bTime = (b as any).timestamp || (b as any).blockTime || 0;
    return bTime - aTime;
  });

  // Return limited array
  return deduplicatedTxs.slice(0, limit);
};
