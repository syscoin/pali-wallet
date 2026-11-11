import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  captureNativePinRecord,
  type NativePinCredential,
  type NativePinCredentialPort,
  type NativePinRecord,
} from '../src/custody/pinVault.ts';

const record = captureNativePinRecord({
  version: 1,
  installationId: '11'.repeat(16),
  walletBindingId: '22'.repeat(32),
  pairFingerprint: '33'.repeat(32),
  enrollmentId: '44'.repeat(16),
  salt: '55'.repeat(16),
  verifier: '66'.repeat(64),
});
const value: NativePinCredential = {
  secret: `Pali#1:${'a1'.repeat(32)}`,
  publicKey: new Uint8Array(32).fill(0xb2),
  pepper: new Uint8Array(32).fill(0xc3),
};
const privateAlias = `pin-${record.installationId}-${record.enrollmentId}`;
const publicAlias = `${privateAlias}.public`;
const header = JSON.stringify([
  'pali.native.pin-secret.v1', record.installationId, record.walletBindingId,
  record.pairFingerprint, record.enrollmentId,
]);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const current = () => undefined;
type Call = { kind: 'get' | 'set' | 'delete'; name: string; options: Record<string, unknown>; value?: string };

/** Exercise the production adapter; only Expo's OS storage bridge is replaced. */
function fixture() {
  const items = new Map<string, string>(), calls: Call[] = [];
  const deleteFailures = new Map<string, number>();
  let afterRead = (_name: string) => undefined;
  let afterWrite = (_name: string) => undefined;
  let readOverride: ((name: string) => string | null | undefined) | undefined;
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'test-device-only',
    async getItemAsync(name: string, options: Record<string, unknown>) {
      calls.push({ kind: 'get', name, options: { ...options } });
      afterRead(name);
      const replacement = readOverride?.(name);
      return replacement === undefined ? items.get(name) ?? null : replacement;
    },
    async setItemAsync(name: string, raw: string, options: Record<string, unknown>) {
      calls.push({ kind: 'set', name, value: raw, options: { ...options } });
      items.set(name, raw);
      afterWrite(name);
    },
    async deleteItemAsync(name: string, options: Record<string, unknown>) {
      calls.push({ kind: 'delete', name, options: { ...options } });
      const failures = deleteFailures.get(name) ?? 0;
      if (failures) {
        deleteFailures.set(name, failures - 1);
        throw Error('SYNTHETIC_DELETE_REFUSAL');
      }
      items.delete(name);
    },
  };
  const dependencies: Record<string, unknown> = {
    'expo-secure-store': secureStore,
    '../custody/pinVault.ts': { captureNativePinRecord },
  };
  const source = ts.transpileModule(
    readFileSync(new URL('../src/platform/pinCredential.native.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} as { createNativePinCredentialPort(): NativePinCredentialPort } };
  runInNewContext(source, {
    module, exports: module.exports, Uint8Array, JSON,
    require(name: string) {
      assert(Object.hasOwn(dependencies, name), `Unexpected adapter import: ${name}`);
      return dependencies[name];
    },
  });
  return {
    port: module.exports.createNativePinCredentialPort(), items, calls,
    failDelete(name: string) { deleteFailures.set(name, 1); },
    onRead(callback: (name: string) => undefined) { afterRead = callback; },
    onWrite(callback: (name: string) => undefined) { afterWrite = callback; },
    readAs(callback: (name: string) => string | null | undefined) { readOverride = callback; },
  };
}
const operations = (calls: Call[]) => calls.map(({ kind, name }) => `${kind}:${name}`);

test('native PIN staging separates public credentials from the reusable spending secret', async () => {
  const f = fixture();
  await f.port.stage(record, value, current);
  assert.deepEqual(operations(f.calls), [
    `set:${publicAlias}`, `set:${privateAlias}`, `get:${publicAlias}`, `get:${privateAlias}`,
  ]);
  assert.equal(f.items.size, 2);
  assert.deepEqual(JSON.parse(f.items.get(publicAlias)!), [header, hex(value.publicKey), hex(value.pepper)]);
  assert.deepEqual(JSON.parse(f.items.get(privateAlias)!), [header, value.secret]);
  assert(!f.items.get(publicAlias)!.includes(value.secret));
  assert(!f.items.get(publicAlias)!.includes(value.secret.slice('Pali#1:'.length)));
  assert.deepEqual(value.publicKey, new Uint8Array(32).fill(0xb2));
  assert.deepEqual(value.pepper, new Uint8Array(32).fill(0xc3));
  for (const call of f.calls) assert.deepEqual(call.options, {
    keychainService: 'org.pali.mobile.local-pin.v1',
    keychainAccessible: 'test-device-only',
    requireAuthentication: false,
  });
});

test('public credential reads never fetch the private alias or return spending bytes', async () => {
  const f = fixture();
  await f.port.stage(record, value, current);
  f.calls.length = 0;
  f.onRead(name => { assert.equal(name, publicAlias, 'Public read crossed into spending storage'); });
  const first = await f.port.readPublic(record, current);
  assert(first);
  assert.deepEqual(Object.keys(first).sort(), ['pepper', 'publicKey']);
  assert.deepEqual(first.publicKey, value.publicKey);
  assert.deepEqual(first.pepper, value.pepper);
  assert(!JSON.stringify(first).includes(value.secret));
  first.publicKey.fill(0); first.pepper.fill(0);
  const second = await f.port.readPublic(record, current);
  assert.deepEqual(second?.publicKey, value.publicKey);
  assert.deepEqual(second?.pepper, value.pepper);
  assert.deepEqual(operations(f.calls), [`get:${publicAlias}`, `get:${publicAlias}`]);
  second?.publicKey.fill(0); second?.pepper.fill(0);
  f.onRead(current);
  f.calls.length = 0;
  assert.equal(await f.port.readSecret(record, current), value.secret);
  assert.deepEqual(operations(f.calls), [`get:${privateAlias}`]);
});

test('missing public credentials never fall back to a retained private or legacy row', async () => {
  const f = fixture();
  f.items.set(privateAlias, JSON.stringify([header, value.secret, hex(value.pepper)]));
  assert.equal(await f.port.readPublic(record, current), null);
  assert.deepEqual(operations(f.calls), [`get:${publicAlias}`]);
  f.items.delete(privateAlias);
  f.items.set(publicAlias, JSON.stringify([header, hex(value.publicKey), hex(value.pepper)]));
  f.calls.length = 0;
  assert.equal(await f.port.readSecret(record, current), null);
  assert.deepEqual(operations(f.calls), [`get:${privateAlias}`]);
});

test('both credential rows reject another installation, wallet, pair or enrollment header', async () => {
  for (const field of ['installationId', 'walletBindingId', 'pairFingerprint', 'enrollmentId'] as const) {
    const f = fixture();
    await f.port.stage(record, value, current);
    const changed = { ...record, [field]: '7'.repeat(record[field].length) };
    const publicRaw = f.items.get(publicAlias)!, privateRaw = f.items.get(privateAlias)!;
    f.readAs(name => name.endsWith('.public') ? publicRaw : privateRaw);
    f.calls.length = 0;
    await assert.rejects(f.port.readPublic(changed, current), { message: 'PIN_UNAVAILABLE' });
    assert(f.calls.every(call => call.name.endsWith('.public')));
    f.calls.length = 0;
    await assert.rejects(f.port.readSecret(changed, current), { message: 'PIN_UNAVAILABLE' });
    assert(f.calls.every(call => !call.name.endsWith('.public')));
  }
});

test('malformed stored public and private records fail closed without cross-alias fallback', async () => {
  const publicRows: unknown[] = [null, {}, [], [header, hex(value.publicKey)],
    [header, value.secret, hex(value.pepper)], [header, 'B2'.repeat(32), hex(value.pepper)],
    [header, 'b2'.repeat(31), hex(value.pepper)], [header, hex(value.publicKey), 'c3'.repeat(33)],
    [header, [], hex(value.pepper)], [header, hex(value.publicKey), 1]];
  const privateRows: unknown[] = [null, {}, [], [header], [header, value.secret, hex(value.pepper)],
    [header, `Pali#1:${'A1'.repeat(32)}`], [header, `Pali#1:${'a1'.repeat(31)}`], [header, 1]];
  for (const [alias, rows, read] of [
    [publicAlias, publicRows, 'readPublic'], [privateAlias, privateRows, 'readSecret'],
  ] as const) {
    for (const raw of ['not JSON', ...rows.map(row => JSON.stringify(row))]) {
      const f = fixture(); f.items.set(alias, raw);
      await assert.rejects(f.port[read](record, current));
      assert.deepEqual(operations(f.calls), [`get:${alias}`]);
    }
  }
});

test('malformed record scopes and accessor fields fail before OS storage access', async () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({ ...record }, 'installationId', {
    get() { getterCalls++; throw Error('Accessor must not run'); },
  });
  for (const input of [null, [], { ...record, version: 2 }, { ...record, extra: true },
    { ...record, enrollmentId: 'invalid' }, accessor]) {
    const f = fixture(), invalid = input as NativePinRecord;
    await assert.rejects(f.port.readPublic(invalid, current));
    await assert.rejects(f.port.readSecret(invalid, current));
    await assert.rejects(f.port.stage(invalid, value, current));
    await assert.rejects(f.port.remove(invalid));
    assert.deepEqual(f.calls, []);
  }
  assert.equal(getterCalls, 0);
});

test('malformed staged credentials never write either OS alias or invoke value accessors', async () => {
  let getterCalls = 0;
  const inputs: unknown[] = [null, [], {}, Object.create(value),
    { ...value, extra: true }, { ...value, secret: value.secret.toUpperCase() },
    { ...value, secret: `Pali#1:${'a1'.repeat(31)}` }, { ...value, secret: 1 }];
  for (const field of ['publicKey', 'pepper'] as const) {
    inputs.push({ ...value, [field]: new Uint8Array(31) });
    inputs.push({ ...value, [field]: new Uint8Array(33) });
    inputs.push({ ...value, [field]: Array(32).fill(1) });
    const oversized = new Uint8Array(71);
    Object.defineProperty(oversized, 'length', { value: 32 });
    inputs.push({ ...value, [field]: oversized });
    const Key = class extends Uint8Array {};
    Object.defineProperty(Key.prototype, 'length', { get: () => 32 });
    inputs.push({ ...value, [field]: new Key(71) });
  }
  for (const field of ['secret', 'publicKey', 'pepper'] as const) {
    inputs.push(Object.defineProperty({ ...value }, field, {
      get() { getterCalls++; throw Error('Credential accessor must not run'); },
    }));
  }
  for (const input of inputs) {
    const f = fixture();
    await assert.rejects(f.port.stage(record, input as NativePinCredential, current));
    assert.deepEqual(f.calls, []);
    assert.equal(f.items.size, 0);
  }
  assert.equal(getterCalls, 0);
});

test('staging rechecks ownership after capturing credential data and before writing', async () => {
  const f = fixture();
  let live = true;
  const input = new Proxy(value, {
    ownKeys(target) { live = false; return Reflect.ownKeys(target); },
  });
  await assert.rejects(f.port.stage(record, input, () => {
    if (!live) throw Error('CANCELLED');
  }), { message: 'CANCELLED' });
  assert.deepEqual(f.calls, []);
  assert.equal(f.items.size, 0);
});

test('revoked or asynchronous guards cannot return public credentials or acknowledge staging', async () => {
  const f = fixture();
  await f.port.stage(record, value, current);
  f.calls.length = 0;
  await assert.rejects(f.port.readPublic(record, async () => undefined), { message: 'PIN_UNAVAILABLE' });
  assert.deepEqual(f.calls, []);
  let live = true;
  const check = () => { if (!live) throw Error('CANCELLED'); };
  f.onRead(() => { live = false; });
  await assert.rejects(f.port.readPublic(record, check), { message: 'CANCELLED' });
  assert.deepEqual(operations(f.calls), [`get:${publicAlias}`]);
  f.calls.length = 0; live = true; f.onRead(current);
  f.onWrite(() => { live = false; });
  await assert.rejects(f.port.stage(record, value, check), { message: 'CANCELLED' });
  assert.deepEqual(operations(f.calls), [`set:${publicAlias}`]);
});

for (const failedAlias of [privateAlias, publicAlias]) test(`credential cleanup retries safely after ${failedAlias.endsWith('.public') ? 'public' : 'private'} deletion fails`, async () => {
  const f = fixture();
  await f.port.stage(record, value, current);
  f.calls.length = 0; f.failDelete(failedAlias);
  await assert.rejects(f.port.remove(record), { message: 'SYNTHETIC_DELETE_REFUSAL' });
  assert.equal(f.items.has(privateAlias), failedAlias === privateAlias);
  assert.equal(f.items.has(publicAlias), true);
  assert.deepEqual(operations(f.calls), failedAlias === privateAlias
    ? [`delete:${privateAlias}`] : [`delete:${privateAlias}`, `delete:${publicAlias}`]);
  f.calls.length = 0;
  await f.port.remove(record);
  assert.deepEqual(operations(f.calls), [`delete:${privateAlias}`, `delete:${publicAlias}`]);
  assert.equal(f.items.size, 0);
  await f.port.remove(record);
  assert.equal(f.items.size, 0);
});

test('staging refuses a mismatched readback without fetching an unrequested credential', async () => {
  const f = fixture();
  f.readAs(name => name.endsWith('.public') ? 'changed readback' : undefined);
  await assert.rejects(f.port.stage(record, value, current), { message: 'PIN_UNAVAILABLE' });
  assert.deepEqual(operations(f.calls), [
    `set:${publicAlias}`, `set:${privateAlias}`, `get:${publicAlias}`,
  ]);
});
