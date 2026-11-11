import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { notificationCapabilities } from '../src/notifications/capabilities.ts';
import type { NativeNotificationScope } from '../src/notifications/types.ts';
import { createNativeNetwork, getNativeNetwork } from '../src/custody/networkContext.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { createGuardianRecoveryFixture, GUARDIAN_FIXTURE_ACCOUNT } from './native-watch-ui/guardianRecoveryFixture.ts';
import { GUARDIAN_FIXTURE_RUNTIME } from './guardianRecoveryRuntime.ts';

// Node selects the web test adapter; Metro retains its native platform resolution.
const readerUrl = new URL('../src/notifications/reader.ts', import.meta.url).href;
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL === readerUrl && specifier === '../platform/http' ? '../platform/http.ts' : specifier, context);
} });
const { createNotificationReader } = await import(readerUrl) as typeof import('../src/notifications/reader.ts');
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
