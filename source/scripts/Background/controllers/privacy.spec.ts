import { PrivacyCache, PrivacyRecord } from 'utils/privacy/cache';
import { advanceMerkleWork, createMerkleWork } from 'utils/privacy/merkle';
import { getPrivacyPool } from 'utils/privacy/registry';
import { PrivacyPoolId, PrivacySnapshot } from 'utils/privacy/types';

import { createPrivacyController } from './privacy';

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
  const verifyAnchor = jest.fn(async () => undefined);
  const schedule = jest.fn();
  const stop = jest.fn();
  const getNetwork = jest.fn(() => ({
    chainId: 1,
    isEthereum: true,
    url: 'https://ethereum.example/rpc',
  }));
  const controller = createPrivacyController(getNetwork, {
    cache: storage.cache,
    fetchSnapshot,
    verifyAnchor,
    schedule,
    stop,
    ...overrides,
  });
  return {
    storage,
    controller,
    fetchSnapshot,
    verifyAnchor,
    schedule,
    stop,
    getNetwork,
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
    const run = setup({ fetchSnapshot: () => pending.promise });
    await run.controller.start(id);
    const active = run.controller.resumePending(id);
    await Promise.resolve();
    await run.controller[action](id);
    pending.resolve(snapshot());
    await active;
    expect((await run.controller.getStatus(id)).phase).toBe(
      action === 'clear' ? 'idle' : 'paused'
    );
    expect(run.storage.verified).toBeUndefined();
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
