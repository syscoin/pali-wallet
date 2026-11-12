import assert from 'node:assert/strict';
import test from 'node:test';
import { createBalancePrivacy } from '../src/core/balancePrivacy.ts';

const deferred = () => Promise.withResolvers<void>();
function fixture(initial: string | null = null) {
  let raw = initial, fail = false, lose = false, gate: Promise<void> | undefined;
  let writes = 0, authorizations = 0, authorization: Promise<void> | undefined;
  const preference = createBalancePrivacy({
    async get() { return raw; },
    async set(value) { writes++; if (gate) await gate; if (fail) throw Error('unavailable'); raw = value; if (lose) throw Error('lost acknowledgement'); },
  }, async (_signal, check) => { authorizations++; check(); await authorization; check(); });
  return { preference, get raw() { return raw; }, get writes() { return writes; }, get authorizations() { return authorizations; },
    save(hidden: boolean, signal = new AbortController().signal, check = () => undefined) { return preference.save(hidden, signal, check); },
    fail() { fail = true; }, recover() { fail = false; lose = false; }, lose() { lose = true; }, hold(wait: Promise<void>) { gate = wait; },
    authorize(wait: Promise<void>) { authorization = wait; } };
}

test('absent preference defaults visible after load; saved privacy survives a new owner', async () => {
  const f = fixture(); assert.equal(f.preference.getSnapshot().hidden, true, 'unknown preference must not flash a saved balance');
  await f.preference.reload(); assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: false });
  assert.equal(f.writes, 0); assert.equal(await f.save(true), true); assert.equal(f.raw, 'hidden'); assert.equal(f.authorizations, 0);
  const reopened = fixture(f.raw); await reopened.preference.reload();
  assert.deepEqual(reopened.preference.getSnapshot(), { status: 'ready', hidden: true });
});

test('hide is synchronous before storage, concurrent saves cannot reveal, and listeners cannot interrupt it', async () => {
  const f = fixture(), held = deferred(); await f.preference.reload(); f.hold(held.promise);
  const attempts: Promise<boolean>[] = [];
  f.preference.subscribe(() => { if (f.preference.getSnapshot().status === 'saving') attempts.push(f.save(false)); });
  f.preference.subscribe(() => { throw Error('observer failure'); });
  const saving = f.save(true);
  assert.deepEqual(f.preference.getSnapshot(), { status: 'saving', hidden: true });
  assert.equal(f.writes, 0); held.resolve(); assert.equal(await saving, true);
  assert.deepEqual(await Promise.all(attempts), [false]); assert.equal(f.raw, 'hidden');
});

test('revealing waits for confirmed persistence and a failed write keeps balances hidden', async () => {
  const f = fixture('hidden'), held = deferred(); await f.preference.reload(); f.hold(held.promise);
  const saving = f.save(false); assert.equal(f.preference.getSnapshot().hidden, true);
  held.resolve(); assert.equal(await saving, true); assert.equal(f.preference.getSnapshot().hidden, false); assert.equal(f.authorizations, 1);
  f.fail(); assert.equal(await f.save(true), false);
  assert.deepEqual(f.preference.getSnapshot(), { status: 'unavailable', hidden: true });
  assert.equal(f.raw, 'visible');
});

test('lost write acknowledgement stays hidden until an explicit reread reconciles saved state', async () => {
  const f = fixture(); await f.preference.reload(); f.lose();
  assert.equal(await f.save(true), false); assert.equal(f.raw, 'hidden');
  assert.deepEqual(f.preference.getSnapshot(), { status: 'unavailable', hidden: true });
  await f.preference.reload(); assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: true });
});

test('malformed saved preferences are not overwritten or interpreted as visible', async () => {
  const f = fixture('invalid'); await f.preference.reload();
  assert.deepEqual(f.preference.getSnapshot(), { status: 'unavailable', hidden: true });
  assert.equal(await f.save(false), false); assert.equal(f.writes, 0); assert.equal(f.raw, 'invalid');
});

test('revealing requires a current owner and successful fresh authorization before any write', async () => {
  const f = fixture('hidden'), authorization = deferred(), owner = new AbortController();
  await f.preference.reload(); f.authorize(authorization.promise);
  const pending = f.save(false, owner.signal);
  await Promise.resolve(); assert.equal(f.authorizations, 1); assert.equal(f.writes, 0); assert.equal(f.preference.getSnapshot().hidden, true);
  owner.abort(); authorization.resolve(); assert.equal(await pending, false);
  assert.equal(f.raw, 'hidden'); assert.equal(f.writes, 0); assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: true });
  const refused = fixture('hidden'); await refused.preference.reload();
  refused.authorize(Promise.reject(Error('OS authentication refused')));
  assert.equal(await refused.save(false), false); assert.equal(refused.writes, 0); assert.equal(refused.raw, 'hidden');
});

test('cancellation of a dispatched reveal rolls back before publishing or allowing reload', async () => {
  const f = fixture('hidden'), held = deferred(), owner = new AbortController();
  await f.preference.reload(); f.hold(held.promise);
  const seen: boolean[] = []; f.preference.subscribe(() => seen.push(f.preference.getSnapshot().hidden));
  const pending = f.save(false, owner.signal);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.writes, 1);
  owner.abort(); const reload = f.preference.reload(); held.resolve();
  assert.equal(await pending, false); await reload;
  assert.equal(f.writes, 2); assert.equal(f.raw, 'hidden'); assert.equal(seen.every(Boolean), true);
  assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: true });
});

test('ambiguous reveal and failed rollback stay masked and force repair before an in-process reread', async () => {
  const f = fixture('hidden'); await f.preference.reload(); f.lose();
  assert.equal(await f.save(false), false);
  assert.deepEqual(f.preference.getSnapshot(), { status: 'unavailable', hidden: true });
  assert.equal(f.raw, 'hidden'); assert.equal(f.writes, 2);
  await f.preference.reload(); assert.equal(f.preference.getSnapshot().status, 'unavailable');
  f.recover(); await f.preference.reload();
  assert.deepEqual(f.preference.getSnapshot(), { status: 'ready', hidden: true }); assert.equal(f.raw, 'hidden');
});

test('a committed reveal followed by cancellation and failed rollback is never exposed by an in-process reload', async () => {
  let raw = 'hidden', writes = 0, failRepair = true;
  const owner = new AbortController(), committed = deferred();
  const preference = createBalancePrivacy({ get: async () => raw, set: async value => {
    writes++;
    if (value === 'visible') { raw = value; await committed.promise; }
    else { if (failRepair) throw Error('Storage unavailable'); raw = value; }
  } }, async (_signal, check) => { check(); });
  await preference.reload();
  const visible: boolean[] = []; preference.subscribe(() => visible.push(!preference.getSnapshot().hidden));
  const pending = preference.save(false, owner.signal, () => undefined);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(raw, 'visible');
  owner.abort(); committed.resolve(); assert.equal(await pending, false);
  assert.deepEqual(preference.getSnapshot(), { status: 'unavailable', hidden: true });
  await preference.reload(); assert.equal(preference.getSnapshot().status, 'unavailable');
  failRepair = false; await preference.reload();
  assert.deepEqual(preference.getSnapshot(), { status: 'ready', hidden: true });
  assert.equal(raw, 'hidden'); assert.equal(writes, 4); assert.equal(visible.some(Boolean), false);
});

test('stale, aborted or asynchronous guards cannot authenticate or write', async () => {
  const f = fixture('hidden'); await f.preference.reload();
  const owner = new AbortController(); owner.abort();
  assert.equal(await f.save(false, owner.signal), false);
  assert.equal(await f.save(false, undefined, () => { throw Error('CANCELLED'); }), false);
  assert.equal(await f.save(false, undefined, (() => Promise.reject(Error('CANCELLED'))) as unknown as () => undefined), false);
  assert.equal(f.authorizations, 0); assert.equal(f.writes, 0); assert.equal(f.raw, 'hidden');
});
