import assert from 'node:assert/strict';
import test from 'node:test';
import { PALI_INFRASTRUCTURE_METADATA, type PaliInfrastructureContractId } from '../../../source/utils/smartAccount/deploymentMetadata.ts';
import { projectSmartAccountInfrastructureObservation } from '../../../source/utils/smartAccount/infrastructureObservation.ts';
import type { NativePreparedConnectionTransaction } from '../src/connections/transactionRuntime.ts';
import { NativeInfrastructureController, type NativeInfrastructureStatus } from '../src/smartAccount/infrastructure.ts';

const payer = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
function status(deployed: readonly PaliInfrastructureContractId[] = [], pending: NativeInfrastructureStatus['pending'] = null): NativeInfrastructureStatus {
  const observation = projectSmartAccountInfrastructureObservation(1, ['0x01', ...PALI_INFRASTRUCTURE_METADATA.map(entry => deployed.includes(entry.id) ? '0x01' : '0x')]);
  assert(observation);
  return { observation, pending };
}
const requiredContracts = PALI_INFRASTRUCTURE_METADATA.filter(entry => !entry.optional).map(entry => entry.id);
const allContracts = PALI_INFRASTRUCTURE_METADATA.map(entry => entry.id);
function fixture() {
  const lifetime = new AbortController();
  const transaction = Object.freeze({ chainId: '1', from: payer, to: '0x4e59b44847b379578588920cA78FbF26c0B4956C', nonce: '0', value: '0', data: '0xab', gasLimit: '21000', type: 2 as const, maxFeePerGas: '2', maxPriorityFeePerGas: '1', accessList: [] });
  let now = 100, current = true, disposed = 0, submissions = 0, observations = 0;
  let observed = status();
  const contracts: PaliInfrastructureContractId[] = [];
  const signals: AbortSignal[] = [];
  const preparedObjects: NativePreparedConnectionTransaction[] = [];
  let send = async (guard: () => void, broadcast: (hash: string) => void) => { guard(); broadcast(hash); return hash; };
  let observe = async () => observed;
  let quote = async () => {
    const prepared: NativePreparedConnectionTransaction = Object.freeze({
      feeComparison: { recommendationOnly: false },
      transaction, maximumFeeUnits: '42000', coveredFeeUnits: '0', maximumTotalUnits: '42000', approval: null,
      expiresAtMonotonicMilliseconds: now + 60000,
      async submit(guard: () => void, broadcast: (hash: string) => void, submission: unknown) {
        assert.deepEqual(submission, { kind: 'transaction' });
        submissions++;
        return send(guard, broadcast);
      },
    });
    preparedObjects.push(prepared);
    return prepared;
  };
  const host = {
    origin: {kind:'new' as const},
    background() {},
    networkLabel: 'Ethereum', currencySymbol: 'ETH', payerLabel: 'Fee wallet', payerAddress: payer,
    assertCurrent() { assert(current, 'PROFILE_CHANGED'); },
    dispose() { disposed++; },
    async observe(signal: AbortSignal) { observations++; signals.push(signal); return observe(); },
    async prepare(contractId: PaliInfrastructureContractId, signal: AbortSignal) { contracts.push(contractId); signals.push(signal); return quote(); },
    submissionFailure(error: unknown) {
      return error && typeof error === 'object' && 'transactionNotBroadcast' in error
        ? error as { transactionNotBroadcast: boolean; signedTransactionHash?: string } : undefined;
    },
  };
  const controller = new NativeInfrastructureController(host, lifetime.signal, () => now);
  return {
    controller, host, lifetime, transaction, contracts, signals, preparedObjects,
    setNow(value: number) { now = value; },
    setCurrent(value: boolean) { current = value; },
    setStatus(value: NativeInfrastructureStatus) { observed = value; },
    setObserve(value: typeof observe) { observe = value; },
    setQuote(value: typeof quote) { quote = value; },
    setSend(value: typeof send) { send = value; },
    review: () => controller.reviewNext(controller.getSnapshot().revision),
    refresh: () => controller.refresh(controller.getSnapshot().revision),
    confirm: () => controller.confirm(controller.getSnapshot().feeReview!.id),
    get counts() { return { disposed, submissions, observations }; },
  };
}

test('each infrastructure deployment refreshes the catalogue order and requires a separate exact fee confirmation', async () => {
  const f = fixture(), held = deferred<void>();
  f.setStatus(status(['entryPoint']));
  f.setSend(async (guard, broadcast) => { guard(); broadcast(hash); await held.promise; guard(); return hash; });
  try {
    await f.review();
    assert.deepEqual(f.contracts, ['accountImplementation']);
    assert.equal(f.counts.submissions, 0);
    assert.equal(f.controller.getSnapshot().feeReview!.transaction, f.transaction);
    assert.equal(f.controller.getSnapshot().feeReview!.expiresAtMonotonicMilliseconds, 60100);
    const id = f.controller.getSnapshot().feeReview!.id;
    const sending = f.controller.confirm(id);
    assert.equal(f.controller.getSnapshot().status!.pending!.transactionHash, hash);
    assert.equal(f.controller.getSnapshot().feeReview, null);
    await f.controller.confirm(id);
    await f.review();
    assert.equal(f.counts.submissions, 1);
    held.resolve(); await sending;
    assert.equal(f.controller.getSnapshot().phase, 'pending');
    assert.deepEqual(f.contracts, ['accountImplementation']);
  } finally { held.resolve(); f.controller.dispose(); }
});

test('an owned Suite return keeps its reservation and needs a new explicit confirmation', async () => {
  const f = fixture();
  const pending = {contractId:'factory' as const,transactionHash:null};
  f.setStatus(status([],pending));
  let preparations = 0;
  const controller = new NativeInfrastructureController({...f.host,origin:{kind:'suite-resume',id:'owned-infrastructure-return',
    async prepare(signal) {
      preparations++;
      return {status:await f.host.observe(signal),contractId:'factory',prepared:await f.host.prepare('factory',signal)};
    },
  }},f.lifetime.signal,()=>100);
  try {
    assert.deepEqual(controller.origin,{kind:'suite-resume',id:'owned-infrastructure-return'});
    await controller.reviewNext(controller.getSnapshot().revision);
    assert.equal(preparations,0);
    await controller.reviewResume(controller.getSnapshot().revision);
    assert.equal(controller.getSnapshot().feeReview!.kind,'suite-resume');
    assert.deepEqual(controller.getSnapshot().status!.pending,pending);
    assert.equal(f.counts.submissions,0);
    const reviewId = controller.getSnapshot().feeReview!.id;
    await controller.reviewResume(controller.getSnapshot().revision);
    assert.equal(preparations,1);
    await controller.confirm(reviewId);
    assert.equal(f.counts.submissions,1);
    assert.equal(controller.getSnapshot().phase,'pending');
    await controller.confirm(reviewId);
    assert.equal(f.counts.submissions,1);
  } finally {controller.dispose();f.controller.dispose();}
});

for (const response of ['wrong-contract','already-broadcast'] as const)
  test(`a Suite return cannot authorize ${response} pending state`, async () => {
    const f = fixture();
    const controller = new NativeInfrastructureController({...f.host,origin:{kind:'suite-resume',id:'owned-return',async prepare(signal) {
      return {status:status([],{contractId:response==='wrong-contract'?'entryPoint':'factory',transactionHash:response==='already-broadcast'?hash:null}),
        contractId:'factory',prepared:await f.host.prepare('factory',signal)};
    }}},f.lifetime.signal,()=>100);
    try {
      await controller.reviewResume(controller.getSnapshot().revision);
      assert.equal(controller.getSnapshot().phase,'failed');
      assert.equal(controller.getSnapshot().feeReview,null);
      assert.equal(f.counts.submissions,0);
    } finally {controller.dispose();f.controller.dispose();}
  });

test('owned background capture does not require a foreground view and cannot authorize a submission', () => {
  const f = fixture(); let backgrounds = 0;
  const controller = new NativeInfrastructureController({...f.host,background(){backgrounds++;}},f.lifetime.signal,()=>100);
  try {
    f.setCurrent(false);
    controller.background();
    assert.equal(backgrounds,1); assert.equal(f.counts.submissions,0);
    controller.dispose(); controller.background();
    assert.equal(backgrounds,1);
  } finally {controller.dispose();f.controller.dispose();}
});

for (const stage of ['observation', 'quote'] as const) test(`disposing during the held ${stage} prevents review or signing`, async () => {
  const f = fixture(), read = deferred<NativeInfrastructureStatus>(), quote = deferred<NativePreparedConnectionTransaction>();
  const prepared = Object.freeze({ expiresAtMonotonicMilliseconds: 60100 }) as NativePreparedConnectionTransaction;
  if (stage === 'observation') f.setObserve(() => read.promise);
  else f.setQuote(() => quote.promise);
  const reviewing = f.review();
  await tick();
  f.controller.dispose();
  read.resolve(status()); quote.resolve(prepared);
  await reviewing;
  assert.equal(f.controller.getSnapshot().feeReview, null);
  assert.equal(f.counts.submissions, 0);
  assert.equal(f.counts.disposed, 1);
  assert(f.signals.every(signal => signal.aborted));
});

test('an expired original quote is cleared and an old Confirm cannot approve the fresh review', async () => {
  const f = fixture();
  try {
    await f.review();
    const old = f.controller.getSnapshot().feeReview!;
    f.setNow(old.expiresAtMonotonicMilliseconds);
    await f.controller.confirm(old.id);
    assert.equal(f.counts.submissions, 0);
    assert.equal(f.controller.getSnapshot().feeReview, null);
    assert.equal(f.controller.getSnapshot().error, 'mobile.infrastructure.reviewExpired');
    assert.equal(f.controller.getSnapshot().phase, 'ready');
    await f.review();
    assert.notEqual(f.controller.getSnapshot().feeReview!.id, old.id);
    await f.controller.confirm(old.id);
    assert.equal(f.counts.submissions, 0);
    await f.confirm();
    assert.equal(f.counts.submissions, 1);
  } finally { f.controller.dispose(); }
});

test('quote latency cannot restart the prepared transaction deadline', async () => {
  const f = fixture(), held = deferred<NativePreparedConnectionTransaction>();
  f.setQuote(() => held.promise);
  try {
    const reviewing = f.review(); await tick();
    f.setNow(201);
    held.resolve({ expiresAtMonotonicMilliseconds: 200 } as NativePreparedConnectionTransaction);
    await reviewing;
    assert.equal(f.controller.getSnapshot().feeReview, null);
    assert.equal(f.controller.getSnapshot().error, 'mobile.infrastructure.reviewExpired');
  } finally { f.controller.dispose(); }
});

test('listener reentrancy cannot quote, refresh or confirm a just-published review', async () => {
  const f = fixture();
  const unsubscribe = f.controller.subscribe(() => {
    const shown = f.controller.getSnapshot();
    void f.controller.refresh(shown.revision);
    void f.controller.reviewNext(shown.revision);
    if (shown.feeReview) void f.controller.confirm(shown.feeReview.id);
  });
  try {
    await f.review();
    assert.equal(f.counts.observations, 1);
    assert.equal(f.counts.submissions, 0);
    assert.equal(f.contracts.length, 1);
    await f.confirm();
    assert.equal(f.counts.submissions, 1);
  } finally { unsubscribe(); f.controller.dispose(); }
});

test('old refresh and review callbacks cannot act on a later snapshot', async () => {
  const f = fixture();
  try {
    const old = f.controller.getSnapshot().revision;
    await f.refresh();
    await f.controller.reviewNext(old);
    await f.controller.refresh(old);
    assert.equal(f.counts.observations, 1);
    assert.equal(f.contracts.length, 0);
  } finally { f.controller.dispose(); }
});

test('an unknown submission needs explicit journal reconciliation before a new review', async () => {
  const f = fixture();
  f.setSend(async guard => { guard(); throw new Error('RPC transport response with private details'); });
  try {
    await f.review(); const old = f.controller.getSnapshot().feeReview!.id;
    await f.confirm();
    assert.equal(f.controller.getSnapshot().phase, 'unknown');
    assert.equal(f.controller.getSnapshot().status!.pending!.transactionHash, null);
    assert.equal(f.controller.getSnapshot().error, 'mobile.infrastructure.unavailable');
    await f.review();
    assert.equal(f.counts.submissions, 1); assert.equal(f.contracts.length, 1);
    f.setStatus(status([], { contractId: 'entryPoint', transactionHash: null }));
    await f.refresh(); await f.review();
    assert.equal(f.contracts.length, 1);
    f.setStatus(status());
    await f.refresh();
    assert.equal(f.controller.getSnapshot().phase, 'ready');
    assert.equal(f.counts.submissions, 1);
    await f.review(); await f.controller.confirm(old);
    assert.equal(f.counts.submissions, 1);
    f.setSend(async (guard, broadcast) => { guard(); broadcast(hash); return hash; });
    await f.confirm(); assert.equal(f.counts.submissions, 2);
  } finally { f.controller.dispose(); }
});

test('a definite failure allows a fresh quote but never reuses the consumed prepared capability', async () => {
  const f = fixture();
  f.setSend(async guard => { guard(); throw Object.assign(new Error('refused'), { transactionNotBroadcast: true }); });
  try {
    await f.review(); const first = f.preparedObjects[0]!;
    await f.confirm();
    assert.equal(f.controller.getSnapshot().phase, 'failed');
    f.setQuote(async () => first);
    await f.review();
    assert.equal(f.controller.getSnapshot().feeReview, null);
    assert.equal(f.counts.submissions, 1);
  } finally { f.controller.dispose(); }
});

test('parent cancellation during the shared submit await prevents signing and publication', async () => {
  const f = fixture(), held = deferred<void>();
  let signatures = 0, wires = 0;
  f.setSend(async (guard, broadcast) => { await held.promise; guard(); signatures++; guard(); broadcast(hash); wires++; return hash; });
  await f.review();
  const sending = f.confirm();
  f.lifetime.abort(); held.resolve(); await sending;
  assert.equal(f.counts.submissions, 1);
  assert.equal(signatures, 0); assert.equal(wires, 0);
  assert.equal(f.controller.getSnapshot().feeReview, null);
  assert.equal(f.counts.disposed, 1);
});

test('disposal retains the submitted record and rejects a late broadcast callback', async () => {
  const f = fixture(), held = deferred<void>();
  let marker!: (hash: string) => void;
  f.setSend(async (guard, broadcast) => { marker = broadcast; guard(); broadcast(hash); await held.promise; guard(); return hash; });
  await f.review(); const sending = f.confirm();
  assert.equal(f.controller.getSnapshot().status!.pending!.transactionHash, hash);
  f.controller.dispose();
  const retired = f.controller.getSnapshot();
  assert.throws(() => marker(`0x${'cd'.repeat(32)}`), /CANCELLED/);
  held.resolve(); await sending;
  assert.equal(f.controller.getSnapshot(), retired);
  assert.equal(retired.status!.pending!.transactionHash, hash);
});

test('missing required host ports and asynchronous authority have no fallback', async () => {
  const f = fixture();
  try {
    assert.throws(() => new NativeInfrastructureController({ ...f.host, submissionFailure: undefined } as never, f.lifetime.signal), /ports are required/);
    const asyncGuard = new NativeInfrastructureController({ ...f.host, assertCurrent: async () => {} }, f.lifetime.signal);
    try {
      await asyncGuard.refresh(0);
      assert.equal(f.counts.observations, 0);
      assert.equal(asyncGuard.getSnapshot().phase, 'failed');
    } finally { asyncGuard.dispose(); }
  } finally { f.controller.dispose(); }
});

for (const [name, deployed, phase] of [
  ['optional-only missing', requiredContracts, 'complete'],
  ['required missing', requiredContracts.filter(id => id !== 'entryPoint'), 'ready'],
  ['all present', allContracts, 'complete'],
] as const) test(`normal status consumes shared readiness when ${name}`, async () => {
  const f = fixture();
  try {
    f.setStatus(status(deployed)); await f.refresh();
    assert.equal(f.controller.getSnapshot().phase, phase);
    assert.equal(f.controller.getSnapshot().status!.observation.ready, phase === 'complete');
    assert.equal(f.counts.submissions, 0); assert.equal(f.contracts.length, 0);
  } finally { f.controller.dispose(); }
});

test('optional-only readiness preserves a separate deployment review with canonical optional metadata', async () => {
  const f = fixture();
  try {
    f.setStatus(status(requiredContracts)); await f.refresh();
    assert.equal(f.controller.getSnapshot().phase, 'complete');
    assert.deepEqual(f.controller.getSnapshot().status!.observation.missing, ['multicall3']);
    await f.review();
    assert.deepEqual(f.contracts, ['multicall3']);
    assert.equal(f.controller.getSnapshot().feeReview!.contract.optional, true);
    assert.equal(f.counts.submissions, 0);
    await f.confirm(); assert.equal(f.counts.submissions, 1);
    assert.equal(f.controller.getSnapshot().phase, 'pending');
  } finally { f.controller.dispose(); }
});

test('an explicit optional review stays preparing while its quote is held; all-present review returns complete', async () => {
  const f = fixture(), held = deferred<NativePreparedConnectionTransaction>();
  try {
    f.setStatus(status(requiredContracts)); f.setQuote(() => held.promise);
    const reviewing = f.review(); await tick();
    assert.equal(f.controller.getSnapshot().phase, 'preparing');
    assert.equal(f.controller.getSnapshot().feeReview, null);
    held.resolve({
      feeComparison: { recommendationOnly: false },
      transaction: f.transaction, maximumFeeUnits: '42000', coveredFeeUnits: '0', maximumTotalUnits: '42000',
      approval: null, expiresAtMonotonicMilliseconds: 60100,
      async submit() { assert.fail('A held quote must not submit'); },
    });
    await reviewing; assert.equal(f.controller.getSnapshot().phase, 'review');
    f.setStatus(status(allContracts)); await f.refresh(); await f.review();
    assert.equal(f.controller.getSnapshot().phase, 'complete');
    assert.equal(f.controller.getSnapshot().feeReview, null);
    assert.deepEqual(f.contracts, ['multicall3']);
  } finally { f.controller.dispose(); }
});

for (const optionalOnly of [true, false]) test(`review timer expiry restores ${optionalOnly ? 'shared ready' : 'required-missing'} status`, async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    if (optionalOnly) f.setStatus(status(requiredContracts));
    await f.review();
    assert.equal(f.controller.getSnapshot().feeReview!.contract.optional, optionalOnly);
    f.setNow(60100); context.mock.timers.tick(60000);
    assert.equal(f.controller.getSnapshot().phase, optionalOnly ? 'complete' : 'ready');
    assert.equal(f.controller.getSnapshot().feeReview, null);
    assert.equal(f.controller.getSnapshot().error, 'mobile.infrastructure.reviewExpired');
    assert.equal(f.counts.submissions, 0);
  } finally { f.controller.dispose(); }
});

test('a pending optional deployment takes priority over shared readiness', async () => {
  const f = fixture();
  try {
    f.setStatus(status(requiredContracts, { contractId: 'multicall3', transactionHash: hash }));
    await f.refresh(); await f.review();
    assert.equal(f.controller.getSnapshot().phase, 'pending');
    assert.equal(f.controller.getSnapshot().status!.observation.ready, true);
    assert.equal(f.contracts.length, 0); assert.equal(f.counts.submissions, 0);
  } finally { f.controller.dispose(); }
});

test('optional Confirm expiry before its timer fires restores shared ready without signing', async () => {
  const f = fixture(); let signatures = 0;
  f.setSend(async () => { signatures++; throw new Error('Unexpected signing'); });
  try {
    f.setStatus(status(requiredContracts)); await f.review();
    const review = f.controller.getSnapshot().feeReview!;
    // Advance only the quote's injected monotonic clock; do not fire its timer.
    f.setNow(review.expiresAtMonotonicMilliseconds);
    await f.controller.confirm(review.id);
    assert.equal(f.controller.getSnapshot().phase, 'complete');
    assert.equal(f.controller.getSnapshot().feeReview, null);
    assert.equal(f.controller.getSnapshot().error, 'mobile.infrastructure.reviewExpired');
    assert.equal(f.counts.submissions, 0); assert.equal(signatures, 0);
  } finally { f.controller.dispose(); }
});

test('an expired Confirm still checks live wallet authority before restoring status', async () => {
  const f = fixture();
  try {
    f.setStatus(status(requiredContracts)); await f.review();
    const review = f.controller.getSnapshot().feeReview!;
    f.setNow(review.expiresAtMonotonicMilliseconds); f.setCurrent(false);
    await f.controller.confirm(review.id);
    assert.equal(f.controller.getSnapshot().phase, 'failed');
    assert.equal(f.controller.getSnapshot().error, 'mobile.infrastructure.cancelled');
    assert.equal(f.counts.submissions, 0);
  } finally { f.controller.dispose(); }
});
