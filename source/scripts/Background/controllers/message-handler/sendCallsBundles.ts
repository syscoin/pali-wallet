import { ethErrors } from 'helpers/errors';

import cleanErrorStack from 'utils/cleanErrorStack';
import {
  computeCallsStatusCode,
  ISendCallsBatchDescriptor,
} from 'utils/sendCallsBatch';
import {
  PALI_ENTRYPOINT_V09_ADDRESS,
  paliEntryPointInterface,
} from 'utils/smartAccount';

// ---------------------------------------------------------------------------
// EIP-5792 bundle registry + status resolution.
//
// The per-host registry is the single source of truth for bundle ids: only
// ids that wallet_sendCalls actually issued (wallet-minted random ids or
// validated app-provided ids) resolve in wallet_getCallsStatus /
// wallet_showCallsStatus; anything else is the spec 5730 unknown-bundle
// error. Ids are reserved atomically before the approval popup opens (so
// concurrent duplicate app-provided ids are rejected with 5720) and updated
// with the transaction hashes after broadcast. Records are persisted in
// chrome.storage.local so they survive MV3 service-worker restarts, scoped
// per host (the spec scopes id uniqueness per sender per app).
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pali-sendcalls-bundles';
const MAX_BUNDLES_PER_HOST = 50;
const BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Spec: ids MUST be unique strings up to 4096 bytes (8194 chars with 0x).
const MAX_BUNDLE_ID_CHARS = 8194;

interface IStoredSendCallsBundle extends ISendCallsBatchDescriptor {
  createdAt: number;
  // True while the id is reserved but the batch has not been broadcast yet.
  pending?: boolean;
}

// All store mutations run through this queue: the background service worker
// is the only writer, so serializing read-modify-write cycles makes
// reserve/record/release atomic with respect to each other.
let storeQueue: Promise<unknown> = Promise.resolve();
const withStoreLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = storeQueue.then(fn, fn);
  storeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

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

// Wallet-minted bundle ids are 32 random bytes: unguessable and carrying no
// information, so a dapp cannot fabricate an id this wallet never issued nor
// correlate ids across apps.
export const generateWalletBundleId = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
};

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
    failed: bundle.failed,
    smartAccount: bundle.smartAccount,
    txHashes: bundle.txHashes,
  };
};

const evictAndWrite = async (
  storeData: TBundleStore,
  host: string,
  hostBundles: { [id: string]: IStoredSendCallsBundle },
  now: number
): Promise<void> => {
  // Evict expired entries, then the oldest beyond the per-host cap.
  const entries = Object.entries(hostBundles).filter(
    ([, bundle]) => now - bundle.createdAt <= BUNDLE_TTL_MS
  );
  entries.sort(([, a], [, b]) => b.createdAt - a.createdAt);
  storeData[host] = Object.fromEntries(entries.slice(0, MAX_BUNDLES_PER_HOST));
  await writeBundleStore(storeData);
};

// Atomically reserves a bundle id before the approval popup opens. Returns
// false when the id is already taken for this host (reserved or completed),
// which the caller maps to the spec 5720 duplicate-id error.
export const reserveSendCallsBundle = (
  host: string,
  id: string,
  descriptor: Omit<ISendCallsBatchDescriptor, 'txHashes'>
): Promise<boolean> =>
  withStoreLock(async () => {
    const storeData = await readBundleStore();
    const now = Date.now();
    const hostBundles = storeData[host] || {};
    const existing = hostBundles[id];
    if (existing && now - existing.createdAt <= BUNDLE_TTL_MS) {
      return false;
    }
    hostBundles[id] = {
      ...descriptor,
      txHashes: [],
      createdAt: now,
      pending: true,
    };
    await evictAndWrite(storeData, host, hostBundles, now);
    return true;
  });

// Finalizes a reservation with the broadcast transaction hashes (also used
// by the SendCalls popup through MainController.recordSendCallsBundle).
export const recordSendCallsBundle = (
  host: string,
  id: string,
  descriptor: ISendCallsBatchDescriptor
): Promise<void> =>
  withStoreLock(async () => {
    const storeData = await readBundleStore();
    const now = Date.now();
    const hostBundles = storeData[host] || {};
    const createdAt = hostBundles[id]?.createdAt ?? now;
    hostBundles[id] = { ...descriptor, createdAt, pending: false };
    await evictAndWrite(storeData, host, hostBundles, now);
  });

// Drops a reservation whose request failed before broadcast (user rejection,
// popup error). Only removes records that never received transaction hashes
// so a finalized bundle can never be deleted by a late cleanup.
export const releaseSendCallsBundleReservation = (
  host: string,
  id: string
): Promise<void> =>
  withStoreLock(async () => {
    const storeData = await readBundleStore();
    const bundle = storeData[host]?.[id];
    if (!bundle || !bundle.pending || bundle.txHashes.length > 0) {
      return;
    }
    delete storeData[host][id];
    await writeBundleStore(storeData);
  });

const unknownBundleError = () => {
  const error = new Error('Unknown bundle id');
  (error as any).code = 5730;
  return cleanErrorStack(error);
};

// Resolves an id to its batch descriptor from the per-host registry: only
// ids this wallet actually issued to the host resolve. Null when unknown.
export const resolveSendCallsBundleDescriptor = (
  host: string,
  id: string
): Promise<ISendCallsBatchDescriptor | null> =>
  getStoredSendCallsBundle(host, id);

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
// object by fetching transaction receipts. Receipts are queried on the
// bundle's own chain (the descriptor carries its chainId), not the active
// network, so status stays correct after the user switches networks. Throws
// the spec "Unknown bundle id" error (5730) for ids this wallet did not
// produce or record, and 5710 when the bundle's chain is no longer
// configured in the wallet.
export const resolveCallsStatus = async (
  getProviderForChain: (chainId: number) => any | null,
  host: string,
  id: string
): Promise<any> => {
  const descriptor = await resolveSendCallsBundleDescriptor(host, id);
  if (!descriptor) {
    throw unknownBundleError();
  }

  // No broadcast hashes: still pending while the approval popup is open, or
  // an offchain failure when the batch terminally failed before broadcast.
  if (descriptor.txHashes.length === 0) {
    return {
      version: '2.0.0',
      id,
      chainId: `0x${descriptor.chainId.toString(16)}`,
      atomic: descriptor.atomic,
      status: computeCallsStatusCode({
        atomic: descriptor.atomic,
        receiptStatuses: [],
        smartAccount: descriptor.smartAccount,
        someCallsFailedToBroadcast: descriptor.failed,
      }),
    };
  }

  const provider = getProviderForChain(descriptor.chainId);
  if (!provider) {
    throw cleanErrorStack(
      ethErrors.provider.custom({
        code: 5710,
        message: `This wallet has no RPC configured for the bundle's chain (chainId ${descriptor.chainId}).`,
      })
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
    someCallsFailedToBroadcast: descriptor.failed,
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
