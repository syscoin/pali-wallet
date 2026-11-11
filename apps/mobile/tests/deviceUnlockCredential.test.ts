import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceUnlockCredentialStore, isNativeDeviceUnlockRefusal } from '../src/storage/deviceUnlockCredential.ts';
import { deviceUnlockUserRefusal, isDeviceUnlockUserRefusal } from '../../../source/wallet/deviceUnlockEnrollment.ts';

const scope = Object.freeze({ installationId: '11'.repeat(16), walletBindingId: '22'.repeat(32),
  pairFingerprint: '33'.repeat(32), enrollmentId: '44'.repeat(16) });
const alias = `enrollment-${scope.enrollmentId}`;
const current = () => undefined;
const unavailable = { message: 'DEVICE_UNLOCK_UNAVAILABLE' };

function fixture() {
  const items = new Map<string, string>(), calls: string[] = [];
  let result: string | undefined;
  let error: Error | undefined;
  let afterWrite = current as () => void;
  let afterRead = current as () => void;
  const store = createDeviceUnlockCredentialStore({
    async available() { if (error) throw error; return true; },
    async write(name, value) { calls.push(`write:${name}`); items.set(name, value); afterWrite(); },
    async read(name) { calls.push(`read:${name}`); afterRead(); if (error) throw error; return result ?? items.get(name) ?? null; },
    async remove(name) { calls.push(`remove:${name}`); items.delete(name); },
  });
  return { store, items, calls, readAs(value: string) { result = value; },
    failWith(value: Error) { error = value; },
    onWrite(operation: () => void) { afterWrite = operation; },
    onRead(operation: () => void) { afterRead = operation; } };
}

test('stage verifies the protected readback before a fresh wallet credential can be used', async () => {
  const { store, items, calls } = fixture();
  const key = Uint8Array.from({ length: 32 }, (_, index) => index);
  assert.equal(await store.available(), true);
  assert.equal(await store.read(scope, current, null), null);
  await store.stage(scope, key, current, null);
  assert.deepEqual(calls, [`read:${alias}`, `write:${alias}`, `read:${alias}`]);
  assert.equal(items.size, 1);
  const resumed = await store.read(scope, current, null);
  assert.deepEqual(resumed, key);
  resumed!.fill(0);
  assert.deepEqual(await store.read(scope, current, null), key);
  await store.remove(scope, current);
  assert.equal(await store.read(scope, current, null), null);
});

test('a valid key from another installation, binding, pair or enrollment is rejected', async () => {
  const f = fixture();
  await f.store.stage(scope, new Uint8Array(32).fill(7), current, null);
  f.readAs(f.items.get(alias)!);
  for (const field of ['installationId', 'walletBindingId', 'pairFingerprint', 'enrollmentId'] as const)
    await assert.rejects(f.store.read({ ...scope, [field]: '5'.repeat(scope[field].length) }, current, null), unavailable);
  f.readAs(f.items.get(alias)! + '0');
  await assert.rejects(f.store.read(scope, current, null), unavailable);
  const before = f.calls.length;
  await assert.rejects(f.store.stage({ ...scope, enrollmentId: 'not an alias' }, new Uint8Array(32), current, null), unavailable);
  assert.equal(f.calls.length, before);
});

test('revocation during platform work returns no key and never confirms staged bytes', async () => {
  const f = fixture();
  let live = true;
  const guard = () => { if (!live) throw Error('CANCELLED'); };
  f.onWrite(() => { live = false; });
  await assert.rejects(f.store.stage(scope, new Uint8Array(32), guard, null), { message: 'CANCELLED' });
  assert.deepEqual(f.calls, [`write:${alias}`]);
  live = true;
  f.onRead(() => { live = false; });
  await assert.rejects(f.store.read(scope, guard, null), { message: 'CANCELLED' });
  await assert.rejects(f.store.read(scope, async () => undefined, null), unavailable);
  assert.deepEqual(f.calls, [`write:${alias}`, `read:${alias}`]);
});

test('altered readback and native failures do not confirm enrollment or expose the cause', async () => {
  const f = fixture();
  f.readAs('different value');
  await assert.rejects(f.store.stage(scope, new Uint8Array(32), current, null), unavailable);
  f.failWith(Error('fixture platform diagnostic contains private data'));
  assert.equal(await f.store.available(), false);
  await assert.rejects(f.store.read(scope, current, null), unavailable);
});

test('only explicit native authentication errors are classified as retryable refusals', () => {
  for (const [platform, code, message] of [
    ['ios', 'ERR_KEY_CHAIN', 'User canceled the operation.'],
    ['ios', 'ERR_KEY_CHAIN', 'Authentication failed. Provided passphrase/PIN is incorrect or there is no user authentication method configured for this device.'],
    ['android', 'ERR_AUTHENTICATION', 'Could not authenticate the user: User canceled the authentication. Cancelled'],
    ['android', 'ERR_AUTHENTICATION', 'Could not authenticate the user: Lockout. Try later'],
  ]) assert.equal(isNativeDeviceUnlockRefusal(platform!, Object.assign(new Error(message), { code })), true);
  for (const error of [
    Object.assign(Error('User canceled the operation.'), { code: 'ERR_DECRYPT' }),
    Object.assign(Error('Unable to decode the provided data.'), { code: 'ERR_KEY_CHAIN' }),
    Object.assign(Error('I/O error.'), { code: 'ERR_KEY_CHAIN' }),
    Object.assign(Error('Could not authenticate the user: Unknown error (code: 99). Unknown'), { code: 'ERR_AUTHENTICATION' }),
    { get code(): never { return assert.fail('Must not execute error accessors'); } },
  ]) {
    assert.equal(isNativeDeviceUnlockRefusal('ios', error), false);
    assert.equal(isNativeDeviceUnlockRefusal('android', error), false);
  }
});

test('protected storage preserves only the private refusal brand, not a matching public message', async () => {
  const f = fixture(); f.failWith(deviceUnlockUserRefusal());
  await assert.rejects(f.store.read(scope, current, null), error => isDeviceUnlockUserRefusal(error));
  f.failWith(Error('DEVICE_UNLOCK_UNAVAILABLE'));
  await assert.rejects(f.store.read(scope, current, null), error => !isDeviceUnlockUserRefusal(error));
});
