import assert from 'node:assert/strict';
import test from 'node:test';
import { utils } from 'syscoinjs-lib';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { NativePsbtRequests, type NativePsbtHandoff, type PsbtResumeScope } from '../src/connections/psbtRequests.ts';
import type { WalletConnectRequest } from '../src/connections/walletConnect.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const psbt = new utils.bitcoinjs.Psbt();
psbt.addInput({ hash: 'aa'.repeat(32), index: 0 }); psbt.addOutput({ script: Buffer.from('51', 'hex'), value: 900n });
const envelope = PsbtUtils.toPali(psbt);
function fixture() {
  let generation = 1, live = true, dispatched = false, fail = false, prepares = 0, signs = 0;
  let handoff!: NativePsbtHandoff;
  let signWait = Promise.withResolvers<void>(), respondWait = Promise.resolve(), cancelWait = Promise.resolve();
  const entered = Promise.withResolvers<void>(), responses: unknown[] = [], canceled: object[] = [];
  const wire: WalletConnectRequest = { freshness: 'fresh', id: 1, expiresAt: Date.now() + 120000, method: 'sys_sign', chainId: 'bip122:' + 'ab'.repeat(16), params: [envelope], verification: { validation: 'VALID', isScam: false },
    session: { binding: { topic: 'aa'.repeat(32), peerPublicKey: 'bb'.repeat(32), origin: 'https://exact.example' }, metadata: { name: 'App', description: '', url: 'https://exact.example', icons: [] }, expiry: Math.floor(Date.now() / 1000) + 300,
      namespaces: { bip122: { accounts: [], methods: ['sys_sign'], events: [] } } } };
  const scope = (): PsbtResumeScope => ({ adapter: 1, wallet: 'wallet', unlockGeneration: generation, accountId: 'trezor:0:0', address: 'address', type: 'Trezor', xpub: 'xpub', registration: 'full-registration', grant: 'grant' });
  const owner = () => ({ order: 1, accountLabel: 'Trezor', address: 'address', networkLabel: 'Bitcoin', chainId: wire.chainId, symbol: 'BTC', decimals: 8, resumeScope: scope(),
    assertCurrent() { if (!live) throw Error('CONTEXT_CHANGED'); }, assertSessionCurrent() {} });
  const manager = new NativePsbtRequests({ foreground: () => true, changed() {}, checkSite: async () => ({ isBlacklisted: false }),
    host: () => ({ async cancelHandoff(job) { canceled.push(job); await cancelWait; },
      async prepare(request, signal, check, control) {
        prepares++; handoff = control;
        const guard = () => { check(); if (signal.aborted) throw Error('CANCELLED'); };
        return { review: { method: request.method, origin: request.origin, feeSatoshis: '100', unsignedHash: 'ab'.repeat(32), transactionOptions: { rbf: false }, transactionType: 'bitcoin', complete: false, sentry: null, inputs: [], outputs: [] },
          assertCurrent: guard, dispose() {}, disposition: () => dispatched ? { transactionNotBroadcast: false, txid: 'ee'.repeat(32) } : { transactionNotBroadcast: true },
          async approve() { guard(); signs++; entered.resolve(); await signWait.promise; guard(); if (fail) throw Error('Failed signing'); control.beforeSignature(); return envelope; } };
      } }),
    async respond(_wire, response, check, onDispatch) { check(); onDispatch(); responses.push(response); await respondWait; },
  });
  return { manager, wire, owner, responses, canceled, entered: entered.promise,
    enqueue: (resumeId?: string, overrides?: Partial<PsbtResumeScope>) => manager.enqueue(wire, { ...owner(), resumeScope: { ...scope(), ...overrides } }, resumeId),
    control: () => handoff, signDone: () => signWait.resolve(), newSign: () => { signWait = Promise.withResolvers<void>(); },
    lock() { live = false; manager.revalidate(); }, unlock() { live = true; generation++; },
    markBroadcast() { dispatched = true; }, fail() { fail = true; },
    holdResponse(wait: Promise<void>) { respondWait = wait; }, holdCancel(wait: Promise<void>) { cancelWait = wait; },
    prepares: () => prepares, signs: () => signs,
  };
}
async function start(f: ReturnType<typeof fixture>) {
  f.enqueue(); await tick(); const review = f.manager.review(1)!;
  const pending = f.manager.approve(review.id), rejected = assert.rejects(pending);
  await f.entered; return { review, rejected };
}

test('verified Suite departure retires old signing, preserves the original wire bound and requires new consent after real unlock', async () => {
  const f = fixture();
  try {
    const { review, rejected } = await start(f), job = {}, finish = f.control().beforeSuiteOpen(Date.now() + 60000, job);
    finish(true); // Linking may fulfill before the AppState notification.
    f.manager.background(); const descriptor = f.manager.descriptor(review.id)!; assert(descriptor);
    assert.equal(f.manager.size, 1); assert.equal(f.manager.count(f.wire.session.binding.topic), 1); assert(f.manager.has(f.wire));
    f.lock(); f.signDone(); await rejected; await f.manager.drainSuspended(review.id);
    assert.deepEqual(f.responses, []); assert.throws(() => f.enqueue(review.id));
    f.unlock(); f.newSign(); f.enqueue(review.id); await tick();
    const resumed = f.manager.review(2)!; assert(resumed); assert.notEqual(resumed.id, review.id);
    assert.equal(resumed.expiresAt, descriptor.expiresAt); assert.equal(f.signs(), 1); assert.deepEqual(f.canceled, []);
    const approval = f.manager.approve(resumed.id); await tick(); f.signDone(); await approval;
    assert.equal(f.signs(), 2); assert.deepEqual(f.responses, [{ result: envelope }]); assert.equal(f.manager.descriptor(review.id), null);
  } finally { f.signDone(); await f.manager.dispose(); }
});

for (const change of ['failed-launch', 'signature-ready', 'broadcast-uncertain', 'ordinary-background'] as const) test(`${change} cannot create a resumable descriptor`, async () => {
  const f = fixture();
  try {
    const { review, rejected } = await start(f);
    if (change !== 'ordinary-background') {
      const finish = f.control().beforeSuiteOpen(Date.now() + 60000, {});
      if (change === 'failed-launch') finish(false);
      else if (change === 'signature-ready') f.control().beforeSignature();
      else f.markBroadcast();
    }
    f.manager.background(); f.signDone(); await rejected; await tick();
    assert.equal(f.manager.descriptor(review.id), null);
    assert.equal(f.responses.some(value => 'result' in (value as object)), false);
    assert.equal(f.responses.length, change === 'broadcast-uncertain' ? 0 : 1);
  } finally { f.signDone(); await f.manager.dispose(); }
});

test('an unrelated later background cannot consume a successful but expired Suite launch window', async () => {
  const f = fixture(), now = Date.now; let clock = now(); Date.now = () => clock;
  try {
    const { review, rejected } = await start(f); f.control().beforeSuiteOpen(clock + 60000, {})(true);
    clock += 5001; f.manager.background(); f.signDone(); await rejected; await tick();
    assert.equal(f.manager.descriptor(review.id), null); assert.equal(f.responses.length, 1);
  } finally { Date.now = now; f.signDone(); await f.manager.dispose(); }
});

test('old selectors and launch callbacks cannot clear a successor suspension, and pending successors cannot steal its FIFO job', async () => {
  const f = fixture();
  try {
    const { review, rejected } = await start(f), oldFinish = f.control().beforeSuiteOpen(Date.now() + 60000, {});
    f.manager.background(); const first = f.manager.descriptor(review.id)!; f.lock(); f.signDone(); await rejected;
    f.unlock();
    f.manager.enqueue({ ...f.wire, id: 2 }, { ...f.owner(), order: 2 }); await tick();
    assert.equal(f.prepares(), 1); assert.equal(f.manager.size, 2); assert.equal(f.manager.review(2), null);
    await f.manager.drainSuspended(review.id); f.newSign(); f.enqueue(review.id); await tick();
    const next = f.manager.review(2)!; assert(next); assert.equal(f.manager.firstOrder, 1);
    const pending = f.manager.approve(next.id), rejects = assert.rejects(pending); await tick();
    f.control().beforeSuiteOpen(Date.now() + 50000, {}); f.manager.background();
    const successor = f.manager.descriptor(review.id)!; assert(successor); assert.notEqual(successor, first);
    assert.equal(f.manager.descriptor('stale-other-id'), null); f.manager.reject(review.id); f.manager.discardHandoff(first); oldFinish(false);
    assert.equal(f.manager.descriptor(review.id), successor);
    f.signDone(); await rejects;
  } finally { f.signDone(); await f.manager.dispose(); }
});

for (const field of ['adapter', 'wallet', 'accountId', 'address', 'xpub', 'registration', 'grant'] as const) test(`resumption refuses changed ${field}`, async () => {
  const f = fixture();
  try {
    const { review, rejected } = await start(f); f.control().beforeSuiteOpen(Date.now() + 60000, {}); f.manager.background(); f.lock(); f.signDone(); await rejected;
    f.unlock(); assert.throws(() => f.enqueue(review.id, { [field]: field === 'adapter' ? 2 : 'changed' }));
    assert.equal(f.signs(), 1);
  } finally { f.signDone(); await f.manager.dispose(); }
});

test('suspended expiry and disposal drain only the captured native job before another prepare', async () => {
  const f = fixture(), release = Promise.withResolvers<void>();
  try {
    const { review, rejected } = await start(f), job = {}; f.control().beforeSuiteOpen(Date.now() + 60000, job); f.manager.background(); f.lock(); f.signDone(); await rejected;
    const descriptor = f.manager.descriptor(review.id)!; f.holdCancel(release.promise); f.manager.discardHandoff(descriptor); await tick();
    assert.deepEqual(f.canceled, [job]); let disposed = false; const closing = f.manager.dispose().then(() => { disposed = true; });
    await tick(); assert.equal(disposed, false); release.resolve(); await closing;
  } finally { release.resolve(); f.signDone(); await f.manager.dispose(); }
});


test('a failed Suite launch after old SDK retirement still clears only its consumed suspension', async () => {
  const f = fixture();
  try {
    const { review, rejected } = await start(f), job = {}, finish = f.control().beforeSuiteOpen(Date.now() + 60000, job);
    f.manager.background(); f.lock(); f.signDone(); await rejected;
    assert(f.manager.descriptor(review.id)); finish(false); await tick();
    assert.equal(f.manager.descriptor(review.id), null); assert.deepEqual(f.canceled, [job]);
  } finally { f.signDone(); await f.manager.dispose(); }
});


test('wire/session/combined handoff expiry is never renewed by a fresh unlock or new review', async () => {
  const f = fixture(), now = Date.now; let clock = now(); Date.now = () => clock;
  try {
    const { review, rejected } = await start(f); const bound = clock + 10000;
    f.control().beforeSuiteOpen(bound, {}); f.manager.background(); f.lock(); f.signDone(); await rejected;
    const descriptor = f.manager.descriptor(review.id)!; assert.equal(descriptor.expiresAt, bound);
    clock += 2000; f.unlock(); await f.manager.drainSuspended(review.id); f.newSign(); f.enqueue(review.id); await tick();
    const fresh = f.manager.review(2)!; assert.equal(fresh.expiresAt, bound);
    clock = bound + 1; await assert.rejects(f.manager.approve(fresh.id)); assert.equal(f.signs(), 1);
  } finally { Date.now = now; f.signDone(); await f.manager.dispose(); }
});

test('response/signature handoff is terminal even while its acknowledgement is unresolved', async () => {
  const f = fixture(), acknowledgement = Promise.withResolvers<void>();
  try {
    f.holdResponse(acknowledgement.promise); f.enqueue(); await tick(); const review = f.manager.review(1)!;
    const signing = f.manager.approve(review.id);
    await f.entered; f.control().beforeSuiteOpen(Date.now() + 60000, {}); f.signDone(); await tick();
    assert.equal(f.responses.length, 1); f.manager.background(); assert.equal(f.manager.descriptor(review.id), null);
    acknowledgement.resolve(); await signing; assert.equal(f.responses.length, 1);
  } finally { acknowledgement.resolve(); f.signDone(); await f.manager.dispose(); }
});
