import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { notificationCapabilities } from '../src/notifications/capabilities.ts';
import type { NativeNotificationScope } from '../src/notifications/types.ts';
import { createNativeNetwork, getNativeNetwork } from '../src/custody/networkContext.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { createGuardianRecoveryFixture, GUARDIAN_FIXTURE_ACCOUNT } from './native-watch-ui/guardianRecoveryFixture.ts';
import { GUARDIAN_FIXTURE_RUNTIME } from './guardianRecoveryRuntime.ts';
import { NativeNotificationCoordinator, emptyNotificationDocument } from '../src/notifications/coordinator.ts';

// Node selects the web test adapter; Metro retains its native platform resolution.
const readerUrl = new URL('../src/notifications/reader.ts', import.meta.url).href;
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL === readerUrl && specifier === '../platform/http' ? '../platform/http.ts' : specifier, context);
} });
const { createNotificationReader, normalizeNotificationScope, notificationFactScope } = await import(readerUrl) as typeof import('../src/notifications/reader.ts');
hook.deregister();

const scope = (network = getNativeNetwork('ethereum'), guardian = false): NativeNotificationScope => ({
  id: 'watch:one', accountId: 'watch:one', accountType: 'watch', accountAddress: GUARDIAN_FIXTURE_ACCOUNT, network, guardian,
});
const custom = createNativeNetwork({ ...getNativeNetwork('ethereum'), id: 'custom:ethereum', name: 'Custom Ethereum' });

test('notification coverage matches the exact registered explorer and explicitly selected guardian reader', () => {
  assert.deepEqual(notificationCapabilities(scope()), { transactions: true, guardian: false });
  assert.deepEqual(notificationCapabilities(scope(getNativeNetwork('base'))), { transactions: false, guardian: false });
  assert.deepEqual(notificationCapabilities(scope(custom, true)), { transactions: false, guardian: true });
  const changed = createNativeNetwork({ ...getNativeNetwork('ethereum'), rpcUrl: 'https://different.example/rpc' });
  assert.deepEqual(notificationCapabilities(scope(changed)), { transactions: false, guardian: false });
  assert.deepEqual(notificationCapabilities({ ...scope(), network: getUtxoNetwork('bitcoin') }), { transactions: true, guardian: false });
});

test('a network without transaction coverage cannot turn a resolved absent guardian read into success', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('Unexpected HTTP'); });
  await assert.rejects(createNotificationReader()(scope(getNativeNetwork('base')), null, new AbortController().signal, () => {}), /observations unavailable/);
  assert.equal(requests, 0);
});

test('failed transaction history without a requested guardian observation rejects', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.rejects(createNotificationReader()(scope(), null, new AbortController().signal, () => {}), /observations unavailable/);
});

test('guardian-only coverage returns an actual anchored observation with transaction history disabled', async t => {
  const rpc = createGuardianRecoveryFixture(); rpc.select('healthy', GUARDIAN_FIXTURE_RUNTIME);
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const result = await rpc.fetch(input, init); assert(result, 'Only the existing guardian RPC is expected'); return result;
  });
  const result = await createNotificationReader()(scope(custom, true), null, new AbortController().signal, () => {});
  assert.equal(result.historyReadSucceeded, false); assert.deepEqual(result.transactions, []);
  assert('guardianObservation' in result);
  assert.equal(result.guardianObservation?.account, GUARDIAN_FIXTURE_ACCOUNT);
  assert.equal(result.guardianObservation?.observedBlock.number, 32);
  assert.equal(rpc.methods().length, 11);
});

for (const mode of ['unsupported', 'eoa'] as const) test(`guardian-only ${mode} is unavailable without an actual observation`, async t => {
  const rpc = createGuardianRecoveryFixture(); rpc.select(mode, GUARDIAN_FIXTURE_RUNTIME);
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const result = await rpc.fetch(input, init); assert(result); return result;
  });
  await assert.rejects(createNotificationReader()(scope(custom, true), null, new AbortController().signal, () => {}), /observations unavailable/);
});

test('successful transaction history remains usable when guardian coverage is unavailable', async t => {
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
    ? new Response(null, { status: 503 }) : Response.json({ status: '1', result: [] }));
  const result = await createNotificationReader()(scope(getNativeNetwork('ethereum'), true), null, new AbortController().signal, () => {});
  assert.equal(result.historyReadSucceeded, true); assert.deepEqual(result.transactions, []);
  assert.equal('guardianObservation' in result ? result.guardianObservation : undefined, undefined);
});

for (const healthy of ['txlist', 'tokentx']) for (const failedBody of ['status', 'invalid-json']) {
  test(`initialized notifications retain ${healthy} while the other feed has ${failedBody}`, async t => {
    let document = emptyNotificationDocument(), sequence = 0, hasEvent = false, failing = false;
    const posted: string[] = [];
    const selected = scope();
    const event = { hash: `0x${'ab'.repeat(32)}`, from: `0x${'22'.repeat(20)}`, to: selected.accountAddress,
      blockNumber: '123', timeStamp: '1700000000', txreceipt_status: '1', value: '7',
      contractAddress: `0x${'33'.repeat(20)}`, tokenSymbol: 'TEST', tokenDecimal: '18' };
    t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
      const feed = new URL(String(url)).searchParams.get('action');
      if (failing && feed !== healthy) return failedBody === 'status' ? new Response(null, { status: 503 }) : new Response('{');
      return Response.json({ status: '1', message: 'OK', result: hasEvent && feed === healthy ? [event] : [] });
    });
    const coordinator = new NativeNotificationCoordinator({
      store: { initialize: async () => {}, transact: async (action, guard) => {
        guard(); const next = structuredClone(document); const output = await action(next); guard(); document = next; return output;
      } },
      delivery: { permission: async () => 'granted', backgroundStatus: async () => 'available',
        register: async () => {}, unregister: async () => {}, post: async id => { posted.push(id); },
        remove: async () => {}, prune: async () => {} },
      normalize: normalizeNotificationScope, factScope: notificationFactScope, read: createNotificationReader(),
      randomId: () => `pali-alert-${(++sequence).toString(16).padStart(32, '0')}`, now: () => 1700000010000,
    });
    await coordinator.load();
    await coordinator.enable([selected], () => {}, { requestPermission: true });
    assert.equal(document.scopes[0]?.baseline?.historyInitialized, true);
    hasEvent = true; failing = true;
    await coordinator.runForeground();
    assert.equal(posted.length, 1);
    assert.equal(document.events[0]?.fact.kind, 'transaction-confirmed');
    failing = false;
    await coordinator.runForeground();
    assert.equal(posted.length, 1);
  });
}

test('first partial history cannot initialize a notification baseline', async t => {
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => new URL(String(url)).searchParams.get('action') === 'tokentx'
    ? new Response(null, { status: 503 }) : Response.json({ status: '1', result: [] }));
  await assert.rejects(createNotificationReader()(scope(), null, new AbortController().signal, () => {}), /observations unavailable/);
});

test('losing the receipt feed for an unchanged mined token transfer does not post new activity', async t => {
  let document = emptyNotificationDocument(), sequence = 0, failing = false, reads = 0;
  const posted: string[] = [], selected = scope();
  const event = { hash: `0x${'ab'.repeat(32)}`, from: `0x${'22'.repeat(20)}`, to: selected.accountAddress,
    blockNumber: '123', blockHash: `0x${'44'.repeat(32)}`, timeStamp: '1700000000', value: '7',
    contractAddress: `0x${'33'.repeat(20)}`, tokenSymbol: 'TEST', tokenDecimal: '18' };
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    reads++; const feed = new URL(String(url)).searchParams.get('action');
    if (failing && feed === 'txlist') return new Response(null, { status: 503 });
    return Response.json({ status: '1', message: 'OK', result: [{ ...event, ...(feed === 'txlist' ? { txreceipt_status: '1' } : {}) }] });
  });
  const coordinator = new NativeNotificationCoordinator({
    store: { initialize: async () => {}, transact: async (action, guard) => {
      guard(); const next = structuredClone(document); const output = await action(next); guard(); document = next; return output;
    } },
    delivery: { permission: async () => 'granted', backgroundStatus: async () => 'available',
      register: async () => {}, unregister: async () => {}, post: async id => { posted.push(id); },
      remove: async () => {}, prune: async () => {} },
    normalize: normalizeNotificationScope, factScope: notificationFactScope, read: createNotificationReader(),
    randomId: () => `pali-alert-${(++sequence).toString(16).padStart(32, '0')}`, now: () => 1700000010000,
  });
  await coordinator.load(); await coordinator.enable([selected], () => {}, { requestPermission: true });
  assert.equal(reads, 2); assert.equal(posted.length, 0);
  assert.equal(document.scopes[0]?.baseline?.transactions[0]?.status, 'confirmed');
  failing = true; await coordinator.runForeground();
  assert.equal(reads, 4); assert.equal(posted.length, 0); assert.equal(document.events.length, 0);
  assert.equal(document.scopes[0]?.baseline?.transactions[0]?.status, 'confirmed');
  failing = false; await coordinator.runForeground();
  assert.equal(reads, 6); assert.equal(posted.length, 0);
});
