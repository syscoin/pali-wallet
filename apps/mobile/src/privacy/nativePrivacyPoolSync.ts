import { abortable } from '../../../../source/shared/boundedHttp.ts';
import {
  createOwnedSnapshotAnchor,
  type AnchorBinding,
} from '../../../../source/utils/privacy/ownedAnchor.ts';
import {
  privacyRpcResponseLimit,
  readPrivacyJson,
  readPrivacyPoolSnapshot,
  type PrivacyAnchorRead,
  type PrivacyJsonResponse,
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

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RUN_BYTES = 4 * 1024 * 1024;
const MAX_PULL_BYTES = 64 * 1024;
const RUN_TIMEOUT_MS = 45_000;
const BATCH_LEAVES = 128;
const cancelled = () => new Error('privacy_cancelled');
const unavailable = () => new Error('privacy_verification_pending');

function waitForHandle<T>(
  pending: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  // The transport can synchronously abort while returning its pending promise.
  void pending.catch(() => undefined);
  return abortable(pending, signal);
}

type Handle = Readonly<{
  // The host rechecks at the actual native start and around every bridge turn.
  start(
    assertCurrent: () => void
  ): Promise<Readonly<{ status: number; byteCount: number }>>;
  pull(assertCurrent: () => void): Promise<Uint8Array | null>;
  // Cancels and drains this exact handle before acknowledging release.
  release(): Promise<void>;
}>;

/** Both reservation methods share one host slot, including across owners. */
export type OwnedPrivacyPullTransport = Readonly<{
  prepareSnapshot(poolId: PrivacyPoolId, signal: AbortSignal): Handle;
  prepareAnchor(
    binding: AnchorBinding,
    read: PrivacyAnchorRead,
    id: number,
    signal: AbortSignal
  ): Handle;
}>;

type Run = {
  abort: AbortController;
  deadline: number;
  bytes: number;
  anchor?: {
    snapshot: PrivacySnapshot;
    owner: ReturnType<typeof createOwnedSnapshotAnchor>;
  };
};

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
 * The trusted host reserves one native handle without starting I/O.
 */
export function createNativePrivacyPoolSync(
  options: Readonly<{
    network: NativeNetworkRegistration;
    poolId: PrivacyPoolId;
    lifetime: AbortSignal;
    transport: OwnedPrivacyPullTransport;
    /** One owned native operation. It must drain before this promise settles. */
    executeMerkleBatch(
      program: Uint8Array,
      signal: AbortSignal,
      assertCurrent: () => void
    ): Promise<Uint8Array>;
  }>
) {
  const { lifetime, poolId, transport } = options;
  if (
    lifetime.aborted ||
    typeof transport?.prepareSnapshot !== 'function' ||
    typeof transport.prepareAnchor !== 'function' ||
    typeof options.executeMerkleBatch !== 'function'
  )
    throw cancelled();
  const network = snapshotNativeNetwork(options.network);
  if (network.chainId !== '1') throw new Error('privacy_wrong_chain');
  getPrivacyPool(poolId);
  const rpcUrl = validatePrivacyRpcUrl(network.rpcUrl);
  if (!rpcUrl.startsWith('https:')) throw unavailable();
  const prepareSnapshot = transport.prepareSnapshot.bind(transport);
  const prepareAnchor = transport.prepareAnchor.bind(transport);
  const executeMerkleBatch = options.executeMerkleBatch;
  const storage = createSessionCache(poolId, checkRun);
  let closed = false;
  let continuation = false;
  let pending: Promise<PrivacySyncStatus> | undefined;
  let teardown: Promise<void> | undefined;
  let occupied: object | undefined;
  let run: Run | undefined;

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

  function reserve(
    prepare: () => Handle,
    signal: AbortSignal,
    limit: (status: number) => number
  ) {
    const active = checkRun();
    if (occupied || signal.aborted) throw cancelled();
    const slot = {};
    occupied = slot;
    let handle: Handle;
    try {
      handle = prepare();
    } catch (error) {
      occupied = undefined;
      throw error;
    }
    let draining: Promise<void> | undefined;
    let started = false;
    const release = () =>
      (draining ??= Promise.resolve()
        .then(() => handle.release())
        .then(() => {
          if (occupied === slot) occupied = undefined;
        }));
    return {
      release,
      async start(
        assertCurrent: () => void
      ): Promise<
        PrivacyJsonResponse &
          Pick<Response, 'status' | 'ok' | 'url' | 'redirected'>
      > {
        const check = () => {
          assertCurrent();
          checkRun(active);
          if (signal.aborted || draining || occupied !== slot)
            throw cancelled();
        };
        check();
        if (started) throw cancelled();
        started = true;
        const { status, byteCount } = await abortable(
          handle.start(check),
          signal
        );
        check();
        if (!Number.isSafeInteger(byteCount) || byteCount <= 0)
          throw new Error('privacy_data_invalid');
        if (
          byteCount >
          Math.min(
            limit(status),
            MAX_RESPONSE_BYTES,
            MAX_RUN_BYTES - active.bytes
          )
        )
          throw new Error('privacy_data_too_large');
        active.bytes += byteCount;
        let remaining = byteCount;
        let readerTaken = false;
        return {
          status,
          ok: status === 200,
          url: '',
          redirected: false,
          headers: {
            get: (name) =>
              name.toLowerCase() === 'content-length'
                ? String(byteCount)
                : null,
          },
          body: {
            getReader() {
              if (readerTaken) throw cancelled();
              readerTaken = true;
              let stopped = false;
              return {
                async read() {
                  check();
                  if (stopped) return { done: true, value: undefined };
                  const chunk = await waitForHandle(handle.pull(check), signal);
                  check();
                  if (chunk === null) {
                    if (remaining) throw new Error('privacy_data_invalid');
                    stopped = true;
                    return { done: true, value: undefined };
                  }
                  if (
                    !(chunk instanceof Uint8Array) ||
                    !chunk.byteLength ||
                    chunk.byteLength > MAX_PULL_BYTES ||
                    chunk.byteLength > remaining
                  )
                    throw new Error('privacy_data_invalid');
                  remaining -= chunk.byteLength;
                  return { done: false, value: chunk };
                },
                async cancel() {
                  stopped = true;
                },
              };
            },
          },
        };
      },
    };
  }

  async function fetchSnapshot(id: PrivacyPoolId, requestSignal: AbortSignal) {
    const active = checkRun();
    if (id !== poolId || requestSignal.aborted) throw cancelled();
    const local = new AbortController();
    const abort = () => local.abort();
    requestSignal.addEventListener('abort', abort, { once: true });
    active.abort.signal.addEventListener('abort', abort, { once: true });
    try {
      return await readPrivacyPoolSnapshot(
        id,
        local.signal,
        async (_url, _init, responseLimit) => {
          const limit = (status: number) =>
            responseLimit({ status, ok: status === 200 });
          const operation = reserve(
            () => prepareSnapshot(id, local.signal),
            local.signal,
            limit
          );
          try {
            const response = await operation.start(() => checkRun(active));
            const data = await readPrivacyJson(
              response,
              limit(response.status)
            );
            checkRun(active);
            return { data, status: response.status };
          } finally {
            await waitForHandle(operation.release(), local.signal);
          }
        }
      );
    } finally {
      requestSignal.removeEventListener('abort', abort);
      active.abort.signal.removeEventListener('abort', abort);
      local.abort();
    }
  }

  async function verifyAnchor(
    id: PrivacyPoolId,
    snapshot: PrivacySnapshot,
    url: string,
    signal: AbortSignal
  ) {
    const active = checkRun();
    if (
      id !== poolId ||
      url !== rpcUrl ||
      signal.aborted ||
      (active.anchor && active.anchor.snapshot !== snapshot)
    )
      throw cancelled();
    active.anchor ??= {
      snapshot,
      owner: createOwnedSnapshotAnchor(id, snapshot, rpcUrl, {
        timeoutMs: Math.ceil(active.deadline - performance.now()),
        signal: active.abort.signal,
        assertCurrent: () => {
          checkRun(active);
        },
        prepare: (binding, read, requestId, ownerSignal) =>
          reserve(
            () => prepareAnchor(binding, read, requestId, ownerSignal),
            ownerSignal,
            (status) => {
              if (status !== 200) throw new Error('privacy_rpc_unavailable');
              return privacyRpcResponseLimit(read === 'block');
            }
          ),
      }),
    };
    return active.anchor.owner.verify(signal);
  }

  let readVerifiedNote!: IPrivacyNoteReader;
  let readVerifiedSnapshot!: IPrivacySnapshotReader;
  const controller = createPrivacyPoolSync(
    () => ({ chainId: 1, isEthereum: true, url: rpcUrl }),
    {
      cache: storage.cache,
      fetchSnapshot,
      verifyAnchor,
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
      merkleWork: {
        batchSize: BATCH_LEAVES,
        yieldBetweenBatches: yieldBatch,
        async execute(program, signal, assertCurrent) {
          const active = checkRun();
          const check = () => {
            checkRun(active);
            assertCurrent();
            if (signal.aborted) throw cancelled();
          };
          check();
          const output = await executeMerkleBatch(program, signal, check);
          check();
          return output;
        },
      },
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
    const active: Run = {
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
    // clear() invalidates proof leases synchronously. A held physical drain
    // still occupies the host slot even after logical disposal completes.
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
      if (!pending && occupied) return Promise.reject(unavailable());
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
