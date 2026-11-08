import {
  readEvmOwnData,
  serializePreparedEvmTransaction,
  snapshotPreparedEvmTransaction,
  type PreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import {
  assertSignedEvmTransactionMatches,
  evmSubmissionFailure,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { Transaction } from 'ethers/transaction';

import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import {
  assertSmartAccountCallsIdentity,
  getSmartAccountCallsOutcome,
  normalizeDappCallsReceipt,
} from '../shared/dappCallsStatus.ts';
import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import { readEvmRpcHash } from '../shared/evmTransactionObservation.ts';
import cleanErrorStack from '../utils/cleanErrorStack.ts';
import {
  CALLS_STATUS_PENDING,
  computeCallsStatusCode,
  type ISendCallsBatchDescriptor,
} from '../utils/sendCallsBatch.ts';

import type { EoaCallsStopped } from './evmCallsSequence.ts';
import type {
  EvmSignedRecords,
  EvmSignedRecordSession,
} from './evmSignedRecords.ts';
import type {
  EvmSignedSubmission,
  EvmSubmissionLifecycle,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';

const MAX_BUNDLES_PER_HOST = 50;
const BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Authenticated alongside the SDK's exact canonical signed envelope. */
export type EoaCallsSignedAttempt = Readonly<{
  bundleId: string;
  failed: boolean;
  origin: string;
  reservationId: string;
  submissionId: string;
}>;
export function snapshotEoaCallsSignedAttempt(
  input: unknown
): EoaCallsSignedAttempt {
  const value = readEvmOwnData(input, [
    'origin',
    'bundleId',
    'reservationId',
    'submissionId',
    'failed',
  ]);
  for (const field of [
    'origin',
    'bundleId',
    'reservationId',
    'submissionId',
  ] as const)
    if (
      typeof value[field] !== 'string' ||
      !value[field] ||
      value[field].length > 8192
    )
      throw new Error('Invalid signed calls association');
  if (typeof value.failed !== 'boolean')
    throw new Error('Invalid signed calls association');
  return Object.freeze({ ...value }) as EoaCallsSignedAttempt;
}

/** Capture only the currently started reservation, before SDK persistence/wire admission. */
export async function captureEoaCallsSignedMetadata(
  registry: ReturnType<typeof createCallsBundleRegistry>,
  input: EoaCallsSignedAttempt,
  transaction: PreparedEvmTransaction
): Promise<Readonly<{ eoaCalls: EoaCallsSignedAttempt }>> {
  const attempt = snapshotEoaCallsSignedAttempt(input);
  const bundle = await registry.getStartedEoaCallsAttempt(
    attempt.origin,
    attempt.bundleId
  );
  if (
    !bundle ||
    bundle.atomic ||
    bundle.smartAccount ||
    !bundle.submissionStarted ||
    bundle.submissionCompleted ||
    bundle.stoppedTransactionHash ||
    bundle.reservationId !== attempt.reservationId ||
    bundle.submissionId !== attempt.submissionId ||
    String(bundle.chainId) !== transaction.chainId ||
    bundle.sender !== transaction.from.toLowerCase()
  )
    throw new Error('Signed calls association changed');
  return Object.freeze({ eoaCalls: attempt });
}

/** Both durable acknowledgements must precede the SDK's existing wire admission. */
export function bindEoaCallsSignedLifecycle(
  lifecycle: EvmSubmissionLifecycle,
  registry: ReturnType<typeof createCallsBundleRegistry>,
  input: EoaCallsSignedAttempt
): EvmSubmissionLifecycle {
  const attempt = snapshotEoaCallsSignedAttempt(input);
  return Object.freeze({
    ...lifecycle,
    async persistSigned(record) {
      await lifecycle.persistSigned(record);
      lifecycle.assertCurrent();
      const signed = Transaction.from(record.rawTransaction);
      if (
        !signed.hash ||
        signed.hash !== record.hash ||
        signed.from?.toLowerCase() !== record.from.toLowerCase() ||
        signed.chainId.toString() !== record.chainId
      )
        throw new Error('Signed calls association changed');
      const bundle = await registry.getStartedEoaCallsAttempt(
        attempt.origin,
        attempt.bundleId
      );
      lifecycle.assertCurrent();
      if (
        !bundle ||
        bundle.sender !== record.from.toLowerCase() ||
        String(bundle.chainId) !== record.chainId
      )
        throw new Error('Signed calls association changed');
      await registry.recordSendCallsBundle(attempt.origin, attempt.bundleId, {
        atomic: false,
        smartAccount: false,
        chainId: bundle.chainId,
        reservationId: attempt.reservationId,
        submissionId: attempt.submissionId,
        txHashes: [record.hash],
      });
      lifecycle.assertCurrent();
    },
    async dispatchSigned<T>(
      record: EvmSignedSubmission,
      initiate: () => Promise<T>,
      preflight: () => Promise<void>
    ) {
      let entered = false;
      try {
        return await lifecycle.dispatchSigned(
          record,
          () => {
            entered = true;
            return initiate();
          },
          preflight
        );
      } catch (error) {
        if (!entered)
          await registry.retractUnsentEoaCallsHash(attempt, record.hash);
        throw error;
      }
    },
  });
}

/** The SDK also owns final guards inside initiate; only its branded unsent evidence may retract. */
export async function settleEoaCallsSignedSubmission<T>(
  work: Promise<T>,
  registry: ReturnType<typeof createCallsBundleRegistry>,
  input: EoaCallsSignedAttempt
): Promise<T> {
  const attempt = snapshotEoaCallsSignedAttempt(input);
  try {
    return await work;
  } catch (error) {
    const failure = evmSubmissionFailure(error);
    if (
      failure?.transactionNotBroadcast === true &&
      failure.signedTransactionHash
    )
      await registry.retractUnsentEoaCallsHash(
        attempt,
        failure.signedTransactionHash
      );
    throw error;
  }
}

export interface IStoredSendCallsBundle extends ISendCallsBatchDescriptor {
  createdAt: number;
  // True while the id is reserved but the batch has not been broadcast yet.
  pending?: boolean;
  reservationId?: string;
  sender?: string;
  submissionId?: string;
  // Persisted before invoking a sender. A missing hash cannot prove that an
  // interrupted popup failed to broadcast, including after a worker restart.
}

export type CallsBundleStore = Record<
  string,
  Record<string, IStoredSendCallsBundle>
>;
/** Public bundle metadata is validated independently of any signing authority. */
export function assertCallsBundleStore(
  value: unknown
): asserts value is CallsBundleStore {
  const object = (input: unknown): Record<string, any> => {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      throw new Error('Invalid calls bundle metadata');
    return input as Record<string, any>;
  };
  for (const [origin, entries] of Object.entries(object(value))) {
    if (!origin || origin.length > 2048)
      throw new Error('Invalid calls bundle origin');
    for (const [id, input] of Object.entries(object(entries))) {
      const entry = object(input);
      if (
        !/^0x[\da-f]+$/i.test(id) ||
        id.length > 8194 ||
        typeof entry.atomic !== 'boolean' ||
        typeof entry.smartAccount !== 'boolean' ||
        !Number.isSafeInteger(entry.chainId) ||
        entry.chainId <= 0 ||
        !Number.isSafeInteger(entry.createdAt) ||
        entry.createdAt < 0 ||
        !Array.isArray(entry.txHashes) ||
        entry.txHashes.length > 50 ||
        entry.txHashes.some(
          (hash: unknown) =>
            typeof hash !== 'string' || !/^0x[\da-f]{64}$/i.test(hash)
        )
      )
        throw new Error('Invalid calls bundle metadata');
      for (const field of [
        'pending',
        'failed',
        'submissionStarted',
        'submissionCompleted',
        'submissionNotBroadcast',
      ])
        if (entry[field] !== undefined && typeof entry[field] !== 'boolean')
          throw new Error('Invalid calls bundle state');
      for (const field of [
        'reservationId',
        'submissionId',
        'previousSubmissionId',
      ])
        if (
          entry[field] !== undefined &&
          (typeof entry[field] !== 'string' ||
            !entry[field] ||
            entry[field].length > 8194)
        )
          throw new Error('Invalid calls bundle attempt');
      if (
        entry.sender !== undefined &&
        (typeof entry.sender !== 'string' ||
          !/^0x[\da-f]{40}$/i.test(entry.sender))
      )
        throw new Error('Invalid calls bundle sender');
      if (entry.smartAccountIdentity !== undefined) {
        assertSmartAccountCallsIdentity(
          entry.smartAccountIdentity,
          entry.chainId
        );
        if (
          !entry.smartAccount ||
          entry.smartAccountIdentity.sender !== entry.sender
        )
          throw new Error('Invalid calls bundle identity');
      }
      if (
        entry.stoppedTransactionHash !== undefined &&
        (typeof entry.stoppedTransactionHash !== 'string' ||
          !/^0x[\da-f]{64}$/i.test(entry.stoppedTransactionHash) ||
          entry.smartAccount ||
          entry.atomic ||
          !entry.submissionStarted ||
          !entry.txHashes.includes(entry.stoppedTransactionHash))
      )
        throw new Error('Invalid stopped calls attempt');
    }
  }
}
export type CallsBundlePorts = Readonly<{
  assertCurrent(): void;
  now(): number;
  randomBytes(length: number): Uint8Array;
  storage: Readonly<{
    /** Return a detached snapshot from this owner's fixed storage scope. */
    read(): Promise<CallsBundleStore>;
    /** Check the supplied owner guard at the storage commit boundary. */
    write(next: CallsBundleStore, assertCurrent: () => void): Promise<void>;
  }>;
}>;
export type CallsStatusRpc = Readonly<{
  assertCurrent(): void;
  forChain(chainId: number): Readonly<{
    getBlockHash(blockNumber: string): Promise<string | null>;
    getTransactionReceipt(hash: string): Promise<any>;
  }> | null;
}>;
export type CallsBundleStatus = Readonly<{
  atomic: boolean;
  chainId: string;
  id: string;
  receipts?: readonly Readonly<{
    blockHash: string;
    blockNumber: string;
    gasUsed: string;
    logs: readonly Readonly<{
      address: string;
      data: string;
      topics: readonly string[];
    }>[];
    status: '0x0' | '0x1';
    transactionHash: string;
  }>[];
  status: number;
  version: '2.0.0';
}>;
export type EoaSendCallsReservation = Readonly<{
  callCount: number;
  host: string;
  id: string;
  reservationId: string;
}>;

/** Shared EIP-5792 metadata lifecycle. Each factory has one fixed storage owner. */
export function createCallsBundleRegistry(ports: CallsBundlePorts) {
  if (
    typeof ports?.assertCurrent !== 'function' ||
    typeof ports.now !== 'function' ||
    typeof ports.randomBytes !== 'function' ||
    typeof ports.storage?.read !== 'function' ||
    typeof ports.storage.write !== 'function'
  )
    throw new Error('Calls bundle storage is unavailable');
  const now = ports.now.bind(ports);
  const randomBytes = ports.randomBytes.bind(ports);
  const assertCurrent = ports.assertCurrent.bind(ports);
  const read = ports.storage.read.bind(ports.storage);
  const write = ports.storage.write.bind(ports.storage);
  const check = () => {
    const result: unknown = assertCurrent();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error('Calls bundle owner changed');
    }
  };
  let storeQueue: Promise<unknown> = Promise.resolve();
  const withStoreLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = storeQueue.then(() => {
      check();
      return fn();
    });
    storeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  const readBundleStore = async (): Promise<CallsBundleStore> => {
    check();
    const value = await read();
    check();
    return value;
  };
  const writeBundleStore = async (next: CallsBundleStore): Promise<void> => {
    check();
    await write(next, check);
    check();
  };

  const hasUnresolvedSubmission = (bundle: IStoredSendCallsBundle) =>
    bundle.submissionStarted && !bundle.submissionCompleted;

  // Wallet-minted bundle ids are 32 random bytes: unguessable and carrying no
  // information, so a dapp cannot fabricate an id this wallet never issued nor
  // correlate ids across apps.
  const generateWalletBundleId = (): string => {
    check();
    const bytes = randomBytes(32);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32)
      throw new Error('Invalid calls bundle randomness');
    check();
    return `0x${Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  };

  const getStoredSendCallsBundle = async (
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
      smartAccountIdentity: bundle.smartAccountIdentity,
      submissionCompleted: bundle.submissionCompleted,
      submissionStarted: bundle.submissionStarted,
      stoppedTransactionHash: bundle.stoppedTransactionHash,
      txHashes: bundle.txHashes,
    };
  };

  const getStartedEoaCallsAttempt = async (
    host: string,
    id: string
  ): Promise<IStoredSendCallsBundle | null> => {
    const bundle = (await readBundleStore())[host]?.[id];
    if (
      !bundle ||
      bundle.atomic ||
      bundle.smartAccount ||
      !bundle.submissionStarted ||
      bundle.submissionCompleted
    )
      return null;
    return { ...bundle, txHashes: [...bundle.txHashes] };
  };

  // Only the SDK lifecycle's unentered initiate callback supplies this proof.
  const retractUnsentEoaCallsHash = (
    input: EoaCallsSignedAttempt,
    hash: string
  ): Promise<void> => {
    const attempt = snapshotEoaCallsSignedAttempt(input);
    if (!/^0x[\da-f]{64}$/.test(hash))
      throw new Error('Invalid signed calls hash');
    return withStoreLock(async () => {
      const storeData = await readBundleStore(),
        bundle = storeData[attempt.origin]?.[attempt.bundleId];
      if (
        !bundle ||
        bundle.atomic ||
        bundle.smartAccount ||
        bundle.reservationId !== attempt.reservationId ||
        bundle.submissionId !== attempt.submissionId
      )
        throw new Error('Signed calls association changed');
      if (
        !bundle.txHashes.includes(hash) &&
        bundle.stoppedTransactionHash !== hash
      )
        return;
      storeData[attempt.origin]![attempt.bundleId] = {
        ...bundle,
        txHashes: bundle.txHashes.filter((value) => value !== hash),
        stoppedTransactionHash:
          bundle.stoppedTransactionHash === hash
            ? undefined
            : bundle.stoppedTransactionHash,
      };
      await writeBundleStore(storeData);
    });
  };

  const evictAndWrite = async (
    storeData: CallsBundleStore,
    host: string,
    hostBundles: { [id: string]: IStoredSendCallsBundle },
    timestamp: number
  ): Promise<void> => {
    // Unknown submissions must keep their duplicate-id protection until an
    // outcome is recorded. Age or other requests cannot prove they never sent.
    const entries = Object.entries(hostBundles).filter(
      ([, bundle]) =>
        hasUnresolvedSubmission(bundle) ||
        timestamp - bundle.createdAt <= BUNDLE_TTL_MS
    );
    entries.sort(([, a], [, b]) => b.createdAt - a.createdAt);
    const unknown = entries.filter(([, bundle]) =>
      hasUnresolvedSubmission(bundle)
    );
    const remaining = entries.filter(
      ([, bundle]) => !hasUnresolvedSubmission(bundle)
    );
    storeData[host] = Object.fromEntries([
      ...unknown,
      ...remaining.slice(0, Math.max(0, MAX_BUNDLES_PER_HOST - unknown.length)),
    ]);
    await writeBundleStore(storeData);
  };

  // Atomically reserves a bundle id before the approval popup opens. Returns
  // false when the id is already taken for this host (reserved or completed),
  // which the caller maps to the spec 5720 duplicate-id error.
  const reserveSendCallsBundle = (
    host: string,
    id: string,
    input: Omit<
      ISendCallsBatchDescriptor,
      'txHashes' | 'smartAccountIdentity' | 'stoppedTransactionHash'
    >,
    reservationId: string,
    sender: string
  ): Promise<boolean> => {
    if (Object.hasOwn(input, 'stoppedTransactionHash'))
      throw new Error('Stopped calls require an authenticated journal record');
    const descriptor = { ...input };
    return withStoreLock(async () => {
      if (typeof sender !== 'string' || !/^0x[0-9a-f]{40}$/i.test(sender))
        throw new Error('Invalid calls sender');
      const storeData = await readBundleStore();
      const timestamp = now();
      const hostBundles = storeData[host] || {};
      const existing = hostBundles[id];
      if (
        existing &&
        (hasUnresolvedSubmission(existing) ||
          timestamp - existing.createdAt <= BUNDLE_TTL_MS)
      ) {
        return false;
      }
      if (
        Object.values(hostBundles).filter(hasUnresolvedSubmission).length >=
        MAX_BUNDLES_PER_HOST
      )
        throw new Error('Too many unresolved sendCalls bundles for this app');
      hostBundles[id] = {
        ...descriptor,
        sender: sender.toLowerCase(),
        txHashes: [],
        createdAt: timestamp,
        pending: true,
        reservationId,
      };
      await evictAndWrite(storeData, host, hostBundles, timestamp);
      return true;
    });
  };

  // Finalizes a reservation with the broadcast transaction hashes (also used
  // by the SendCalls popup through MainController.recordSendCallsBundle).
  const recordSendCallsBundle = (
    host: string,
    id: string,
    input: Omit<ISendCallsBatchDescriptor, 'stoppedTransactionHash'> & {
      previousSubmissionId?: string;
      reservationId: string;
      submissionId?: string;
      submissionNotBroadcast?: boolean;
      submissionStarted?: boolean;
    }
  ): Promise<void> => {
    if (Object.hasOwn(input, 'stoppedTransactionHash'))
      throw new Error('Stopped calls require an authenticated journal record');
    const descriptor = {
      ...input,
      txHashes: [...input.txHashes],
      ...(input.smartAccountIdentity
        ? { smartAccountIdentity: { ...input.smartAccountIdentity } }
        : {}),
    };
    return withStoreLock(async () => {
      const storeData = await readBundleStore();
      const timestamp = now();
      const hostBundles = storeData[host] || {};
      const existing = hostBundles[id];
      if (!existing || existing.reservationId !== descriptor.reservationId)
        throw new Error('sendCalls bundle reservation is unavailable');
      if (existing.chainId !== descriptor.chainId)
        throw new Error('sendCalls bundle network changed');
      if (
        existing.smartAccount !== descriptor.smartAccount ||
        existing.atomic !== descriptor.atomic
      )
        throw new Error('sendCalls bundle context changed');
      if (descriptor.smartAccountIdentity !== undefined) {
        if (!descriptor.submissionStarted || !existing.smartAccount)
          throw new Error('Unexpected smart account calls identity');
        assertSmartAccountCallsIdentity(
          descriptor.smartAccountIdentity,
          existing.chainId
        );
        if (descriptor.smartAccountIdentity.sender !== existing.sender)
          throw new Error('Smart account calls sender changed');
      }
      if (descriptor.submissionStarted) {
        if (existing.smartAccount && !descriptor.smartAccountIdentity)
          throw new Error('Smart account calls identity is required');
        if (
          existing.smartAccountIdentity &&
          JSON.stringify(existing.smartAccountIdentity) !==
            JSON.stringify(descriptor.smartAccountIdentity) &&
          (existing.submissionId === descriptor.submissionId ||
            existing.submissionStarted ||
            existing.txHashes.length > 0)
        )
          throw new Error('Smart account calls identity changed');
        if (!descriptor.submissionId)
          throw new Error('sendCalls submission identity is unavailable');
        if (descriptor.submissionId !== existing.submissionId) {
          if (descriptor.previousSubmissionId !== existing.submissionId)
            throw new Error('sendCalls submission changed');
          hostBundles[id] = {
            ...existing,
            smartAccountIdentity: descriptor.smartAccountIdentity,
            submissionId: descriptor.submissionId,
            submissionStarted: true,
            submissionCompleted: false,
            stoppedTransactionHash: undefined,
          };
        } else
          hostBundles[id] = {
            ...existing,
            smartAccountIdentity: descriptor.smartAccountIdentity,
            submissionStarted: true,
          };
        await evictAndWrite(storeData, host, hostBundles, timestamp);
        return;
      }
      if (descriptor.submissionId !== existing.submissionId)
        throw new Error('sendCalls submission changed');
      if (descriptor.submissionNotBroadcast) {
        if (existing.txHashes.length === 0 && !existing.submissionCompleted)
          hostBundles[id] = {
            ...existing,
            failed: true,
            pending: true,
            submissionStarted: false,
          };
      } else {
        hostBundles[id] = {
          ...descriptor,
          smartAccountIdentity: existing.smartAccountIdentity,
          sender: existing.sender,
          failed:
            existing.submissionCompleted || existing.stoppedTransactionHash
              ? existing.failed
              : descriptor.failed,
          stoppedTransactionHash: existing.stoppedTransactionHash,
          createdAt: existing?.createdAt ?? timestamp,
          pending: false,
          submissionCompleted:
            existing.submissionCompleted ||
            descriptor.submissionCompleted === true,
          submissionStarted: existing?.submissionStarted,
          txHashes: Array.from(
            new Set([...(existing?.txHashes || []), ...descriptor.txHashes])
          ),
        };
      }
      await evictAndWrite(storeData, host, hostBundles, timestamp);
    });
  };

  // Only an unstarted approval can be released. Popup closure/navigation after
  // submission began is ambiguous even when no hash reached the component.
  const releaseSendCallsBundleReservation = (
    host: string,
    id: string,
    reservationId: string
  ): Promise<void> =>
    withStoreLock(async () => {
      const storeData = await readBundleStore();
      const bundle = storeData[host]?.[id];
      if (
        !bundle ||
        bundle.reservationId !== reservationId ||
        (!bundle.pending && !bundle.failed) ||
        bundle.submissionStarted ||
        bundle.txHashes.length > 0
      ) {
        return;
      }
      delete storeData[host]![id];
      await writeBundleStore(storeData);
    });

  /** Bind the current durable EOA attempt before entering the background sender. */
  async function captureStartedEoaSendCallsAttempt(
    { host, id, reservationId }: EoaSendCallsReservation,
    chainId: number,
    submissionId: unknown
  ): Promise<(() => Promise<void>) | undefined> {
    if (typeof submissionId !== 'string' || !submissionId) return;
    const matches = (bundle: IStoredSendCallsBundle | undefined) =>
      bundle?.reservationId === reservationId &&
      bundle.chainId === chainId &&
      bundle.submissionId === submissionId &&
      !bundle.stoppedTransactionHash &&
      !bundle.smartAccount &&
      !bundle.atomic &&
      bundle.submissionStarted === true &&
      bundle.submissionCompleted !== true;
    if (!matches((await readBundleStore())[host]?.[id])) return;
    return () =>
      withStoreLock(async () => {
        const storeData = await readBundleStore();
        const bundle = storeData[host]?.[id];
        if (!bundle || !matches(bundle) || bundle.txHashes.length !== 0) return;
        delete storeData[host]![id];
        await writeBundleStore(storeData);
      });
  }

  const unknownBundleError = () => {
    const error = new Error('Unknown bundle id');
    (error as any).code = 5730;
    return cleanErrorStack(error);
  };

  /** A stopped sequence may resolve its exact retained attempt without resending. */
  const recordStoppedEoaAttempt = (
    host: string,
    id: string,
    reservationId: string,
    submissionId: string,
    input: EoaCallsStopped,
    readSignedTransaction: () => Promise<string | undefined>
  ): Promise<void> => {
    const transaction = snapshotPreparedEvmTransaction(input.transaction);
    const { failed, hash } = input;
    if (
      typeof failed !== 'boolean' ||
      typeof readSignedTransaction !== 'function' ||
      (hash !== undefined && !/^0x[\da-f]{64}$/i.test(hash))
    )
      throw new Error('Invalid stopped calls attempt');
    return withStoreLock(async () => {
      const storeData = await readBundleStore();
      const bundle = storeData[host]?.[id];
      if (
        !bundle ||
        bundle.smartAccount ||
        bundle.atomic ||
        bundle.reservationId !== reservationId ||
        bundle.submissionId !== submissionId ||
        !bundle.submissionStarted ||
        bundle.submissionCompleted ||
        transaction.chainId !== String(bundle.chainId) ||
        transaction.from.toLowerCase() !== bundle.sender?.toLowerCase()
      )
        throw new Error('Stopped calls attempt changed');
      const rawTransaction = await readSignedTransaction();
      check();
      if (!rawTransaction) return;
      const signed = assertSignedEvmTransactionMatches(
        rawTransaction,
        serializePreparedEvmTransaction(transaction),
        transaction.from
      );
      if (!signed.hash)
        throw new Error('Stopped calls signed transaction is unsigned');
      if (hash && signed.hash.toLowerCase() !== hash.toLowerCase())
        throw new Error('Stopped calls signed transaction changed');
      storeData[host]![id] = {
        ...bundle,
        failed,
        stoppedTransactionHash: signed.hash,
        txHashes: Array.from(new Set([...bundle.txHashes, signed.hash])),
      };
      await writeBundleStore(storeData);
    });
  };

  // Resolves an id to its batch descriptor from the per-host registry: only
  // ids this wallet actually issued to the host resolve. Null when unknown.
  const resolveSendCallsBundleDescriptor = (
    host: string,
    id: string
  ): Promise<ISendCallsBatchDescriptor | null> =>
    getStoredSendCallsBundle(host, id);

  // EIP-5792 v2.0.0 wallet_getCallsStatus: resolves a bundle id into the status
  // object by fetching transaction receipts. Receipts are queried on the
  // bundle's own chain (the descriptor carries its chainId), not the active
  // network, so status stays correct after the user switches networks. Throws
  // the spec "Unknown bundle id" error (5730) for ids this wallet did not
  // produce or record, and 5710 when the bundle's chain is no longer
  // configured in the wallet.
  const resolveCallsStatus = async (
    rpc: CallsStatusRpc,
    host: string,
    id: string
  ): Promise<CallsBundleStatus> => {
    if (
      typeof rpc?.assertCurrent !== 'function' ||
      typeof rpc.forChain !== 'function'
    )
      throw new Error('Calls status RPC is unavailable');
    const assertQueryCurrent = rpc.assertCurrent.bind(rpc);
    const forChain = rpc.forChain.bind(rpc);
    const checkQuery = () => {
      check();
      const result: unknown = assertQueryCurrent();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new Error('Calls status owner changed');
      }
      check();
    };
    checkQuery();
    const descriptor = await resolveSendCallsBundleDescriptor(host, id);
    checkQuery();
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
        status:
          descriptor.submissionStarted && !descriptor.submissionCompleted
            ? CALLS_STATUS_PENDING
            : computeCallsStatusCode({
                atomic: descriptor.atomic,
                receiptStatuses: [],
                smartAccount: descriptor.smartAccount,
                someCallsFailedToBroadcast: descriptor.failed,
              }),
      };
    }

    const provider = forChain(descriptor.chainId);
    checkQuery();
    if (!provider) {
      throw cleanErrorStack(
        new EthereumRpcErrorHandler(
          5710,
          `This wallet has no RPC configured for the bundle's chain (chainId ${descriptor.chainId}).`
        )
      );
    }

    const observedReceipts = await Promise.all(
      descriptor.txHashes.map(async (hash) => {
        checkQuery();
        const receipt = await provider
          .getTransactionReceipt(hash)
          .catch(() => null);
        checkQuery();
        try {
          return normalizeDappCallsReceipt(receipt, hash);
        } catch (error) {
          if (descriptor.stoppedTransactionHash) return null;
          throw error;
        }
      })
    );
    checkQuery();
    // Receipt presence alone cannot establish that its block is still canonical.
    // Share each height lookup only within this query so later queries observe reorgs.
    const blockHashes = new Map<string, Promise<string | null>>();
    const receipts = await Promise.all(
      observedReceipts.map(async (receipt) => {
        if (!receipt) return null;
        let blockHash = blockHashes.get(receipt.blockNumber);
        if (!blockHash) {
          blockHash = (async () => {
            checkQuery();
            try {
              const value = await provider.getBlockHash(receipt.blockNumber);
              checkQuery();
              return readEvmRpcHash(value);
            } catch {
              checkQuery();
              return null;
            }
          })();
          blockHashes.set(receipt.blockNumber, blockHash);
        }
        const canonicalHash = await blockHash;
        checkQuery();
        return canonicalHash === receipt.blockHash ? receipt : null;
      })
    );
    checkQuery();
    const receiptStatuses = receipts.map((receipt) =>
      receipt ? (receipt.status === 0 ? '0x0' : '0x1') : null
    ) as Array<'0x0' | '0x1' | null>;

    const smartAccountInnerSuccess = descriptor.smartAccount
      ? getSmartAccountCallsOutcome(
          descriptor.smartAccountIdentity,
          descriptor.chainId,
          receipts
        )
      : undefined;

    const stopped =
      !!descriptor.stoppedTransactionHash &&
      descriptor.txHashes.includes(descriptor.stoppedTransactionHash);
    let canonicalStopped = stopped && receipts.every(Boolean);
    if (canonicalStopped) {
      const current = await getStoredSendCallsBundle(host, id);
      checkQuery();
      canonicalStopped =
        canonicalStopped &&
        !!current &&
        current.stoppedTransactionHash === descriptor.stoppedTransactionHash &&
        current.submissionStarted === descriptor.submissionStarted &&
        current.submissionCompleted === descriptor.submissionCompleted &&
        current.failed === descriptor.failed &&
        current.txHashes.length === descriptor.txHashes.length &&
        current.txHashes.every(
          (hash, index) => hash === descriptor.txHashes[index]
        );
    }

    const status =
      descriptor.submissionStarted &&
      !descriptor.submissionCompleted &&
      !canonicalStopped
        ? CALLS_STATUS_PENDING
        : computeCallsStatusCode({
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
        blockNumber: `0x${BigInt(receipt.blockNumber).toString(16)}`,
        gasUsed:
          typeof receipt.gasUsed?.toHexString === 'function'
            ? receipt.gasUsed.toHexString()
            : `0x${BigInt(receipt.gasUsed ?? 0).toString(16)}`,
        logs: (receipt.logs || []).map((log: any) => ({
          address: log.address,
          data: log.data,
          topics: log.topics,
        })),
        status: receipt.status === 0 ? ('0x0' as const) : ('0x1' as const),
        transactionHash: receipt.hash,
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

  return Object.freeze({
    generateWalletBundleId,
    getStoredSendCallsBundle,
    getStartedEoaCallsAttempt,
    retractUnsentEoaCallsHash,
    reserveSendCallsBundle,
    recordSendCallsBundle,
    releaseSendCallsBundleReservation,
    captureStartedEoaSendCallsAttempt,
    recordStoppedEoaAttempt,
    resolveSendCallsBundleDescriptor,
    resolveCallsStatus,
  });
}

/** Read only a journal entry matching the stopped call's complete reviewed envelope. */
export async function readRetainedEoaCall(
  records: EvmSignedRecords,
  session: EvmSignedRecordSession,
  input: EoaCallsStopped
): Promise<string | undefined> {
  const transaction = snapshotPreparedEvmTransaction(input.transaction);
  const hash = input.hash;
  const expected = serializePreparedEvmTransaction(transaction);
  const entries = await records.listSender(
    session,
    transaction.chainId,
    transaction.from
  );
  const candidates = entries.filter(
    (entry) =>
      entry.operation === 'send' &&
      entry.nonce === Number(transaction.nonce) &&
      (hash === undefined || entry.hash.toLowerCase() === hash.toLowerCase())
  );
  for (const candidate of candidates) {
    const retained = await records.readExact(
      session,
      transaction.chainId,
      transaction.from,
      candidate.hash
    );
    if (!retained) continue;
    try {
      assertSignedEvmTransactionMatches(
        retained.rawTransaction,
        expected,
        transaction.from
      );
      return retained.rawTransaction;
    } catch {
      // A replacement or another reviewed envelope cannot settle this call.
    }
  }
  return undefined;
}

/** Restore a lost process's association; a live consent sequence must never enter here. */
export async function recoverRetainedEoaCallsAttempt(
  records: EvmSignedRecords,
  session: EvmSignedRecordSession,
  registry: ReturnType<typeof createCallsBundleRegistry>,
  origin: string,
  id: string,
  assertStopped: () => void
): Promise<void> {
  if (typeof assertStopped !== 'function')
    throw new Error('Stopped calls authority is required');
  const check = () => {
    assertSynchronousEvmFeeGuard(assertStopped);
    assertSynchronousEvmFeeGuard(session.assertCurrent);
  };
  check();
  const bundle = await registry.getStartedEoaCallsAttempt(origin, id);
  check();
  if (
    !bundle ||
    bundle.atomic ||
    bundle.smartAccount ||
    !bundle.sender ||
    !bundle.submissionStarted ||
    bundle.submissionCompleted ||
    bundle.stoppedTransactionHash
  )
    return;
  const entries = await records.listSender(
    session,
    String(bundle.chainId),
    bundle.sender
  );
  check();
  for (const entry of entries) {
    // Signed phase is also possible after wire entry with no acknowledgement.
    // Association alone proves no delivery; canonical receipts still gate status.
    if (entry.operation !== 'send' || !entry.metadata?.eoaCalls) continue;
    const attempt = snapshotEoaCallsSignedAttempt(entry.metadata.eoaCalls);
    if (
      attempt.origin !== origin ||
      attempt.bundleId !== id ||
      attempt.reservationId !== bundle.reservationId ||
      attempt.submissionId !== bundle.submissionId
    )
      continue;
    const retained = await records.readExact(
      session,
      entry.chainId,
      entry.from,
      entry.hash
    );
    check();
    if (!retained) continue;
    const signed = Transaction.from(retained.rawTransaction);
    if (signed.type !== 0 && signed.type !== 2)
      throw new Error('Invalid signed calls envelope');
    const transaction = snapshotPreparedEvmTransaction({
      from: entry.from,
      to: signed.to,
      chainId: signed.chainId.toString(),
      nonce: String(signed.nonce),
      value: signed.value.toString(),
      data: signed.data,
      gasLimit: signed.gasLimit.toString(),
      ...(signed.type === 0
        ? { type: 0, gasPrice: signed.gasPrice!.toString() }
        : {
            type: 2,
            maxFeePerGas: signed.maxFeePerGas!.toString(),
            maxPriorityFeePerGas: signed.maxPriorityFeePerGas!.toString(),
            accessList: signed.accessList!,
          }),
    });
    await registry.recordStoppedEoaAttempt(
      origin,
      id,
      attempt.reservationId,
      attempt.submissionId,
      { transaction, hash: entry.hash, failed: attempt.failed },
      async () => {
        check();
        return retained.rawTransaction;
      }
    );
    check();
    return;
  }
}
