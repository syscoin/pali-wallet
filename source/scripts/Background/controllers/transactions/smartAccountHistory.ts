import { BigNumber } from '@ethersproject/bignumber';
import { hexZeroPad } from '@ethersproject/bytes';
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import store from 'state/store';
import { setAccountPropertyByIdAndType } from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import type { KeyringAccountType } from 'types/network';
import {
  getPaliEntryPointAddressForFactory,
  paliEntryPointInterface,
} from 'utils/smartAccount';

import { IEvmTransactionResponse } from './types';

/**
 * ERC-4337 history for Pali smart accounts.
 *
 * Explorer `txlist` queries keyed on the smart-account address structurally
 * cannot return 4337 executions: the on-chain transaction is
 * `gasPayer -> EntryPoint (handleOps)`. The EntryPoint, however, emits
 * `UserOperationEvent` with the smart account as an indexed `sender` topic,
 * so a single `eth_getLogs` call yields the full execution history without
 * any explorer indexing support.
 */

const USER_OP_EVENT_TOPIC =
  paliEntryPointInterface.getEventTopic('UserOperationEvent');
// Re-scan a small window behind the cursor to tolerate shallow reorgs.
const REORG_SAFETY_BLOCKS = 5;
// Bounded chunk size for providers that cap eth_getLogs block ranges.
const FALLBACK_SCAN_BLOCKS = 10_000;
// Cap RPC load per poll while backfilling on range-capped providers; the
// cursor persists partial contiguous progress so successive polls walk the
// remaining range up to the tip.
const MAX_BACKFILL_CHUNKS_PER_POLL = 10;

type ScannedAccount = {
  address: string;
  id: number;
  smartAccount?: {
    descriptor?: {
      entryPointAddress?: string;
      factoryAddress?: string;
    };
    entryPointAddress?: string;
    factoryAddress?: string;
  };
  smartAccountUserOpScanByChainId?: Record<number, number>;
};

type RawRpcTransaction = {
  blockHash: string | null;
  blockNumber: string | null;
  from: string;
  gas?: string;
  gasPrice?: string;
  hash: string;
  input: string;
  nonce: string;
  to: string | null;
  value: string;
};

const sendBatchOrSequential = async (
  provider: CustomJsonRpcProvider,
  method: string,
  params: Array<any[]>
): Promise<any[]> => {
  if (params.length === 0) {
    return [];
  }
  if (params.length > 1 && typeof provider.sendBatch === 'function') {
    try {
      return await provider.sendBatch(method, params);
    } catch {
      // Fall back to sequential requests below.
    }
  }
  const results: any[] = [];
  for (const param of params) {
    try {
      results.push(await provider.send(method, param));
    } catch {
      results.push(null);
    }
  }
  return results;
};

const getVaultSmartAccountTransactions = (
  accountId: number,
  accountType: KeyringAccountType,
  chainId: number
): any[] => {
  const { accountTransactions } = store.getState().vault;
  return (
    accountTransactions[accountType]?.[accountId]?.[
      TransactionsType.Ethereum
    ]?.[chainId] || []
  );
};

const refreshExistingConfirmations = (
  account: ScannedAccount,
  accountType: KeyringAccountType,
  chainId: number,
  latestBlock: number
): IEvmTransactionResponse[] => {
  const normalizedAccount = account.address.toLowerCase();
  return getVaultSmartAccountTransactions(account.id, accountType, chainId)
    .filter(
      (tx: any) =>
        tx?.blockNumber &&
        tx?.blockHash &&
        String(tx.smartAccountExecutionFrom || '').toLowerCase() ===
          normalizedAccount
    )
    .map((tx: any) => ({
      ...tx,
      confirmations: Math.max(0, latestBlock - Number(tx.blockNumber)),
    }));
};

const getAccountEntryPointAddresses = (account: ScannedAccount): string[] => {
  const metadata = account.smartAccount;
  const entryPointAddress =
    metadata?.entryPointAddress || metadata?.descriptor?.entryPointAddress;
  if (entryPointAddress) {
    return [entryPointAddress];
  }
  const factoryAddress =
    metadata?.factoryAddress || metadata?.descriptor?.factoryAddress;
  return [getPaliEntryPointAddressForFactory(factoryAddress)];
};

// Always target the account whose logs were scanned: a poll can still be in
// flight when the user switches accounts, and writing through an
// "active account" reducer at completion time would stamp the cursor onto
// the wrong account, permanently skipping its older user operations.
const persistScanCursor = (
  accountId: number,
  accountType: KeyringAccountType,
  chainId: number,
  scannedThroughBlock: number
) => {
  try {
    const { accounts } = store.getState().vault;
    const account = accounts[accountType]?.[accountId] as any;
    if (!account) {
      return;
    }
    const byChain = {
      ...(account.smartAccountUserOpScanByChainId || {}),
      [chainId]: scannedThroughBlock,
    };
    store.dispatch(
      setAccountPropertyByIdAndType({
        id: accountId,
        property: 'smartAccountUserOpScanByChainId',
        type: accountType,
        value: byChain,
      })
    );
  } catch (error) {
    console.warn('[smartAccountHistory] Failed to persist scan cursor:', error);
  }
};

/**
 * Backfill logs in bounded chunks for providers that reject wide ranges.
 * Coverage is contiguous from `fromBlock`: the scan stops at the first
 * failing chunk (or the per-poll chunk cap) and reports how far it got, so
 * the cursor can persist partial progress without leaving gaps. Returns
 * null when not even the first chunk could be scanned.
 */
const scanLogsInChunks = async (
  provider: CustomJsonRpcProvider,
  filter: Record<string, unknown>,
  fromBlock: number,
  latestBlock: number
): Promise<{ coveredToBlock: number; logs: any[] } | null> => {
  const logs: any[] = [];
  let coveredToBlock = fromBlock - 1;
  let chunkStart = fromBlock;
  for (
    let chunk = 0;
    chunk < MAX_BACKFILL_CHUNKS_PER_POLL && chunkStart <= latestBlock;
    chunk++
  ) {
    const chunkEnd = Math.min(
      chunkStart + FALLBACK_SCAN_BLOCKS - 1,
      latestBlock
    );
    try {
      const chunkLogs = await provider.getLogs({
        ...filter,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      });
      logs.push(...chunkLogs);
    } catch {
      // Stop here to keep coverage contiguous; the next poll resumes from
      // the persisted cursor.
      break;
    }
    coveredToBlock = chunkEnd;
    chunkStart = chunkEnd + 1;
  }
  if (coveredToBlock < fromBlock) {
    return null;
  }
  return { coveredToBlock, logs };
};

export const fetchSmartAccountUserOpTransactions = async (
  provider: CustomJsonRpcProvider,
  account: ScannedAccount,
  accountType: KeyringAccountType,
  chainId: number
): Promise<IEvmTransactionResponse[]> => {
  const latestBlock = await provider.getBlockNumber();
  const refreshedExisting = refreshExistingConfirmations(
    account,
    accountType,
    chainId,
    latestBlock
  );

  const cursor = Number(account.smartAccountUserOpScanByChainId?.[chainId]);
  const hasCursor = Number.isFinite(cursor) && cursor > 0;
  const fromBlock = hasCursor ? Math.max(0, cursor - REORG_SAFETY_BLOCKS) : 0;
  const baseFilter = {
    fromBlock,
    toBlock: latestBlock,
    topics: [USER_OP_EVENT_TOPIC, null, hexZeroPad(account.address, 32)],
  };
  const filters = getAccountEntryPointAddresses(account).map((address) => ({
    ...baseFilter,
    address,
  }));

  let logs;
  // Highest block contiguously covered from `fromBlock`; only this can be
  // persisted as the cursor without leaving gaps.
  let coveredToBlock = latestBlock;
  try {
    logs = (
      await Promise.all(filters.map((filter) => provider.getLogs(filter)))
    ).flat();
  } catch {
    // Range-capped RPC: backfill in bounded chunks from the intended start
    // so older history is eventually indexed (partial contiguous progress
    // is persisted via the cursor), then peek at the tip window so fresh
    // activity is visible immediately while the backfill catches up.
    const chunkedResults = await Promise.all(
      filters.map((filter) =>
        scanLogsInChunks(provider, filter, fromBlock, latestBlock)
      )
    );
    if (chunkedResults.some((chunked) => !chunked)) {
      console.warn(
        '[smartAccountHistory] eth_getLogs failed, keeping local history only'
      );
      return refreshedExisting;
    }
    logs = chunkedResults.flatMap((chunked) => chunked?.logs || []);
    coveredToBlock = Math.min(
      ...chunkedResults.map((chunked) => chunked?.coveredToBlock || fromBlock)
    );
    if (coveredToBlock < latestBlock) {
      const tipFromBlock = Math.max(
        coveredToBlock + 1,
        latestBlock - FALLBACK_SCAN_BLOCKS
      );
      try {
        const tipLogs = (
          await Promise.all(
            filters.map((filter) =>
              provider.getLogs({
                ...filter,
                fromBlock: tipFromBlock,
              })
            )
          )
        ).flat();
        logs = [...logs, ...tipLogs];
      } catch {
        // Best effort only; the backfill cursor reaches these blocks later.
      }
    }
  }

  // A UserOperationEvent is emitted even when the inner execution reverted
  // (success=false). Aggregate per outer transaction: every op for this
  // sender in the bundle must have succeeded for the tx to show as success.
  const successByTxHash = new Map<string, boolean>();
  const logBlockHashByTxHash = new Map<string, string>();
  for (const log of logs) {
    try {
      const parsed = paliEntryPointInterface.parseLog(log);
      const key = log.transactionHash.toLowerCase();
      const success = Boolean(parsed.args.success);
      successByTxHash.set(key, (successByTxHash.get(key) ?? true) && success);
      if (log.blockHash) {
        logBlockHashByTxHash.set(key, String(log.blockHash).toLowerCase());
      }
    } catch {
      // Topic filter guarantees the event type; decode failures are skipped.
    }
  }

  const vaultTxsByHash = new Map<string, any>(
    getVaultSmartAccountTransactions(account.id, accountType, chainId)
      .filter((tx: any) => tx?.hash)
      .map((tx: any) => [String(tx.hash).toLowerCase(), tx])
  );
  const hashesToFetch = Array.from(successByTxHash.keys()).filter((hash) => {
    const existing = vaultTxsByHash.get(hash);
    // Skip outer transactions that are already confirmed in the vault; their
    // confirmation counters are refreshed locally above.
    if (!(existing?.blockNumber && existing?.blockHash)) {
      return true;
    }
    // A shallow reorg inside the safety window can move an already-indexed
    // transaction to a different block; refetch when the freshly scanned
    // log's blockHash disagrees with the cached copy.
    const logBlockHash = logBlockHashByTxHash.get(hash);
    return Boolean(
      logBlockHash && logBlockHash !== String(existing.blockHash).toLowerCase()
    );
  });
  const hashesToRefetch = new Set(
    hashesToFetch.filter((hash) => vaultTxsByHash.has(hash))
  );

  let fetchedTransactions: IEvmTransactionResponse[] = [];
  let allDetailsFetched = true;
  if (hashesToFetch.length > 0) {
    const rawTransactions = (await sendBatchOrSequential(
      provider,
      'eth_getTransactionByHash',
      hashesToFetch.map((hash) => [hash])
    )) as Array<RawRpcTransaction | null>;
    const minedTransactions = rawTransactions.filter(
      (tx): tx is RawRpcTransaction =>
        Boolean(tx && tx.blockNumber && tx.blockHash)
    );
    // Logs only exist for mined transactions, so a null/unmined detail result
    // is a transient RPC failure; the dropped entry must be retried later.
    allDetailsFetched = minedTransactions.length === hashesToFetch.length;

    const uniqueBlockNumbers = Array.from(
      new Set(minedTransactions.map((tx) => tx.blockNumber as string))
    );
    const blocks = await sendBatchOrSequential(
      provider,
      'eth_getBlockByNumber',
      uniqueBlockNumbers.map((blockNumber) => [blockNumber, false])
    );
    const timestampByBlock = new Map<string, number>();
    blocks.forEach((block: any, index: number) => {
      if (block?.timestamp) {
        timestampByBlock.set(
          uniqueBlockNumbers[index],
          parseInt(block.timestamp, 16)
        );
      }
    });

    fetchedTransactions = minedTransactions.map((tx) => {
      const blockNumber = parseInt(tx.blockNumber as string, 16);
      const success = successByTxHash.get(tx.hash.toLowerCase()) !== false;
      return {
        blockHash: tx.blockHash,
        blockNumber,
        chainId,
        confirmations: Math.max(0, latestBlock - blockNumber),
        from: tx.from,
        gas: tx.gas ? BigNumber.from(tx.gas).toString() : undefined,
        gasPrice: tx.gasPrice
          ? BigNumber.from(tx.gasPrice).toString()
          : undefined,
        hash: tx.hash,
        input: tx.input,
        isError: success ? '0' : '1',
        nonce: parseInt(tx.nonce, 16),
        smartAccountExecution: true,
        smartAccountExecutionFrom: account.address,
        timestamp:
          timestampByBlock.get(tx.blockNumber as string) ||
          Math.floor(Date.now() / 1000),
        to: tx.to,
        // eslint-disable-next-line camelcase
        txreceipt_status: success ? '1' : '0',
        value: BigNumber.from(tx.value || 0).toString(),
      } as unknown as IEvmTransactionResponse;
    });
  }

  // Advance the cursor only through the contiguously covered range and only
  // when every logged transaction was materialized: a transient
  // eth_getTransactionByHash failure drops a logged user operation that
  // would never be re-scanned once the cursor passes it. Tip-window logs
  // beyond coveredToBlock are display-only and never move the cursor.
  if (allDetailsFetched) {
    persistScanCursor(account.id, accountType, chainId, coveredToBlock);
  }

  // Reorged transactions that were successfully refetched replace their
  // stale cached copies; if the refetch failed, keep the cached copy until
  // the next poll retries.
  const refetchedHashes = new Set(
    fetchedTransactions
      .filter((tx) => hashesToRefetch.has(String(tx.hash).toLowerCase()))
      .map((tx) => String(tx.hash).toLowerCase())
  );
  const survivingExisting =
    refetchedHashes.size > 0
      ? refreshedExisting.filter(
          (tx) => !refetchedHashes.has(String(tx.hash).toLowerCase())
        )
      : refreshedExisting;

  // Cached rows skipped from refetch still need the log-derived inner-op
  // status: a locally submitted execution is saved from the outer handleOps
  // transaction, which mines successfully even when the inner user
  // operation reverted (UserOperationEvent success=false).
  const statusPatchedExisting = survivingExisting.map((tx: any) => {
    const success = successByTxHash.get(String(tx.hash).toLowerCase());
    if (success === undefined) {
      return tx;
    }
    return {
      ...tx,
      isError: success ? '0' : '1',
      // eslint-disable-next-line camelcase
      txreceipt_status: success ? '1' : '0',
    };
  });

  return [...statusPatchedExisting, ...fetchedTransactions];
};
