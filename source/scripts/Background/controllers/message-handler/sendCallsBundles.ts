import { ethErrors } from 'helpers/errors';

import cleanErrorStack from 'utils/cleanErrorStack';
import {
  computeCallsStatusCode,
  decodeSendCallsBatchId,
  ISendCallsBatchDescriptor,
} from 'utils/sendCallsBatch';
import {
  PALI_ENTRYPOINT_V09_ADDRESS,
  paliEntryPointInterface,
} from 'utils/smartAccount';

// ---------------------------------------------------------------------------
// EIP-5792 bundle registry + status resolution.
//
// Wallet-minted bundle ids are self-describing (see utils/sendCallsBatch) and
// need no storage. This registry only tracks bundles whose id was supplied by
// the dapp in wallet_sendCalls: the spec requires the wallet to respect and
// return app-provided ids (and reject duplicates with error 5720), and such
// ids cannot carry the transaction hashes because they are chosen before
// execution. Records are persisted in chrome.storage.local so lookups survive
// MV3 service-worker restarts, scoped per host (the spec scopes id uniqueness
// per sender per app).
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pali-sendcalls-bundles';
const MAX_BUNDLES_PER_HOST = 50;
const BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Spec: ids MUST be unique strings up to 4096 bytes (8194 chars with 0x).
const MAX_BUNDLE_ID_CHARS = 8194;

interface IStoredSendCallsBundle extends ISendCallsBatchDescriptor {
  createdAt: number;
}

type TBundleStore = {
  [host: string]: { [id: string]: IStoredSendCallsBundle };
};

const readBundleStore = (): Promise<TBundleStore> =>
  new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error(
          '[sendCallsBundles] Failed to read store:',
          chrome.runtime.lastError
        );
        resolve({});
        return;
      }
      resolve((result?.[STORAGE_KEY] as TBundleStore) || {});
    });
  });

const writeBundleStore = (storeData: TBundleStore): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: storeData }, () => {
      if (chrome.runtime.lastError) {
        console.error(
          '[sendCallsBundles] Failed to write store:',
          chrome.runtime.lastError
        );
      }
      resolve();
    });
  });

export const isValidAppProvidedBundleId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^0x[0-9a-fA-F]+$/.test(id) &&
  id.length <= MAX_BUNDLE_ID_CHARS;

export const getStoredSendCallsBundle = async (
  host: string,
  id: string
): Promise<ISendCallsBatchDescriptor | null> => {
  const storeData = await readBundleStore();
  const bundle = storeData[host]?.[id];
  if (!bundle) {
    return null;
  }
  return {
    atomic: bundle.atomic,
    chainId: bundle.chainId,
    smartAccount: bundle.smartAccount,
    txHashes: bundle.txHashes,
  };
};

export const recordSendCallsBundle = async (
  host: string,
  id: string,
  descriptor: ISendCallsBatchDescriptor
): Promise<void> => {
  const storeData = await readBundleStore();
  const now = Date.now();
  const hostBundles = storeData[host] || {};

  hostBundles[id] = { ...descriptor, createdAt: now };

  // Evict expired entries, then the oldest beyond the per-host cap.
  const entries = Object.entries(hostBundles).filter(
    ([, bundle]) => now - bundle.createdAt <= BUNDLE_TTL_MS
  );
  entries.sort(([, a], [, b]) => b.createdAt - a.createdAt);
  storeData[host] = Object.fromEntries(entries.slice(0, MAX_BUNDLES_PER_HOST));

  await writeBundleStore(storeData);
};

const unknownBundleError = () => {
  const error = new Error('Unknown bundle id');
  (error as any).code = 5730;
  return cleanErrorStack(error);
};

// Resolves an id to its batch descriptor: wallet-minted ids decode directly,
// app-provided ids come from the per-host registry. Null when unknown.
export const resolveSendCallsBundleDescriptor = async (
  host: string,
  id: string
): Promise<ISendCallsBatchDescriptor | null> =>
  decodeSendCallsBatchId(id) || (await getStoredSendCallsBundle(host, id));

// The outer EntryPoint.handleOps transaction can mine successfully even when
// the inner user operation reverted, so for smart-account batches the
// UserOperationEvent.success flag is the source of truth. Returns undefined
// when no UserOperationEvent was found in any receipt.
const aggregateUserOperationSuccess = (
  receipts: any[]
): boolean | undefined => {
  const userOpEventTopic =
    paliEntryPointInterface.getEventTopic('UserOperationEvent');
  const entryPoint = PALI_ENTRYPOINT_V09_ADDRESS.toLowerCase();
  let found = false;
  let allSucceeded = true;
  for (const receipt of receipts) {
    for (const log of receipt?.logs || []) {
      if (
        String(log.address || '').toLowerCase() !== entryPoint ||
        log.topics?.[0] !== userOpEventTopic
      ) {
        continue;
      }
      try {
        const parsed = paliEntryPointInterface.parseLog(log);
        found = true;
        allSucceeded = allSucceeded && Boolean(parsed.args.success);
      } catch (error) {
        // Ignore logs that do not decode as UserOperationEvent.
      }
    }
  }
  return found ? allSucceeded : undefined;
};

// EIP-5792 v2.0.0 wallet_getCallsStatus: resolves a bundle id into the status
// object by fetching transaction receipts from the given provider. Throws the
// spec "Unknown bundle id" error (5730) for ids this wallet did not produce
// or record.
export const resolveCallsStatus = async (
  provider: any,
  host: string,
  id: string
): Promise<any> => {
  const descriptor = await resolveSendCallsBundleDescriptor(host, id);
  if (!descriptor) {
    throw unknownBundleError();
  }

  if (!provider) {
    throw cleanErrorStack(
      ethErrors.rpc.internal(
        'No EVM provider available to resolve call status.'
      )
    );
  }

  const receipts = await Promise.all(
    descriptor.txHashes.map((hash) =>
      provider.getTransactionReceipt(hash).catch(() => null)
    )
  );
  const receiptStatuses = receipts.map((receipt) =>
    receipt ? (receipt.status === 0 ? '0x0' : '0x1') : null
  ) as Array<'0x0' | '0x1' | null>;

  let smartAccountInnerSuccess: boolean | undefined;
  if (descriptor.smartAccount) {
    smartAccountInnerSuccess = aggregateUserOperationSuccess(receipts);
    if (
      smartAccountInnerSuccess === undefined &&
      receipts.every((receipt) => receipt !== null)
    ) {
      // Mined but no UserOperationEvent decoded (unexpected for Pali batches):
      // fall back to the outer receipt status instead of reporting pending.
      smartAccountInnerSuccess = receipts.every(
        (receipt) => receipt && receipt.status !== 0
      );
    }
  }

  const status = computeCallsStatusCode({
    atomic: descriptor.atomic,
    receiptStatuses,
    smartAccount: descriptor.smartAccount,
    smartAccountInnerSuccess,
  });

  const minedReceipts = receipts
    .filter((receipt) => Boolean(receipt))
    .map((receipt: any) => ({
      blockHash: receipt.blockHash,
      blockNumber: `0x${Number(receipt.blockNumber).toString(16)}`,
      gasUsed:
        typeof receipt.gasUsed?.toHexString === 'function'
          ? receipt.gasUsed.toHexString()
          : `0x${BigInt(receipt.gasUsed ?? 0).toString(16)}`,
      logs: (receipt.logs || []).map((log: any) => ({
        address: log.address,
        data: log.data,
        topics: log.topics,
      })),
      status: receipt.status === 0 ? '0x0' : '0x1',
      transactionHash: receipt.transactionHash,
    }));

  return {
    version: '2.0.0',
    id,
    chainId: `0x${descriptor.chainId.toString(16)}`,
    atomic: descriptor.atomic,
    status,
    ...(minedReceipts.length > 0 ? { receipts: minedReceipts } : {}),
  };
};
