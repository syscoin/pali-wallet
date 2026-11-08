import assert from 'node:assert/strict';
import test from 'node:test';
import { openOwnedPrivatePool } from '../src/custody/ownedPrivatePool.ts';
import type { createNativePrivacyPoolSync } from '../src/privacy/nativePrivacyPoolSync.ts';

function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function fixture() {
  let owner = true,
    service = true,
    closed = false;
  let pathGate: Promise<void> | undefined;
  const snapshot = { root: '0x01' };
  const pool = await openOwnedPrivatePool(
    'eth-1',
    async () =>
      ({
        getStatus() {
          if (!service) throw Error('service changed');
          return { phase: 'ready' };
        },
        async readNote() {
          return { phase: 'verified' };
        },
        async readSnapshot() {
          return {
            snapshot,
            assertSnapshotCurrent(value: unknown) {
              if (closed) throw Error('closed');
              assert.equal(value, snapshot);
            },
            async getPath() {
              await pathGate;
              return { pathElements: ['path'], pathIndices: [0] };
            },
            async waitForScheduledRefresh() {
              await pathGate;
              return true;
            },
          };
        },
        async refresh() {
          return { phase: 'ready' };
        },
        async dispose() {
          closed = true;
        },
      } as unknown as ReturnType<typeof createNativePrivacyPoolSync>),
    new AbortController().signal,
    () => {
      if (!owner) throw Error('owner changed');
    }
  );
  return {
    pool,
    snapshot,
    changeOwner() {
      owner = false;
    },
    changeService() {
      service = false;
    },
    holdPath(promise: Promise<void>) {
      pathGate = promise;
    },
  };
}

test('owned snapshot preserves exact identity and rejects a different pool', async () => {
  const f = await fixture();
  const access = await f.pool.readSnapshot('eth-1');
  assert.equal(access.snapshot, f.snapshot);
  assert.deepEqual(await access.getPath(0), {
    pathElements: ['path'],
    pathIndices: [0],
  });
  await assert.rejects(f.pool.readSnapshot('eth-10'));
  await f.pool.dispose();
  assert.throws(() => access.assertSnapshotCurrent(access.snapshot));
});

for (const change of ['owner', 'service'] as const) {
  test(`held snapshot path rechecks ${change} after await`, async () => {
    const f = await fixture(),
      gate = held();
    const access = await f.pool.readSnapshot('eth-1');
    f.holdPath(gate.promise);
    const path = access.getPath(0);
    if (change === 'owner') f.changeOwner();
    else f.changeService();
    gate.release();
    await assert.rejects(path);
    assert.throws(() => access.assertSnapshotCurrent(access.snapshot));
    await f.pool.dispose();
  });
}

test('scheduled snapshot refresh retains service ownership after its wait', async () => {
  const f = await fixture(),
    gate = held();
  const access = await f.pool.readSnapshot('eth-1');
  f.holdPath(gate.promise);
  const refresh = access.waitForScheduledRefresh!();
  f.changeService();
  gate.release();
  await assert.rejects(refresh);
  await f.pool.dispose();
});
