import { BigNumber } from '@ethersproject/bignumber';
import { hexZeroPad } from '@ethersproject/bytes';
import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import store from 'state/store';
import { setActiveAccountProperty } from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import {
  PALI_ENTRYPOINT_V09_ADDRESS,
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
// Bounded window retry for providers that cap eth_getLogs block ranges.
const FALLBACK_SCAN_BLOCKS = 10_000;

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

const getVaultSmartAccountTransactions = (chainId: number): any[] => {
  const { accountTransactions, activeAccount } = store.getState().vault;
  return (
    accountTransactions[activeAccount.type]?.[activeAccount.id]?.[
      TransactionsType.Ethereum
    ]?.[chainId] || []
  );
};

const refreshExistingConfirmations = (
  accountAddress: string,
  chainId: number,
  latestBlock: number
): IEvmTransactionResponse[] => {
  const normalizedAccount = accountAddress.toLowerCase();
  return getVaultSmartAccountTransactions(chainId)
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

const persistScanCursor = (chainId: number, latestBlock: number) => {
  try {
    const { accounts, activeAccount } = store.getState().vault;
    const account = accounts[activeAccount.type]?.[activeAccount.id] as any;
    const byChain = {
      ...(account?.smartAccountUserOpScanByChainId || {}),
      [chainId]: latestBlock,
    };
    store.dispatch(
      setActiveAccountProperty({
        property: 'smartAccountUserOpScanByChainId',
        value: byChain,
      })
    );
  } catch (error) {
    console.warn('[smartAccountHistory] Failed to persist scan cursor:', error);
  }
};

export const fetchSmartAccountUserOpTransactions = async (
  provider: CustomJsonRpcProvider,
  account: {
    address: string;
    smartAccountUserOpScanByChainId?: Record<number, number>;
  },
  chainId: number
): Promise<IEvmTransactionResponse[]> => {
  const latestBlock = await provider.getBlockNumber();
  const refreshedExisting = refreshExistingConfirmations(
    account.address,
    chainId,
    latestBlock
  );

  const cursor = Number(account.smartAccountUserOpScanByChainId?.[chainId]);
  const hasCursor = Number.isFinite(cursor) && cursor > 0;
  const fromBlock = hasCursor ? Math.max(0, cursor - REORG_SAFETY_BLOCKS) : 0;
  const filter = {
    address: PALI_ENTRYPOINT_V09_ADDRESS,
    fromBlock,
    toBlock: latestBlock,
    topics: [USER_OP_EVENT_TOPIC, null, hexZeroPad(account.address, 32)],
  };

  let logs;
  let scannedFromBlock = fromBlock;
  try {
    logs = await provider.getLogs(filter);
  } catch {
    const boundedFromBlock = Math.max(0, latestBlock - FALLBACK_SCAN_BLOCKS);
    try {
      logs = await provider.getLogs({
        ...filter,
        fromBlock: boundedFromBlock,
      });
      scannedFromBlock = boundedFromBlock;
    } catch (fallbackError) {
      console.warn(
        '[smartAccountHistory] eth_getLogs failed, keeping local history only:',
        fallbackError
      );
      return refreshedExisting;
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
    getVaultSmartAccountTransactions(chainId)
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

  // Only advance the cursor when the scan actually covered the intended
  // range AND every logged transaction in that range was materialized:
  // - A bounded fallback window that starts after the previous cursor (or
  //   after genesis on a first scan) leaves a gap of unindexed blocks.
  // - A transient eth_getTransactionByHash failure drops a logged user
  //   operation that would never be re-scanned once the cursor passes it.
  // In either case persisting latestBlock would permanently skip those user
  // operations; leaving the cursor untouched makes the next poll retry.
  if (scannedFromBlock <= fromBlock && allDetailsFetched) {
    persistScanCursor(chainId, latestBlock);
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

  return [...survivingExisting, ...fetchedTransactions];
};
