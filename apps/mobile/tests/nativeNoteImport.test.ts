import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeNoteImport } from '../src/custody/noteImport.ts';
import type { createNativePrivacyPoolSync } from '../src/privacy/nativePrivacyPoolSync.ts';

const note = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function fixture() {
  const lifetime = new AbortController();
  const calls: string[] = [];
  let current = true;
  let hold: ReturnType<typeof gate> | undefined;
  let status: 'ready' | 'syncing' = 'ready';
  const pool: ReturnType<typeof createNativePrivacyPoolSync> = {
    getStatus() {
      if (!current) throw new Error('privacy_cancelled');
      return { poolId: 'eth-1', phase: status };
    },
    async refresh() {
      calls.push('refresh');
      await hold?.promise;
      return { poolId: 'eth-1', phase: status };
    },
    async readNote() {
      calls.push('read');
      return { phase: 'verified' };
    },
    async readSnapshot() {
      throw new Error('Unused snapshot reader');
    },
    async dispose() {
      calls.push('dispose');
    },
  };
  const importer = createNativeNoteImport({
    signal: lifetime.signal,
    assertCurrent() {
      if (!current) throw new Error('privacy_cancelled');
    },
    async openPool(id, signal) {
      assert.equal(id, 'eth-1');
      assert.equal(signal.aborted, false);
      calls.push('open');
      return pool;
    },
    async importNote(raw, read) {
      assert.equal(raw, note);
      calls.push('import');
      const result = await read({
        poolId: 'eth-1',
        commitment: '',
        nullifierHash: '',
      });
      return {
        id: 'local',
        amount: '1',
        createdAt: 1,
        poolId: 'eth-1',
        phase: result.phase,
      };
    },
  });
  return {
    importer,
    calls,
    lifetime,
    wait() {
      return (hold = gate());
    },
    retire() {
      current = false;
    },
    syncing() {
      status = 'syncing';
    },
  };
}

test('raw note import verifies only its pool before invoking shared retention', async () => {
  const f = fixture();
  assert.deepEqual(await f.importer.importNote(note), {
    amount: '1',
    phase: 'verified',
  });
  assert.deepEqual(f.calls, ['open', 'refresh', 'import', 'read', 'dispose']);
  await f.importer.dispose();
});

test('invalid input and unfinished verification never reach retention', async () => {
  const f = fixture();
  await assert.rejects(
    f.importer.importNote('invalid'),
    /privacy_note_invalid/
  );
  assert.deepEqual(f.calls, []);
  f.syncing();
  await assert.rejects(
    f.importer.importNote(note),
    /privacy_verification_pending/
  );
  assert.deepEqual(f.calls, ['open', 'refresh', 'dispose']);
  await f.importer.dispose();
});

test('owner loss and cancellation while checking a pool cannot import or start another attempt', async () => {
  for (const cancel of ['owner', 'dispose', 'parent'] as const) {
    const f = fixture(),
      held = f.wait();
    const work = assert.rejects(
      f.importer.importNote(note),
      /privacy_cancelled/
    );
    await Promise.resolve();
    await Promise.resolve();
    if (cancel === 'owner') f.retire();
    else if (cancel === 'parent') f.lifetime.abort();
    const closing =
      cancel === 'dispose' ? f.importer.dispose() : Promise.resolve();
    held.release();
    await work;
    await closing;
    assert.equal(f.calls.includes('import'), false);
    await f.importer.dispose();
    await assert.rejects(
      async () => f.importer.importNote(note),
      /privacy_cancelled/
    );
  }
});

test('overlapping imports do not start a second public check', async () => {
  const f = fixture(),
    held = f.wait();
  const first = f.importer.importNote(note);
  await assert.rejects(f.importer.importNote(note), /privacy_busy/);
  held.release();
  await first;
  assert.equal(f.calls.filter((call) => call === 'open').length, 1);
  await f.importer.dispose();
});
