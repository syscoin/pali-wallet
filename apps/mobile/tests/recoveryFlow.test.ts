import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeRecoveryFlow, type RecoveryOutcome } from '../src/custody/recoveryFlow.ts';
import type { RecoveryInventory } from '../src/custody/recoveryInventory.ts';
import type { RecoveryProof } from '../src/custody/recovery.ts';

const phrase = Array(12).fill('publicfixture').join(' '), password = 'public fixture password';
const counts = { hdAccounts: 2, importedKeys: 1, retiredHdAccounts: 1, retiredImportedAccounts: 1, journalRecords: 3, pendingTransactions: 1, terminalTransactions: 2, tokenEntries: 1, historySummaries: 4, cachedTransactions: 5, activityPreferences: 1 };
const inventory: RecoveryInventory = Object.freeze({ status: 'needs-matching-phrase-verification', reason: null, backup: 'confirmed', counts: Object.freeze(counts), privateNotes: 'not-supported' });
const proof = Object.freeze({}) as RecoveryProof;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const flows: NativeRecoveryFlow[] = [];
test.afterEach(() => { for (const flow of flows.splice(0)) flow.cancel(); });
function fixture() {
  let time = 100, current = true, created = 0, calls = 0, commits = 0, cancelled = 0;
  let read = async () => inventory, prepare = async () => proof, commit = async () => 'committed-locked' as const, finish = async (_value: RecoveryOutcome) => {};
  const outcomes: RecoveryOutcome[] = [];
  const flow = new NativeRecoveryFlow({ readInventory: () => read(), isCurrent: () => current, now: () => time,
    createCoordinator() { created++; return { async prepare(p, pass, guard) { calls++; assert.equal(p, phrase); assert.equal(pass, password); guard(); return prepare(); }, async commit(p) { commits++; assert.equal(p, proof); return commit(); }, cancel() { cancelled++; } }; },
    async finish(value) { outcomes.push(value); await finish(value); } }); flows.push(flow);
  return { flow, outcomes, created: () => created, calls: () => calls, commits: () => commits, cancelled: () => cancelled,
    time(value: number) { time = value; }, current(value: boolean) { current = value; }, read(value: typeof read) { read = value; }, prepare(value: typeof prepare) { prepare = value; }, commit(value: typeof commit) { commit = value; }, finish(value: typeof finish) { finish = value; } };
}
async function enter(f: ReturnType<typeof fixture>) { f.flow.start(); await tick(); assert.equal(f.flow.getSnapshot().phase, 'scope'); f.flow.enter(); }
const submit = (f: ReturnType<typeof fixture>) => f.flow.submit({ phrase, password, confirmation: password });

test('scope reads once without creating recovery authority; no private data enters snapshots', async () => {
  const f = fixture(); f.flow.start(); f.flow.start(); await tick(); assert.equal(f.created(), 0);
  assert.equal(f.flow.getSnapshot().inventory, inventory); f.flow.enter(); assert(submit(f)); await tick();
  assert.equal(f.flow.getSnapshot().phase, 'review'); assert(!JSON.stringify(f.flow.getSnapshot()).includes(password)); assert(!JSON.stringify(f.flow.getSnapshot()).includes(phrase));
});
test('invalid input is field-associated and never retires or invokes the coordinator', async () => {
  const f = fixture(); await enter(f);
  assert.equal(f.flow.submit({ phrase: 'few words', password: 'short', confirmation: 'different' }), false);
  assert.deepEqual(Object.keys(f.flow.getSnapshot().fieldErrors).sort(), ['confirmation', 'password', 'phrase']); assert.equal(f.created(), 0);
});
test('wrong phrase can deliberately retry on the same original coordinator', async () => {
  const f = fixture(); await enter(f); f.prepare(async () => { throw new Error('WRONG_PHRASE'); });
  assert(submit(f)); await tick(); assert.match(f.flow.getSnapshot().error, /does not match/); assert.equal(f.flow.getSnapshot().phase, 'entry');
  f.prepare(async () => proof); assert(submit(f)); await tick(); assert.equal(f.created(), 1); assert.equal(f.calls(), 2); assert.equal(f.flow.getSnapshot().phase, 'review');
});
test('single-flight reservation precedes reentrant subscribers and duplicate commit', async () => {
  const f = fixture(), held = deferred<RecoveryProof>(); await enter(f); f.prepare(() => held.promise);
  f.flow.subscribe(() => { if (f.flow.getSnapshot().phase === 'verifying') assert.equal(submit(f), false); });
  assert(submit(f)); assert.equal(submit(f), false); held.resolve(proof); await tick();
  const commit = deferred<'committed-locked'>(); f.commit(() => commit.promise); f.flow.commit(); f.flow.commit(); assert.equal(f.commits(), 1);
  commit.resolve('committed-locked'); await tick(); assert.equal(f.outcomes[0]?.kind, 'success');
});
test('cancel during prepare clears authority immediately and rejects late proof publication', async () => {
  const f = fixture(), held = deferred<RecoveryProof>(); await enter(f); f.prepare(() => held.promise); submit(f); await tick(); f.flow.cancel();
  assert.equal(f.cancelled(), 1); held.resolve(proof); await tick(); assert.notEqual(f.flow.getSnapshot().phase, 'review'); assert.equal(f.outcomes.length, 1); assert.equal(f.outcomes[0]?.kind, 'cancelled');
});
test('commit cancellation and commit rejection remain uncertain, never claim rollback', async () => {
  for (const cancel of [true, false]) {
    const f = fixture(); await enter(f); submit(f); await tick();
    const held = deferred<'committed-locked'>(); f.commit(cancel ? () => held.promise : async () => { throw new Error('CANCELLED'); }); f.flow.commit();
    if (cancel) { f.flow.cancel(); held.resolve('committed-locked'); }
    await tick(); assert.equal(f.outcomes.length, 1); assert.equal(f.outcomes[0]?.kind, 'uncertain'); assert.match(f.outcomes[0]!.message, /may have completed/);
  }
});
test('expiry is measured from initial prepare, not entry into review', async () => {
  const f = fixture(), held = deferred<RecoveryProof>(); await enter(f); f.prepare(() => held.promise); submit(f);
  f.time(599999); held.resolve(proof); await tick(); assert.equal(f.flow.getSnapshot().phase, 'review');
  f.time(600100); f.flow.commit(); await tick(); assert.equal(f.commits(), 0); assert.equal(f.outcomes[0]?.kind, 'expired');
});
test('stale inventory and unavailable counts cannot turn into a recovery scope or zero', async () => {
  const f = fixture(), held = deferred<RecoveryInventory>(); f.read(() => held.promise); f.flow.start(); f.current(false); held.resolve(inventory); await tick();
  assert.equal(f.flow.getSnapshot().phase, 'blocked'); assert.equal(f.flow.getSnapshot().inventory, null);
  const g = fixture(); g.read(async () => ({ ...inventory, status: 'unavailable', counts: null })); g.flow.start(); await tick(); assert.equal(g.flow.getSnapshot().inventory, null); assert.equal(g.created(), 0);
});
test('confirmed commit outcome survives a later reopen failure', async () => {
  const f = fixture(); await enter(f); submit(f); await tick(); f.finish(async () => { throw new Error('REOPEN_REQUIRED'); }); f.flow.commit(); await tick();
  assert.equal(f.outcomes[0]?.kind, 'success'); assert.equal(f.flow.getSnapshot().phase, 'blocked'); assert.match(f.flow.getSnapshot().error, /could not be reopened/);
});
test('Back before preparation clears entry without retiring; Back after wrong phrase cancels', async () => {
  const f = fixture(); await enter(f); f.flow.back(); assert.equal(f.flow.getSnapshot().phase, 'scope'); assert.equal(f.outcomes.length, 0);
  f.flow.enter(); f.prepare(async () => { throw new Error('AUTH_THROTTLED'); }); submit(f); await tick(); f.flow.back(); await tick(); assert.equal(f.outcomes[0]?.kind, 'cancelled'); assert.equal(f.created(), 1);
});
