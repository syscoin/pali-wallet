import { privacyCache, PrivacyCache, PrivacyRecord } from 'utils/privacy/cache';
import {
  fetchPrivacySnapshot,
  validatePrivacyRpcUrl,
  validateSnapshot,
  verifySnapshotAnchor,
} from 'utils/privacy/client';
import {
  advanceMerkleWork,
  createMerkleWork,
  MerkleWork,
} from 'utils/privacy/merkle';
import {
  copyMerklePathIndex,
  createMerklePathIndex,
  getMerklePath,
  MerklePathIndex,
  recordMerkleSubtree,
} from 'utils/privacy/merklePath';
import type { IPrivacyNoteReader } from 'utils/privacy/privateVaultTypes';
import { getPrivacyPool, PRIVACY_POOLS } from 'utils/privacy/registry';
import type { IPrivacySnapshotReader } from 'utils/privacy/trustedSnapshot';
import {
  PrivacyController,
  PrivacyPoolId,
  PrivacySnapshot,
  PrivacySyncStatus,
} from 'utils/privacy/types';

export const PRIVACY_ALARM_PREFIX = 'privacy-pool-sync:';
const REQUEST_TIMEOUT_MS = 25000;
const SLICE_MS = 3000;
const SYNC_INTERVAL_MS = 15 * 60 * 1000;
// Includes the shared 15-minute refresh period, normal Ethereum finality and
// verification time. This is an as-of view, never a claim about later or pending
// withdrawals; completeness still depends on the public withdrawal feed.
export const PRIVACY_NOTE_MAX_BLOCK_AGE_MS = 45 * 60 * 1000;
const MAX_FUTURE_BLOCK_MS = 30000;

interface Dependencies {
  cache?: PrivacyCache;
  fetchSnapshot?: typeof fetchPrivacySnapshot;
  now?: () => number;
  schedule?: (poolId: PrivacyPoolId, delay: number) => void;
  stop?: (poolId: PrivacyPoolId) => void;
  verifyAnchor?: typeof verifySnapshotAnchor;
}

// This controller contains only public data and read-only Ethereum RPCs.
// Neither the index service nor this job ever receives a note or wallet key.
export function createPrivacyController(
  getNetwork: () => { chainId: number; isEthereum: boolean; url: string },
  dependencies: Dependencies = {},
  registerNoteReader?: (reader: IPrivacyNoteReader) => void,
  registerSnapshotReader?: (reader: IPrivacySnapshotReader) => void
): PrivacyController {
  const cache = dependencies.cache || privacyCache;
  const fetchSnapshot = dependencies.fetchSnapshot || fetchPrivacySnapshot;
  const verifyAnchor = dependencies.verifyAnchor || verifySnapshotAnchor;
  const now = dependencies.now || Date.now;
  const tasks = new Map<PrivacyPoolId, Promise<void>>();
  const aborts = new Map<PrivacyPoolId, AbortController>();
  const actions = new Map<PrivacyPoolId, Promise<unknown>>();
  const timers = new Map<PrivacyPoolId, ReturnType<typeof setTimeout>>();
  const calculations = new Map<
    PrivacyPoolId,
    {
      generation: number;
      pathIndex: MerklePathIndex;
      snapshot: PrivacySnapshot;
      work: MerkleWork;
    }
  >();
  const verifiedTrees = new Map<
    PrivacyPoolId,
    {
      blockTimestamp: number;
      generation: number;
      pathIndex: MerklePathIndex;
      snapshot: PrivacySnapshot;
      work: MerkleWork;
    }
  >();
  const snapshotRevisions = new Map<PrivacyPoolId, number>();
  const revision = (poolId: PrivacyPoolId) =>
    snapshotRevisions.get(poolId) || 0;
  const invalidateSnapshot = (poolId: PrivacyPoolId) =>
    snapshotRevisions.set(poolId, revision(poolId) + 1);
  const schedule =
    dependencies.schedule ||
    ((poolId, delay) => {
      // A durable alarm is the fallback if Chrome suspends a short-lived timer.
      chrome.alarms.create(PRIVACY_ALARM_PREFIX + poolId, {
        when: now() + Math.max(delay, 30000),
      });
      const previous = timers.get(poolId);
      if (previous) clearTimeout(previous);
      timers.set(
        poolId,
        setTimeout(() => {
          void resumePending(poolId).catch(() => undefined);
        }, delay)
      );
    });
  const stop =
    dependencies.stop ||
    ((poolId) => {
      const timer = timers.get(poolId);
      if (timer) clearTimeout(timer);
      timers.delete(poolId);
      void chrome.alarms.clear(PRIVACY_ALARM_PREFIX + poolId);
    });

  function serialize<T>(
    poolId: PrivacyPoolId,
    action: () => Promise<T>
  ): Promise<T> {
    getPrivacyPool(poolId);
    const result = (actions.get(poolId) || Promise.resolve())
      .catch(() => undefined)
      .then(action);
    actions.set(poolId, result);
    void result
      .finally(() => {
        if (actions.get(poolId) === result) actions.delete(poolId);
      })
      .catch(() => undefined);
    return result;
  }

  function change<T>(
    poolId: PrivacyPoolId,
    action: () => Promise<T>
  ): Promise<T> {
    getPrivacyPool(poolId);
    invalidateSnapshot(poolId);
    return serialize(poolId, action);
  }

  async function timed<T>(
    poolId: PrivacyPoolId,
    generation: number,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const current = await cache.get(poolId);
    if (current?.generation !== generation || !current.running)
      throw new Error('privacy_cancelled');
    const abort = new AbortController();
    aborts.set(poolId, abort);
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await run(abort.signal);
    } finally {
      clearTimeout(timeout);
      if (aborts.get(poolId) === abort) aborts.delete(poolId);
    }
  }

  const status = (
    record: PrivacyRecord | undefined,
    poolId: PrivacyPoolId
  ): PrivacySyncStatus => record?.status || { poolId, phase: 'idle' };

  // A shared clock boundary is independent of balance views and transactions.
  const nextSyncDelay = () => SYNC_INTERVAL_MS - (now() % SYNC_INTERVAL_MS);

  async function finishScheduling(poolId: PrivacyPoolId, generation: number) {
    const current = await cache.get(poolId);
    if (current?.generation !== generation) return;
    stop(poolId);
    if (current.subscribed) schedule(poolId, nextSyncDelay());
  }

  async function process(poolId: PrivacyPoolId): Promise<void> {
    let record = await serialize(poolId, async () => {
      const current = await cache.get(poolId);
      if (!current?.rpcUrl || (!current.running && !current.subscribed))
        return undefined;
      if (current.running) return current;
      const next = {
        ...current,
        generation: current.generation + 1,
        running: true,
        work: undefined,
        status: {
          ...current.status,
          phase: 'syncing' as const,
          errorCode: undefined,
        },
      };
      return (await cache.save(next, current.generation)) ? next : undefined;
    });
    if (!record) return;
    const generation = record.generation;
    schedule(poolId, 30000);
    try {
      const live = calculations.get(poolId);
      let snapshot =
        live?.generation === generation ? live.snapshot : undefined;
      let pathIndex =
        live?.generation === generation ? live.pathIndex : undefined;
      if (snapshot) record.work = live!.work;
      // Disk checkpoints preserve the download, but are not cryptographic
      // proof of a consumed prefix. Rehash after a worker restart rather than
      // accepting a stored frontier/complete flag as verified input.
      if (!snapshot && record.work) {
        snapshot = await cache.getCandidate(poolId);
        if (snapshot) {
          validateSnapshot(poolId, snapshot);
          await timed(poolId, generation, (signal) =>
            verifyAnchor(poolId, snapshot!, record!.rpcUrl!, signal)
          );
          record.work = createMerkleWork();
          pathIndex = createMerklePathIndex();
          calculations.set(poolId, {
            generation,
            pathIndex,
            snapshot,
            work: record.work,
          });
        }
      }
      if (!snapshot) {
        const result = await timed(poolId, generation, (signal) =>
          fetchSnapshot(poolId, signal)
        );
        if ('phase' in result) {
          record = {
            ...record,
            status: {
              ...record.status,
              phase: 'syncing',
              completed: result.scannedBlock - result.startBlock + 1,
              total: result.targetBlock - result.startBlock + 1,
            },
          };
          if (await cache.save(record, generation)) schedule(poolId, 2000);
          return;
        }
        snapshot = validateSnapshot(poolId, result);
        await timed(poolId, generation, (signal) =>
          verifyAnchor(poolId, snapshot!, record!.rpcUrl!, signal)
        );
        const trusted = verifiedTrees.get(poolId);
        const previous = trusted?.snapshot;
        const reusable =
          trusted &&
          previous &&
          trusted.work.nextIndex === previous.leafCount &&
          previous.leafCount <= snapshot.leafCount &&
          previous.leaves.every((leaf, i) => leaf === snapshot!.leaves[i]);
        record.work = reusable
          ? {
              ...trusted!.work,
              frontier: [...trusted!.work.frontier],
              complete: false,
              root: undefined,
            }
          : createMerkleWork();
        // New append work owns its arrays; a live proof lease must never see
        // its verified subtree cache change underneath a newer verification.
        pathIndex = reusable
          ? copyMerklePathIndex(trusted!.pathIndex)
          : createMerklePathIndex();
        if (!(await cache.saveCandidate(poolId, generation, snapshot))) return;
        record.status = {
          ...record.status,
          phase: 'verifying',
          completed: record.work.nextIndex,
          total: snapshot.leafCount,
        };
        if (!(await cache.save(record, generation))) return;
        calculations.set(poolId, {
          generation,
          pathIndex,
          snapshot,
          work: record.work,
        });
      } else {
        validateSnapshot(poolId, snapshot);
      }
      const deadline = now() + SLICE_MS;
      do {
        record.work = advanceMerkleWork(
          record.work!,
          snapshot.leaves,
          128,
          (level, index, root) =>
            recordMerkleSubtree(pathIndex!, level, index, root)
        );
        record.status = {
          ...record.status,
          phase: 'verifying',
          completed: record.work.nextIndex,
          total: snapshot.leafCount,
        };
        if (!(await cache.save(record, generation))) return;
      } while (!record.work.complete && now() < deadline);
      if (!record.work.complete) {
        schedule(poolId, 0);
        return;
      }
      if (record.work.root !== snapshot.root)
        throw new Error('privacy_verification_failed');
      const anchor = await timed(poolId, generation, (signal) =>
        verifyAnchor(poolId, snapshot!, record!.rpcUrl!, signal)
      );
      const next: PrivacySyncStatus = {
        poolId,
        phase: 'ready',
        blockNumber: snapshot.asOfBlockNumber,
        leafCount: snapshot.leafCount,
        verifiedAt: now(),
      };
      if (await cache.commit(poolId, generation, next)) {
        // Own immutable bytes for every synchronous proof lease. The cache and
        // download objects must not mutate previously verified provenance.
        const ownedSnapshot: PrivacySnapshot = Object.freeze({
          ...snapshot,
          leaves: Object.freeze([...snapshot.leaves]) as unknown as string[],
          withdrawnNullifiers: Object.freeze([
            ...snapshot.withdrawnNullifiers,
          ]) as unknown as string[],
        });
        verifiedTrees.set(poolId, {
          generation,
          pathIndex: pathIndex!,
          snapshot: ownedSnapshot,
          blockTimestamp: anchor.blockTimestamp,
          work: record.work,
        });
        calculations.delete(poolId);
        await finishScheduling(poolId, generation);
      }
    } catch (error) {
      const current = await cache.get(poolId);
      if (current?.generation !== generation || !current.running) return;
      const code =
        error instanceof Error && /^privacy_[a-z_]+$/.test(error.message)
          ? error.message
          : 'privacy_service_unavailable';
      await cache.save(
        {
          ...current,
          running: false,
          status: { ...current.status, phase: 'error', errorCode: code },
        },
        generation
      );
      calculations.delete(poolId);
      await finishScheduling(poolId, generation);
    }
  }

  async function resumePending(poolId: PrivacyPoolId): Promise<void> {
    getPrivacyPool(poolId);
    if (tasks.has(poolId)) return;
    invalidateSnapshot(poolId);
    const task = process(poolId);
    tasks.set(poolId, task);
    try {
      await task;
    } finally {
      if (tasks.get(poolId) === task) tasks.delete(poolId);
    }
  }

  // Alarms may be lost across a full browser restart. Only restore explicitly
  // requested work. This does local reads and scheduling, never network I/O.
  void Promise.all(
    PRIVACY_POOLS.map(async ({ id }) => {
      const record = await cache.get(id);
      if (record?.poolId === id && (record.running || record.subscribed))
        schedule(id, record.running ? 30000 : nextSyncDelay());
    })
  ).catch(() => undefined);

  const isFresh = (
    poolId: PrivacyPoolId,
    trusted: NonNullable<ReturnType<typeof verifiedTrees.get>>,
    record: PrivacyRecord | undefined
  ) => {
    const age = now() - trusted.blockTimestamp;
    return (
      verifiedTrees.get(poolId) === trusted &&
      !!record &&
      record.poolId === poolId &&
      record.status.phase !== 'idle' &&
      record.status.phase !== 'error' &&
      record.status.blockNumber === trusted.snapshot.asOfBlockNumber &&
      Number.isSafeInteger(trusted.blockTimestamp) &&
      trusted.blockTimestamp > 0 &&
      Number.isFinite(age) &&
      age >= -MAX_FUTURE_BLOCK_MS &&
      age <= PRIVACY_NOTE_MAX_BLOCK_AGE_MS
    );
  };

  // A lease authenticates this controller's live verified entry, not future
  // arbitrary IndexedDB writes. All managed lifecycle transitions revoke it
  // synchronously; the initial cache read must match its verified generation.
  registerSnapshotReader?.((poolId) => {
    getPrivacyPool(poolId);
    const capturedRevision = revision(poolId);
    return serialize(poolId, async () => {
      const trusted = verifiedTrees.get(poolId);
      let record: PrivacyRecord | undefined;
      try {
        record = await cache.get(poolId);
      } catch {
        throw new Error('privacy_verification_pending');
      }
      const assertSnapshotCurrent = (snapshot: PrivacySnapshot) => {
        if (
          !trusted ||
          snapshot !== trusted.snapshot ||
          revision(poolId) !== capturedRevision ||
          tasks.has(poolId) ||
          !isFresh(poolId, trusted, record) ||
          record!.running ||
          record!.status.phase !== 'ready' ||
          record!.generation !== trusted.generation ||
          record!.status.leafCount !== trusted.snapshot.leafCount
        )
          throw new Error('privacy_verification_pending');
      };
      if (!trusted) throw new Error('privacy_verification_pending');
      assertSnapshotCurrent(trusted.snapshot);
      return {
        snapshot: trusted.snapshot,
        assertSnapshotCurrent,
        getPath: async (leafIndex) => {
          const assertCurrent = () => assertSnapshotCurrent(trusted.snapshot);
          assertCurrent();
          const path = await getMerklePath(
            trusted.pathIndex,
            trusted.snapshot.leaves,
            leafIndex,
            trusted.work,
            { assertCurrent }
          );
          assertCurrent();
          return path;
        },
      };
    });
  });

  // Keep note-specific reads in this background closure. The message-facing
  // controller exposes only public sync operations, and reading a note neither
  // fetches data nor wakes a sync job. Disk ready flags are not proof: after a
  // worker restart this map is empty until this worker verifies the snapshot.
  registerNoteReader?.((identity) => {
    const { poolId, commitment, nullifierHash } = identity;
    return serialize(poolId, async () => {
      const trusted = verifiedTrees.get(poolId);
      if (!trusted) return { phase: 'waiting' };
      let record: PrivacyRecord | undefined;
      try {
        record = await cache.get(poolId);
      } catch {
        return { phase: 'waiting' };
      }
      if (!isFresh(poolId, trusted, record)) return { phase: 'waiting' };
      const blockNumber = trusted.snapshot.asOfBlockNumber;
      if (!trusted.snapshot.leaves.includes(commitment))
        return { phase: record.running ? 'waiting' : 'not-found', blockNumber };
      return {
        phase: trusted.snapshot.withdrawnNullifiers.includes(nullifierHash)
          ? 'spent'
          : 'verified',
        blockNumber,
      };
    });
  });

  return {
    resumePending,
    getStatus: async (poolId) => {
      getPrivacyPool(poolId);
      const record = await cache.get(poolId);
      // Reading an idle status performs no remote requests. Only a previously
      // opted-in, durable job can resume after a service-worker restart.
      if (record?.running) void resumePending(poolId).catch(() => undefined);
      return status(record, poolId);
    },
    start: (poolId) =>
      change(poolId, async () => {
        const record = await cache.get(poolId);
        if (record?.running) {
          void resumePending(poolId).catch(() => undefined);
          return record.status;
        }
        const network = getNetwork();
        if (!network.isEthereum || network.chainId !== 1)
          throw new Error('privacy_wrong_chain');
        const rpcUrl = validatePrivacyRpcUrl(network.url);
        const generation = record?.generation || 0;
        const next: PrivacyRecord = {
          ...record,
          poolId,
          generation: generation + 1,
          rpcUrl,
          running: true,
          subscribed: true,
          work: record?.status.phase === 'paused' ? record.work : undefined,
          status: {
            ...status(record, poolId),
            errorCode: undefined,
            poolId,
            phase: 'syncing',
          },
        };
        if (!(await cache.save(next, generation)))
          return status(await cache.get(poolId), poolId);
        schedule(poolId, 0);
        return next.status;
      }),
    pause: (poolId) =>
      change(poolId, async () => {
        const record = await cache.get(poolId);
        if (!record || (!record.running && !record.subscribed))
          return status(record, poolId);
        const next = {
          ...record,
          generation: record.generation + 1,
          running: false,
          subscribed: false,
          status: { ...record.status, phase: 'paused' as const },
        };
        if (!(await cache.save(next, record.generation)))
          return status(await cache.get(poolId), poolId);
        aborts.get(poolId)?.abort();
        stop(poolId);
        return next.status;
      }),
    clear: (poolId) =>
      change(poolId, async () => {
        const record = await cache.clear(poolId);
        calculations.delete(poolId);
        verifiedTrees.delete(poolId);
        aborts.get(poolId)?.abort();
        stop(poolId);
        return record.status;
      }),
  };
}
