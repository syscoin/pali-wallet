import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceUnlockEnrollment } from '../src/custody/deviceUnlockEnrollment.ts';
import { createDeviceUnlockCredentialStore } from '../src/storage/deviceUnlockCredential.ts';
import type { DeviceUnlockEnrollmentSnapshot } from '../src/storage/types.ts';

const scope = { installationId: '11'.repeat(16), walletBindingId: '22'.repeat(32), pairFingerprint: '33'.repeat(32) };
const first = '44'.repeat(16), second = '55'.repeat(16);
const bytes = new Uint8Array(32).fill(7);
const current = () => undefined;
const retire = async () => undefined;
const unavailable = { message: 'DEVICE_UNLOCK_UNAVAILABLE' };
const name = (id: string) => `enrollment-${id}`;

function fixture() {
  let record: DeviceUnlockEnrollmentSnapshot = Object.freeze({ ...scope, enrollmentId: null });
  let nextId = first;
  let failure: 'refused' | 'ack' | null = null;
  let afterRead = current as () => void, afterWrite = current as () => void;
  let reads = 0, mutations = 0, decoded: Uint8Array | null = null;
  const items = new Map<string, string>();
  const protectedItems = createDeviceUnlockCredentialStore({
    async available() { return true; },
    async read(alias) { reads++; const item = items.get(alias) ?? null; afterRead(); return item; },
    async write(alias, raw) { items.set(alias, raw); afterWrite(); },
    async remove(alias) { items.delete(alias); },
  });
  const enrollment = {
    async read() { return record; },
    async compareAndSet(expected: DeviceUnlockEnrollmentSnapshot, enrollmentId: string | null, guard: () => void) {
      guard();
      if (expected !== record || failure === 'refused') return false;
      mutations++;
      record = Object.freeze({ ...scope, enrollmentId });
      if (failure === 'ack') throw Error('STORAGE_REOPEN_REQUIRED');
      return true;
    },
  };
  const make = () => createDeviceUnlockEnrollment({ enrollment, randomId: () => nextId, credentials: {
    ...protectedItems,
    async read(...args) { decoded = await protectedItems.read(...args); return decoded; },
  } });
  const coordinator = make();
  const prove = async (guard: () => void) => {
    await coordinator.sdkPort.writeCredential({ pairFingerprint: scope.pairFingerprint, key: bytes }, guard);
    return true;
  };
  return { coordinator, prove, items, make, get record() { return record; }, get reads() { return reads; },
    get mutations() { return mutations; }, get decoded() { return decoded; },
    choose(id: string) { nextId = id; }, fail(kind: typeof failure) { failure = kind; },
    replace(id: string) { record = Object.freeze({ ...scope, enrollmentId: id }); },
    onRead(operation: () => void) { afterRead = operation; }, onWrite(operation: () => void) { afterWrite = operation; },
  };
}

test('enrollment needs actual SDK proof and only delivers a credential within its owned resume', async () => {
  const f = fixture(), c = f.coordinator;
  assert.equal(await c.issue(async () => false, current), false);
  await assert.rejects(c.issue(async () => true, current), unavailable);
  assert.equal(f.items.size, 0);
  assert.equal(f.mutations, 0);
  assert.equal(await c.issue(f.prove, current), true);
  assert.equal(f.record.enrollmentId, first);
  assert.equal(await c.sdkPort.readCredential(scope.pairFingerprint), null);
  assert.equal(await c.resume(async () => {
    const firstRead = await c.sdkPort.readCredential(scope.pairFingerprint);
    assert.deepEqual(firstRead?.key, bytes);
    assert.equal(await c.sdkPort.readCredential(scope.pairFingerprint), null);
    firstRead!.key.fill(0); // SDK owns the delivered bytes.
    return true;
  }, current, retire), true);
  f.items.clear();
  assert.equal(await c.resume(async () => {
    assert.equal(await c.sdkPort.readCredential(scope.pairFingerprint), null);
    return true;
  }, current, retire), false);
});

test('revoked or definitively refused enrollment cleans only the new inactive alias', async () => {
  const f = fixture(), c = f.coordinator;
  assert.equal(await c.issue(f.prove, current), true);
  f.choose(second);
  let live = true;
  f.onWrite(() => { live = false; });
  await assert.rejects(c.issue(f.prove, () => { if (!live) throw Error('CANCELLED'); }), { message: 'CANCELLED' });
  assert.deepEqual([...f.items.keys()], [name(first)]);
  assert.equal(f.record.enrollmentId, first);
  f.onWrite(current);
  f.fail('refused');
  await assert.rejects(c.issue(f.prove, current), unavailable);
  assert.deepEqual([...f.items.keys()], [name(first)]);
  assert.equal(f.mutations, 1);
});

test('unacknowledged activation keeps both aliases until the durable owner can be reopened', async () => {
  const f = fixture(), c = f.coordinator;
  assert.equal(await c.issue(f.prove, current), true);
  f.choose(second);
  f.fail('ack');
  await assert.rejects(c.issue(f.prove, current), { message: 'STORAGE_REOPEN_REQUIRED' });
  assert.equal(f.record.enrollmentId, second);
  assert.deepEqual([...f.items.keys()], [name(first), name(second)]);
  f.fail(null);
  const reopened = f.make();
  assert.equal(await reopened.resume(async () => {
    const opened = await reopened.sdkPort.readCredential(scope.pairFingerprint);
    assert.deepEqual(opened?.key, bytes);
    opened!.key.fill(0);
    return true;
  }, current, retire), true);
  await reopened.disable(current);
  assert.equal(f.record.enrollmentId, null);
  assert.deepEqual([...f.items.keys()], [name(first)]);
});

test('a changed reference after OS access rejects and clears bytes before SDK delivery', async () => {
  const f = fixture(), c = f.coordinator;
  assert.equal(await c.issue(f.prove, current), true);
  f.onRead(() => f.replace(second));
  await assert.rejects(c.resume(async () => {
    await c.sdkPort.readCredential(scope.pairFingerprint);
    assert.fail('Stale credential reached the SDK');
  }, current, retire), unavailable);
  assert.deepEqual(f.decoded, new Uint8Array(32));
});

test('a reference changed during SDK proof retires the exact captured session', async () => {
  const f = fixture(), c = f.coordinator;
  let retired = 0;
  assert.equal(await c.issue(f.prove, current), true);
  await assert.rejects(c.resume(async () => {
    const read = await c.sdkPort.readCredential(scope.pairFingerprint);
    assert.deepEqual(read?.key, bytes);
    read!.key.fill(0);
    f.replace(second);
    return true;
  }, current, async () => { retired++; }), unavailable);
  assert.equal(retired, 1);
});
