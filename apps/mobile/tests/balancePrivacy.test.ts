import assert from 'node:assert/strict';
import test from 'node:test';
import { createBalancePrivacy } from '../src/core/balancePrivacy.ts';

const deferred = () => Promise.withResolvers<void>();
function fixture(initial: string | null = null) {
  let raw = initial, fail = false, lose = false, gate: Promise<void> | undefined;
  let writes = 0;
  const preference = createBalancePrivacy({
    async get() { return raw; },
    async set(value) { writes++; if (gate) await gate; if (fail) throw Error('unavailable'); raw = value; if (lose) throw Error('lost acknowledgement'); },
  });
  return { preference, get raw() { return raw; }, get writes() { return writes; },
    fail() { fail = true; }, lose() { lose = true; }, hold(wait: Promise<void>) { gate = wait; } };
}

test('absent preference defaults visible after load; saved privacy survives a new owner', async () => {
  const f = fixture(); assert.equal(f.preference.getSnapshot().hidden, true, 'unknown preference must not flash a saved balance');
  await f.preference.reload(); assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: false });
  assert.equal(f.writes, 0); assert.equal(await f.preference.save(true), true); assert.equal(f.raw, 'hidden');
  const reopened = fixture(f.raw); await reopened.preference.reload();
  assert.deepEqual(reopened.preference.getSnapshot(), { status: 'ready', hidden: true });
});

test('hide is synchronous before storage, concurrent saves cannot reveal, and listeners cannot interrupt it', async () => {
  const f = fixture(), held = deferred(); await f.preference.reload(); f.hold(held.promise);
  const attempts: Promise<boolean>[] = [];
  f.preference.subscribe(() => { if (f.preference.getSnapshot().status === 'saving') attempts.push(f.preference.save(false)); });
  f.preference.subscribe(() => { throw Error('observer failure'); });
  const saving = f.preference.save(true);
  assert.deepEqual(f.preference.getSnapshot(), { status: 'saving', hidden: true });
  assert.equal(f.writes, 0); held.resolve(); assert.equal(await saving, true);
  assert.deepEqual(await Promise.all(attempts), [false]); assert.equal(f.raw, 'hidden');
});

test('revealing waits for confirmed persistence and a failed write keeps balances hidden', async () => {
  const f = fixture('hidden'), held = deferred(); await f.preference.reload(); f.hold(held.promise);
  const saving = f.preference.save(false); assert.equal(f.preference.getSnapshot().hidden, true);
  held.resolve(); assert.equal(await saving, true); assert.equal(f.preference.getSnapshot().hidden, false);
  f.fail(); assert.equal(await f.preference.save(true), false);
  assert.deepEqual(f.preference.getSnapshot(), { status: 'unavailable', hidden: true });
  assert.equal(f.raw, 'visible');
});

test('lost write acknowledgement stays hidden until an explicit reread reconciles saved state', async () => {
  const f = fixture(); await f.preference.reload(); f.lose();
  assert.equal(await f.preference.save(true), false); assert.equal(f.raw, 'hidden');
  assert.deepEqual(f.preference.getSnapshot(), { status: 'unavailable', hidden: true });
  await f.preference.reload(); assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: true });
});

test('malformed saved preferences are not overwritten or interpreted as visible', async () => {
  const f = fixture('invalid'); await f.preference.reload();
  assert.deepEqual(f.preference.getSnapshot(), { status: 'unavailable', hidden: true });
  assert.equal(await f.preference.save(false), false); assert.equal(f.writes, 0); assert.equal(f.raw, 'invalid');
});
