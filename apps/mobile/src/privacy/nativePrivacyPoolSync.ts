import {
  createPrivacyRpc,
  readPrivacyPoolSnapshot,
  verifyPrivacySnapshotAnchor,
  type PrivacyJsonTransport,
} from '../../../../source/utils/privacy/publicSyncProtocol.ts';
import { getPrivacyPool } from '../../../../source/utils/privacy/registry.ts';
import { validatePrivacyRpcUrl } from '../../../../source/utils/privacy/snapshotValidation.ts';
import type { IPrivacyNoteReader } from '../../../../source/utils/privacy/privateVaultTypes.ts';
import type { IPrivacySnapshotReader } from '../../../../source/utils/privacy/trustedSnapshot.ts';
import type {
  PrivacyPoolId,
  PrivacySnapshot,
  PrivacySyncStatus,
} from '../../../../source/utils/privacy/types.ts';
import {
  createPrivacyPoolSync,
  type PrivacyRecord,
  type PrivacySyncCache,
} from '../../../../source/wallet/privacyPoolSync.ts';
import {
  snapshotNativeNetwork,
  type NativeNetworkRegistration,
} from '../custody/networkContext.ts';
import {
  createNativeHttpFetch,
  type WalletHttpFetch,
} from '../platform/httpPolicy.ts';
import {
  abortable,
  boundedStreamingResponseText,
  cancelResponseBody,
  ResponseSizeLimitError,
} from '../../../../source/shared/boundedHttp.ts';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RUN_BYTES = 4 * 1024 * 1024;
const RUN_TIMEOUT_MS = 45_000;
const BATCH_LEAVES = 8;
const cancelled = () => new Error('privacy_cancelled');
const unavailable = () => new Error('privacy_verification_pending');

/** One in-memory candidate and one shared verified tree. No durable ready flag. */
function createSessionCache(poolId: PrivacyPoolId, assertCurrent: () => void) {
  let record: PrivacyRecord | undefined;
  let candidate: PrivacySnapshot | undefined;
  const owns = (id: PrivacyPoolId, generation: number) =>
    id === poolId && record?.generation === generation && record.running;
  const cache: PrivacySyncCache = {
    async get(id) {
      if (id !== poolId || !record) return;
      const { work } = record;
      return {
        ...record,
        status: { ...record.status },
        work: work && { ...work, frontier: [...work.frontier] },
      };
    },
    async getCandidate(id) {
      return id === poolId ? candidate : undefined;
    },
    async save(next, generation) {
      if (next.poolId !== poolId || (record?.generation ?? 0) !== generation)
        return false;
      const { work } = next;
      record = {
        ...next,
        status: { ...next.status },
        work: work && { ...work, frontier: [...work.frontier] },
      };
      if (!record.running) candidate = undefined;
      return true;
    },
    async saveCandidate(id, generation, next) {
      if (!owns(id, generation)) return false;
      candidate = next;
      return true;
    },
    async commit(id, generation, status) {
      assertCurrent();
      if (!record || !owns(id, generation) || !candidate) return false;
      record = {
        ...record,
        running: false,
        work: undefined,
        status: { ...status },
      };
      candidate = undefined;
      return true;
    },
    async clear(id) {
      if (id !== poolId) throw unavailable();
      const next: PrivacyRecord = {
        poolId,
        generation: (record?.generation ?? 0) + 1,
        running: false,
        status: { poolId, phase: 'idle' },
      };
      record = next;
      candidate = undefined;
      return next;
    },
  };
  return {
    cache,
    running: () => record?.running === true,
    status: (): PrivacySyncStatus =>
      record ? { ...record.status } : { poolId, phase: 'idle' },
  };
}

/**
 * Explicit foreground owner for one registered pool and saved Ethereum endpoint.
 * The host must abort its unique lifetime on route, wallet or network replacement.
 * Native buffering before JS observes a chunk is outside this leaf's byte budget.
 */
export function createNativePrivacyPoolSync(
  options: Readonly<{
    network: NativeNetworkRegistration;
    poolId: PrivacyPoolId;
    lifetime: AbortSignal;
    transport: WalletHttpFetch;
  }>
) {
  const { lifetime, poolId, transport } = options;
  if (typeof transport !== 'function' || lifetime.aborted) throw cancelled();
  const network = snapshotNativeNetwork(options.network);
  if (network.chainId !== '1') throw new Error('privacy_wrong_chain');
  getPrivacyPool(poolId);
  const rpcUrl = validatePrivacyRpcUrl(network.rpcUrl);
  const fetch = createNativeHttpFetch(transport);
  const storage = createSessionCache(poolId, checkRun);
  let closed = false;
  let continuation = false;
  let pending: Promise<PrivacySyncStatus> | undefined;
  let teardown: Promise<void> | undefined;
  const dispatches = new Set<Promise<Response>>();
  let run:
    | { abort: AbortController; deadline: number; bytes: number }
    | undefined;

  function checkOwner() {
    if (closed || lifetime.aborted) throw cancelled();
  }
  function checkRun(expected = run) {
    checkOwner();
    if (
      !expected ||
      run !== expected ||
      expected.abort.signal.aborted ||
      performance.now() >= expected.deadline
    )
      throw cancelled();
    return expected;
  }
  function checkReadable() {
    checkOwner();
    if (run) checkRun(run);
  }
  async function yieldBatch() {
    const active = checkRun();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    checkRun(active);
  }

  const requestJson: PrivacyJsonTransport = async (
    url,
    init,
    responseLimit
  ) => {
    const active = checkRun();
    if (init.signal.aborted) throw cancelled();
    const local = new AbortController();
    const abort = () => local.abort();
    init.signal.addEventListener('abort', abort, { once: true });
    active.abort.signal.addEventListener('abort', abort, { once: true });
    let response: Response | undefined;
    try {
      const fetching = fetch(url, { ...init, signal: local.signal });
      dispatches.add(fetching);
      void fetching
        .then(
          (late) => {
            if (local.signal.aborted) cancelResponseBody(late);
          },
          () => undefined
        )
        .finally(() => {
          dispatches.delete(fetching);
        });
      response = await abortable(fetching, local.signal);
      checkRun(active);
      if (response.redirected || response.url !== url)
        throw new Error('privacy_service_unavailable');
      const limit = Math.min(responseLimit(response), MAX_RESPONSE_BYTES);
      const text = await boundedStreamingResponseText(
        response,
        local.signal,
        limit,
        (bytes) => {
          checkRun(active);
          if (bytes > MAX_RUN_BYTES - active.bytes)
            throw new ResponseSizeLimitError();
          active.bytes += bytes;
        }
      );
      const data: unknown = JSON.parse(text);
      checkRun(active);
      return { data, status: response.status };
    } catch (error) {
      if (error instanceof ResponseSizeLimitError)
        throw new Error('privacy_data_too_large');
      throw error;
    } finally {
      init.signal.removeEventListener('abort', abort);
      active.abort.signal.removeEventListener('abort', abort);
      local.abort();
      if (response) cancelResponseBody(response);
    }
  };

  const rpc = createPrivacyRpc(requestJson);
  let readVerifiedNote!: IPrivacyNoteReader;
  let readVerifiedSnapshot!: IPrivacySnapshotReader;
  const controller = createPrivacyPoolSync(
    () => ({ chainId: 1, isEthereum: true, url: rpcUrl }),
    {
      cache: storage.cache,
      fetchSnapshot: (id, signal) =>
        readPrivacyPoolSnapshot(id, signal, requestJson),
      verifyAnchor: (id, snapshot, url, signal) =>
        verifyPrivacySnapshotAnchor(id, snapshot, url, signal, rpc),
      now: Date.now,
      // Only CPU continuations are driven by the explicit refresh call below.
      // No restart, watchdog, automatic progress polling or periodic refresh.
      schedule: (id, delay) => {
        if (!closed && id === poolId && delay === 0) continuation = true;
      },
      stop: () => {
        continuation = false;
      },
      startRequestTimeout: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
      merkleWork: { batchSize: BATCH_LEAVES, yieldBetweenBatches: yieldBatch },
    },
    (reader) => {
      readVerifiedNote = reader;
    },
    (reader) => {
      readVerifiedSnapshot = reader;
    }
  );

  async function refreshOwned(): Promise<PrivacySyncStatus> {
    checkOwner();
    const active = {
      abort: new AbortController(),
      deadline: performance.now() + RUN_TIMEOUT_MS,
      bytes: 0,
    };
    run = active;
    const timer = setTimeout(() => active.abort.abort(), RUN_TIMEOUT_MS);
    try {
      if (!storage.running()) await controller.start(poolId);
      do {
        checkRun(active);
        continuation = false;
        await controller.resumePending(poolId);
        checkRun(active);
        if (continuation) await yieldBatch();
      } while (continuation);
      return storage.status();
    } catch (error) {
      // Retire interrupted work and revoke leases before a new request can start.
      if (!closed) await controller.clear(poolId);
      throw error;
    } finally {
      clearTimeout(timer);
      active.abort.abort();
      run = undefined;
    }
  }

  function dispose(): Promise<void> {
    if (teardown) return teardown;
    closed = true;
    lifetime.removeEventListener('abort', onAbort);
    // clear() invalidates the shared live snapshot revision synchronously.
    const clearing = controller.clear(poolId);
    teardown = Promise.all([clearing, pending?.catch(() => undefined)]).then(
      () => undefined
    );
    run?.abort.abort();
    return teardown;
  }
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  lifetime.addEventListener('abort', onAbort, { once: true });

  const readNote: IPrivacyNoteReader = async (identity) => {
    checkReadable();
    if (identity.poolId !== poolId) throw unavailable();
    const result = await readVerifiedNote(identity);
    checkReadable();
    return result;
  };
  const readSnapshot: IPrivacySnapshotReader = async (id) => {
    checkReadable();
    if (id !== poolId) throw unavailable();
    const result = await readVerifiedSnapshot(id);
    checkReadable();
    return result;
  };

  return Object.freeze({
    getStatus() {
      checkReadable();
      return storage.status();
    },
    refresh() {
      try {
        checkOwner();
      } catch (error) {
        return Promise.reject(error);
      }
      if (!pending && dispatches.size) return Promise.reject(unavailable());
      pending ??= Promise.resolve()
        .then(refreshOwned)
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
    readNote,
    readSnapshot,
    dispose,
  });
}
