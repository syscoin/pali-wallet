import { PrivacyCache, PrivacyRecord } from 'utils/privacy/cache';
import { advanceMerkleWork, createMerkleWork } from 'utils/privacy/merkle';
import type { IPrivacyNoteReader } from 'utils/privacy/privateVaultTypes';
import { getPrivacyPool } from 'utils/privacy/registry';
import type { IPrivacySnapshotReader } from 'utils/privacy/trustedSnapshot';
import { PrivacyPoolId, PrivacySnapshot } from 'utils/privacy/types';

import {
  createPrivacyController,
  PRIVACY_NOTE_MAX_BLOCK_AGE_MS,
} from './privacy';

const id: PrivacyPoolId = 'eth-0.1';
const copy = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const leaf = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;

function snapshot(leaves = [leaf(1), leaf(2)]): PrivacySnapshot {
  const work = advanceMerkleWork(createMerkleWork(), leaves);
  return {
    withdrawnNullifiers: [],
    version: 1,
    chainId: 1,
    poolAddress: getPrivacyPool(id).address,
    asOfBlockNumber: 20000000,
    asOfBlockHash: leaf(99),
    leafCount: leaves.length,
    leaves,
    root: work.root!,
  };
}

function memoryCache() {
  let record: PrivacyRecord | undefined;
  let candidate: PrivacySnapshot | undefined;
  let verified: PrivacySnapshot | undefined;
  const cache: PrivacyCache = {
    get: async () => copy(record),
    getCandidate: async () => copy(candidate),
    getVerified: async () => copy(verified),
    save: async (next, expected) => {
      if ((record?.generation || 0) !== expected) return false;
      record = copy(next);
      return true;
    },
    saveCandidate: async (_pool, generation, next) => {
      if (record?.generation !== generation || !record.running) return false;
      candidate = copy(next);
      return true;
    },
    commit: async (_pool, generation, status) => {
      if (record?.generation !== generation || !record.running || !candidate)
        return false;
      verified = candidate;
      candidate = undefined;
      record = {
        ...record,
        running: false,
        work: undefined,
        status: copy(status),
      };
      return true;
    },
    clear: async (poolId) => {
      candidate = verified = undefined;
      record = {
        poolId,
        generation: (record?.generation || 0) + 1,
        running: false,
        subscribed: false,
        status: { phase: 'idle', poolId },
      };
      return copy(record);
    },
  };
  return {
    cache,
    get record() {
      return record;
    },
    get verified() {
      return verified;
    },
    setRecord(next: PrivacyRecord) {
      record = next;
    },
  };
}

function setup(overrides: any = {}) {
  const storage = memoryCache();
  const fetchSnapshot = jest.fn(async () => snapshot());
  const verifyAnchor = jest.fn(async () => ({
    blockTimestamp: Math.max(1, (overrides.now || Date.now)() - 12 * 60 * 1000),
  }));
  let readNote!: IPrivacyNoteReader;
  let readSnapshot!: IPrivacySnapshotReader;
  const schedule = jest.fn();
  const stop = jest.fn();
  const getNetwork = jest.fn(() => ({
    chainId: 1,
    isEthereum: true,
    url: 'https://ethereum.example/rpc',
  }));
  const controller = createPrivacyController(
    getNetwork,
    {
      cache: storage.cache,
      fetchSnapshot,
      verifyAnchor,
      schedule,
      stop,
      ...overrides,
    },
    (reader) => {
      readNote = reader;
    },
    (reader) => {
      readSnapshot = reader;
    }
  );
  return {
    storage,
    controller,
    fetchSnapshot,
    verifyAnchor,
    schedule,
    stop,
    getNetwork,
    readNote,
    readSnapshot,
  };
}

test('opening the page reads local state without network or background scheduling', async () => {
  const run = setup();
  expect(await run.controller.getStatus(id)).toEqual({
    poolId: id,
    phase: 'idle',
  });
  expect(run.fetchSnapshot).not.toHaveBeenCalled();
  expect(run.verifyAnchor).not.toHaveBeenCalled();
  expect(run.schedule).not.toHaveBeenCalled();
});

test('explicit start durably records intent before scheduling and verifies before publishing', async () => {
  const run = setup();
  expect((await run.controller.start(id)).phase).toBe('syncing');
  expect(run.storage.record?.running).toBe(true);
  expect(run.fetchSnapshot).not.toHaveBeenCalled();
  await run.controller.resumePending(id);
  expect((await run.controller.getStatus(id)).phase).toBe('ready');
  expect(run.storage.verified?.root).toBe(snapshot().root);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(2);
});

test('duplicate requests share one in-flight download', async () => {
  const pending = deferred<PrivacySnapshot>();
  const fetchSnapshot = jest.fn(() => pending.promise);
  const run = setup({ fetchSnapshot });
  await run.controller.start(id);
  const first = run.controller.resumePending(id);
  await Promise.resolve();
  const second = run.controller.resumePending(id);
  await run.controller.start(id);
  pending.resolve(snapshot());
  await Promise.all([first, second]);
  expect(fetchSnapshot).toHaveBeenCalledTimes(1);
});

test('altered leaf data with an honest on-chain root cannot become verified', async () => {
  const honest = snapshot();
  const altered = { ...honest, leaves: [leaf(3), honest.leaves[1]] };
  const run = setup({ fetchSnapshot: async () => altered });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const state = await run.controller.getStatus(id);
  expect(state.phase).toBe('error');
  expect(state.errorCode).toBe('privacy_verification_failed');
  expect(run.storage.verified).toBeUndefined();
});

test('anchor failure leaves a previously verified cache intact', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const verified = copy(run.storage.verified);
  run.verifyAnchor.mockRejectedValueOnce(new Error('privacy_anchor_changed'));
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const state = await run.controller.getStatus(id);
  expect(state).toMatchObject({
    phase: 'error',
    errorCode: 'privacy_anchor_changed',
    leafCount: verified?.leafCount,
  });
  expect(state.verifiedAt).toEqual(expect.any(Number));
  expect(run.storage.verified).toEqual(verified);
});

test.each(['clear', 'pause'] as const)(
  '%s wins over a late network completion',
  async (action) => {
    const pending = deferred<PrivacySnapshot>();
    const started = deferred<void>();
    const run = setup({
      fetchSnapshot: () => {
        started.resolve();
        return pending.promise;
      },
    });
    await run.controller.start(id);
    const active = run.controller.resumePending(id);
    await started.promise;
    await run.controller[action](id);
    pending.resolve(snapshot());
    await active;
    expect((await run.controller.getStatus(id)).phase).toBe(
      action === 'clear' ? 'idle' : 'paused'
    );
    expect(run.storage.verified).toBeUndefined();
    expect(run.verifyAnchor).not.toHaveBeenCalled();
  }
);

test('a worker restart rehashes candidate leaves instead of trusting stored complete work', async () => {
  const run = setup();
  await run.controller.start(id);
  const honest = snapshot();
  await run.storage.cache.saveCandidate(id, 1, {
    ...honest,
    leaves: [leaf(55), honest.leaves[1]],
  });
  run.storage.setRecord({
    ...run.storage.record!,
    work: advanceMerkleWork(createMerkleWork(), honest.leaves),
  });
  const restarted = createPrivacyController(run.getNetwork, {
    cache: run.storage.cache,
    fetchSnapshot: run.fetchSnapshot,
    verifyAnchor: run.verifyAnchor,
    schedule: run.schedule,
    stop: run.stop,
  });
  await restarted.resumePending(id);
  expect(run.fetchSnapshot).not.toHaveBeenCalled();
  expect((await restarted.getStatus(id)).phase).toBe('error');
  expect(run.storage.verified).toBeUndefined();
});

test('a syncing server response stays progress, never a verified empty pool', async () => {
  const run = setup({
    fetchSnapshot: async () => ({
      phase: 'syncing',
      scannedBlock: 9117000,
      startBlock: 9116966,
      targetBlock: 20000000,
    }),
  });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  expect((await run.controller.getStatus(id)).phase).toBe('syncing');
  expect(run.verifyAnchor).not.toHaveBeenCalled();
  expect(run.storage.verified).toBeUndefined();
});

test.each([
  { chainId: 1, isEthereum: false },
  { chainId: 57, isEthereum: true },
])('unsupported context does not start sync: %j', async (network) => {
  const run = setup();
  run.getNetwork.mockReturnValue({
    ...network,
    url: 'https://ethereum.example',
  });
  await expect(run.controller.start(id)).rejects.toThrow('privacy_wrong_chain');
  expect(run.storage.record).toBeUndefined();
  expect(run.fetchSnapshot).not.toHaveBeenCalled();
});

test('ready pools refresh at a shared clock boundary, not when a balance is read', async () => {
  const run = setup({ now: () => 1000 });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  expect(run.storage.record?.subscribed).toBe(true);
  expect(run.schedule).toHaveBeenLastCalledWith(id, 899000);
  const reads = run.fetchSnapshot.mock.calls.length;
  await run.controller.getStatus(id);
  await run.controller.getStatus(id);
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(reads);
  await run.controller.resumePending(id); // the scheduled alarm
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(reads + 1);
  expect((await run.controller.getStatus(id)).phase).toBe('ready');
});

test('pausing ready data disables future updates and preserves the verified cache', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const verified = copy(run.storage.verified);
  const paused = await run.controller.pause(id);
  expect(paused).toMatchObject({ phase: 'paused', leafCount: 2 });
  expect(run.storage.record?.subscribed).toBe(false);
  const reads = run.fetchSnapshot.mock.calls.length;
  await run.controller.resumePending(id);
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(reads);
  expect(run.storage.verified).toEqual(verified);
  await run.controller.clear(id);
  await run.controller.resumePending(id);
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(reads);
  expect(run.storage.verified).toBeUndefined();
});

test('worker restart restores an opted-in alarm without performing a network request', async () => {
  const run = setup({ now: () => 1000 });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const schedule = jest.fn();
  const fetchSnapshot = jest.fn();
  createPrivacyController(run.getNetwork, {
    cache: run.storage.cache,
    schedule,
    fetchSnapshot,
    now: () => 1000,
    stop: jest.fn(),
  });
  await Promise.resolve();
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(schedule).toHaveBeenCalledWith(id, 899000);
  expect(fetchSnapshot).not.toHaveBeenCalled();
});

test('pause wins when it overlaps the scheduled ready-to-running transition', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const transitionRead = deferred<void>();
  const releaseTransition = deferred<void>();
  const releasePause = deferred<void>();
  const get = run.storage.cache.get;
  const save = run.storage.cache.save;
  let first = true;
  run.storage.cache.get = async (pool) => {
    const value = await get(pool);
    if (first) {
      first = false;
      transitionRead.resolve();
      await releaseTransition.promise;
    }
    return value;
  };
  run.storage.cache.save = async (record, generation) => {
    if (record.status.phase === 'paused') await releasePause.promise;
    return save(record, generation);
  };
  const periodic = run.controller.resumePending(id);
  await transitionRead.promise;
  const pausing = run.controller.pause(id);
  await Promise.resolve();
  releaseTransition.resolve();
  await periodic;
  releasePause.resolve();
  await pausing;
  expect(run.storage.record).toMatchObject({
    running: false,
    subscribed: false,
    status: { phase: 'paused' },
  });
  expect(run.storage.verified).toBeDefined();
  const reads = run.fetchSnapshot.mock.calls.length;
  await run.controller.resumePending(id);
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(reads);
});

const noteIdentity = (commitment = leaf(1), nullifierHash = leaf(88)) => ({
  poolId: id,
  commitment,
  nullifierHash,
});

test('note inspection stays background-only and performs zero network work', async () => {
  const run = setup();
  expect(Object.keys(run.controller).sort()).toEqual([
    'clear',
    'getStatus',
    'pause',
    'resumePending',
    'start',
  ]);
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
  expect(run.fetchSnapshot).not.toHaveBeenCalled();
  expect(run.verifyAnchor).not.toHaveBeenCalled();
  expect(run.schedule).not.toHaveBeenCalled();
});

test('only locally verified deposits and bulk withdrawals classify notes at their block', async () => {
  const data = { ...snapshot(), withdrawnNullifiers: [leaf(88)] };
  const run = setup({ fetchSnapshot: jest.fn(async () => data) });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const fetches = run.fetchSnapshot.mock.calls.length;
  const checks = run.verifyAnchor.mock.calls.length;
  expect(await run.readNote(noteIdentity())).toEqual({
    phase: 'spent',
    blockNumber: data.asOfBlockNumber,
  });
  expect(await run.readNote(noteIdentity(leaf(2), leaf(89)))).toEqual({
    phase: 'verified',
    blockNumber: data.asOfBlockNumber,
  });
  expect(await run.readNote(noteIdentity(leaf(3)))).toEqual({
    phase: 'not-found',
    blockNumber: data.asOfBlockNumber,
  });
  expect(await run.readNote({ ...noteIdentity(), poolId: 'eth-1' })).toEqual({
    phase: 'waiting',
  });
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(fetches);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(checks);
});

test('a stored ready flag and a worker restart cannot manufacture verified provenance', async () => {
  const run = setup();
  run.storage.setRecord({
    poolId: id,
    generation: 1,
    running: false,
    status: {
      poolId: id,
      phase: 'ready',
      blockNumber: 20000000,
      verifiedAt: Date.now(),
    },
  });
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  expect((await run.readNote(noteIdentity())).phase).toBe('verified');
  let restoredRead!: IPrivacyNoteReader;
  createPrivacyController(
    run.getNetwork,
    {
      cache: run.storage.cache,
      fetchSnapshot: run.fetchSnapshot,
      verifyAnchor: run.verifyAnchor,
      schedule: run.schedule,
      stop: run.stop,
    },
    (reader) => {
      restoredRead = reader;
    }
  );
  const fetches = run.fetchSnapshot.mock.calls.length;
  const checks = run.verifyAnchor.mock.calls.length;
  expect(await restoredRead(noteIdentity())).toEqual({ phase: 'waiting' });
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(fetches);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(checks);
});

test('fresh download time cannot make an old block fresh for note admission', async () => {
  const current = 2000000000000;
  const run = setup({
    now: () => current,
    verifyAnchor: jest.fn(async () => ({
      blockTimestamp: current - PRIVACY_NOTE_MAX_BLOCK_AGE_MS - 1,
    })),
  });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  expect(run.storage.record?.status.verifiedAt).toBe(current);
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
});

test.each([
  [-PRIVACY_NOTE_MAX_BLOCK_AGE_MS, 'verified'],
  [-PRIVACY_NOTE_MAX_BLOCK_AGE_MS - 1, 'waiting'],
  [30000, 'verified'],
  [30001, 'waiting'],
  [NaN, 'waiting'],
  [Infinity, 'waiting'],
] as const)('note block-age boundary %s gives %s', async (offset, phase) => {
  const current = 2000000000000;
  const run = setup({
    now: () => current,
    verifyAnchor: jest.fn(async () => ({
      blockTimestamp: current + offset,
    })),
  });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  expect((await run.readNote(noteIdentity())).phase).toBe(phase);
});

test('Pause retains a fresh as-of result until expiry; Clear removes its trust', async () => {
  let current = 2000000000000;
  const run = setup({ now: () => current });
  await run.controller.start(id);
  await run.controller.resumePending(id);
  await run.controller.pause(id);
  const calls = run.fetchSnapshot.mock.calls.length;
  expect(await run.readNote(noteIdentity())).toEqual({
    phase: 'verified',
    blockNumber: 20000000,
  });
  current += PRIVACY_NOTE_MAX_BLOCK_AGE_MS;
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(calls);
  await run.controller.clear(id);
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
});

test('an unfinished newer snapshot cannot classify its new note before verification', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const download = deferred<PrivacySnapshot>();
  const started = deferred<void>();
  run.fetchSnapshot.mockImplementationOnce(() => {
    started.resolve();
    return download.promise;
  });
  await run.controller.start(id);
  const syncing = run.controller.resumePending(id);
  await started.promise;
  expect(await run.readNote(noteIdentity(leaf(3)))).toEqual({
    phase: 'waiting',
    blockNumber: 20000000,
  });
  expect(await run.readNote(noteIdentity())).toEqual({
    phase: 'verified',
    blockNumber: 20000000,
  });
  download.resolve({
    ...snapshot([leaf(1), leaf(2), leaf(3)]),
    asOfBlockNumber: 20000001,
  });
  await syncing;
  expect(await run.readNote(noteIdentity(leaf(3)))).toEqual({
    phase: 'verified',
    blockNumber: 20000001,
  });
});

test('Clear wins over late final verification before a note can become usable', async () => {
  const run = setup();
  const completion = deferred<{ blockTimestamp: number }>();
  const reached = deferred<void>();
  run.verifyAnchor.mockImplementationOnce(async () => ({
    blockTimestamp: Date.now(),
  }));
  run.verifyAnchor.mockImplementationOnce(() => {
    reached.resolve();
    return completion.promise;
  });
  await run.controller.start(id);
  const syncing = run.controller.resumePending(id);
  await reached.promise;
  await run.controller.clear(id);
  completion.resolve({ blockTimestamp: Date.now() });
  await syncing;
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
});

test('a failed newer anchor leaves public cache but defers private note admission', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const old = copy(run.storage.verified);
  run.verifyAnchor.mockRejectedValueOnce(new Error('privacy_anchor_changed'));
  await run.controller.start(id);
  await run.controller.resumePending(id);
  expect(run.storage.verified).toEqual(old);
  const fetches = run.fetchSnapshot.mock.calls.length;
  const checks = run.verifyAnchor.mock.calls.length;
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(fetches);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(checks);
});

test('unavailable public cache defers note status without network recovery', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  run.storage.cache.get = jest.fn(async () => {
    throw new Error('storage unavailable');
  });
  const fetches = run.fetchSnapshot.mock.calls.length;
  const checks = run.verifyAnchor.mock.calls.length;
  expect(await run.readNote(noteIdentity())).toEqual({ phase: 'waiting' });
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(fetches);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(checks);
});

test('internal snapshot reader grants only immutable live verified data without network', async () => {
  const downloaded = snapshot();
  const run = setup({ fetchSnapshot: jest.fn(async () => downloaded) });
  await expect(run.readSnapshot(id)).rejects.toThrow(
    'privacy_verification_pending'
  );
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const fetches = run.fetchSnapshot.mock.calls.length;
  const checks = run.verifyAnchor.mock.calls.length;
  const schedules = run.schedule.mock.calls.length;
  const access = await run.readSnapshot(id);
  expect(access.snapshot).toEqual(downloaded);
  expect(access.snapshot).not.toBe(downloaded);
  expect(Object.isFrozen(access.snapshot)).toBe(true);
  expect(Object.isFrozen(access.snapshot.leaves)).toBe(true);
  expect(Object.isFrozen(access.snapshot.withdrawnNullifiers)).toBe(true);
  expect(() => access.assertSnapshotCurrent(access.snapshot)).not.toThrow();
  expect(() => access.assertSnapshotCurrent(copy(access.snapshot))).toThrow(
    'privacy_verification_pending'
  );
  downloaded.leaves[0] = leaf(77);
  downloaded.withdrawnNullifiers.push(leaf(88));
  expect(access.snapshot.leaves[0]).toBe(leaf(1));
  expect(access.snapshot.withdrawnNullifiers).toEqual([]);
  expect(() => access.assertSnapshotCurrent(access.snapshot)).not.toThrow();
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(fetches);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(checks);
  expect(run.schedule).toHaveBeenCalledTimes(schedules);
});

test('a stored ready snapshot does not grant trust after controller restart', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  let restoredReader!: IPrivacySnapshotReader;
  createPrivacyController(
    run.getNetwork,
    {
      cache: run.storage.cache,
      fetchSnapshot: run.fetchSnapshot,
      verifyAnchor: run.verifyAnchor,
      schedule: run.schedule,
      stop: run.stop,
    },
    undefined,
    (reader) => {
      restoredReader = reader;
    }
  );
  const fetches = run.fetchSnapshot.mock.calls.length;
  const checks = run.verifyAnchor.mock.calls.length;
  await expect(restoredReader(id)).rejects.toThrow(
    'privacy_verification_pending'
  );
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(fetches);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(checks);
});

test.each(['pause', 'clear'] as const)(
  '%s immediately revokes captured snapshot before its storage operation completes',
  async (action) => {
    const run = setup();
    await run.controller.start(id);
    await run.controller.resumePending(id);
    const access = await run.readSnapshot(id);
    const changed = run.controller[action](id);
    expect(() => access.assertSnapshotCurrent(access.snapshot)).toThrow(
      'privacy_verification_pending'
    );
    await changed;
    await expect(run.readSnapshot(id)).rejects.toThrow(
      'privacy_verification_pending'
    );
  }
);

test('requested refresh revokes the old snapshot while preserving as-of note reads', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const previous = await run.readSnapshot(id);
  const starting = run.controller.start(id);
  expect(() => previous.assertSnapshotCurrent(previous.snapshot)).toThrow(
    'privacy_verification_pending'
  );
  await starting;
  const download = deferred<PrivacySnapshot>();
  const started = deferred<void>();
  run.fetchSnapshot.mockImplementationOnce(() => {
    started.resolve();
    return download.promise;
  });
  const syncing = run.controller.resumePending(id);
  await started.promise;
  await expect(run.readSnapshot(id)).rejects.toThrow(
    'privacy_verification_pending'
  );
  expect((await run.readNote(noteIdentity())).phase).toBe('verified');
  download.resolve({
    ...snapshot([leaf(1), leaf(2), leaf(3)]),
    asOfBlockNumber: 20000001,
  });
  await syncing;
  const current = await run.readSnapshot(id);
  expect(current.snapshot.leafCount).toBe(3);
  expect(() => current.assertSnapshotCurrent(current.snapshot)).not.toThrow();
  expect(() => previous.assertSnapshotCurrent(previous.snapshot)).toThrow(
    'privacy_verification_pending'
  );
});

test('periodic refresh immediately revokes an old snapshot and replaces same-height fork data', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const previous = await run.readSnapshot(id);
  const replacement = { ...snapshot([leaf(3)]), asOfBlockHash: leaf(101) };
  run.fetchSnapshot.mockResolvedValueOnce(replacement);
  const refreshing = run.controller.resumePending(id);
  expect(() => previous.assertSnapshotCurrent(previous.snapshot)).toThrow(
    'privacy_verification_pending'
  );
  await refreshing;
  const current = await run.readSnapshot(id);
  expect(current.snapshot).toEqual(replacement);
  expect(current.snapshot.asOfBlockNumber).toBe(
    previous.snapshot.asOfBlockNumber
  );
  expect(() => current.assertSnapshotCurrent(current.snapshot)).not.toThrow();
  expect(() => previous.assertSnapshotCurrent(previous.snapshot)).toThrow(
    'privacy_verification_pending'
  );
});

test('a snapshot read queued before Pause cannot acquire a lease after Pause is requested', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  const read = run.readSnapshot(id);
  const assertion = expect(read).rejects.toThrow(
    'privacy_verification_pending'
  );
  const paused = run.controller.pause(id);
  await assertion;
  await paused;
});

test.each([
  [0, true],
  [PRIVACY_NOTE_MAX_BLOCK_AGE_MS, true],
  [PRIVACY_NOTE_MAX_BLOCK_AGE_MS + 1, false],
  [-30000, true],
  [-30001, false],
  [NaN, false],
  [Infinity, false],
] as const)(
  'snapshot lease rechecks clock age %s synchronously',
  async (age, valid) => {
    const blockTimestamp = 2000000000000;
    let current = blockTimestamp;
    const run = setup({
      now: () => current,
      verifyAnchor: jest.fn(async () => ({ blockTimestamp })),
    });
    await run.controller.start(id);
    await run.controller.resumePending(id);
    const access = await run.readSnapshot(id);
    current = blockTimestamp + age;
    if (valid) {
      expect(() => access.assertSnapshotCurrent(access.snapshot)).not.toThrow();
    } else {
      expect(() => access.assertSnapshotCurrent(access.snapshot)).toThrow(
        'privacy_verification_pending'
      );
      await expect(run.readSnapshot(id)).rejects.toThrow(
        'privacy_verification_pending'
      );
    }
  }
);

test.each([
  'generation',
  'leafCount',
  'blockNumber',
  'phase',
  'running',
] as const)(
  'snapshot capture rejects mismatched persisted %s',
  async (field) => {
    const run = setup();
    await run.controller.start(id);
    await run.controller.resumePending(id);
    const record = copy(run.storage.record!);
    if (field === 'generation') record.generation++;
    if (field === 'leafCount') record.status.leafCount!++;
    if (field === 'blockNumber') record.status.blockNumber!++;
    if (field === 'phase') record.status.phase = 'paused';
    if (field === 'running') record.running = true;
    run.storage.setRecord(record);
    await expect(run.readSnapshot(id)).rejects.toThrow(
      'privacy_verification_pending'
    );
  }
);

test('a snapshot cache failure is sanitized and does not start recovery network activity', async () => {
  const run = setup();
  await run.controller.start(id);
  await run.controller.resumePending(id);
  run.storage.cache.get = jest.fn(async () => {
    throw new Error('storage implementation detail');
  });
  const fetches = run.fetchSnapshot.mock.calls.length;
  const checks = run.verifyAnchor.mock.calls.length;
  await expect(run.readSnapshot(id)).rejects.toThrow(
    'privacy_verification_pending'
  );
  expect(run.fetchSnapshot).toHaveBeenCalledTimes(fetches);
  expect(run.verifyAnchor).toHaveBeenCalledTimes(checks);
});
