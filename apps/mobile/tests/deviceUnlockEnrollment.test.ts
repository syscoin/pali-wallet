import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceUnlockEnrollment } from '../../../source/wallet/deviceUnlockEnrollment.ts';
import { createDeviceUnlockCredentialStore } from '../src/storage/deviceUnlockCredential.ts';
import type { DeviceUnlockEnrollmentSnapshot } from '../../../source/wallet/deviceUnlockEnrollment.ts';

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
  let afterRead: () => void | Promise<void> = current, afterWrite = current as () => void;
  let afterDecode = current as () => void;
  let available = true;
  let reads = 0, mutations = 0, decoded: Uint8Array | null = null;
  const items = new Map<string, string>();
  const protectedItems = createDeviceUnlockCredentialStore({
    async available() { return available; },
    async read(alias) { reads++; const item = items.get(alias) ?? null; await afterRead(); return item; },
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
    async read(...args) { decoded = await protectedItems.read(...args); afterDecode(); return decoded; },
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
    replaceReference(change: Partial<DeviceUnlockEnrollmentSnapshot>) { record = Object.freeze({ ...record, ...change }); },
    availability(value: boolean) { available = value; },
    onDecode(operation: () => void) { afterDecode = operation; },
    onRead(operation: () => void | Promise<void>) { afterRead = operation; }, onWrite(operation: () => void) { afterWrite = operation; },
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

test('presence verification reads the protected current enrollment and erases its key without SDK delivery', async () => {
  const f = fixture(), c = f.coordinator;
  await c.issue(f.prove, current);
  const record = f.record, saved = [...f.items], before = f.reads;
  assert.equal(await c.verifyPresence(current), undefined);
  assert.equal(f.reads, before + 1);
  assert.equal(f.record, record);
  assert.equal(f.mutations, 1);
  assert.deepEqual([...f.items], saved);
  assert.deepEqual(f.decoded, new Uint8Array(32));
  assert.equal(await c.sdkPort.readCredential(scope.pairFingerprint), null);
});

test('presence verification refuses disabled, unavailable, missing and failed protected credentials', async () => {
  const f = fixture(), c = f.coordinator;
  await assert.rejects(c.verifyPresence(current), unavailable);
  assert.equal(f.reads, 0);
  await c.issue(f.prove, current);
  const before = f.reads;
  f.availability(false);
  await assert.rejects(c.verifyPresence(current), unavailable);
  assert.equal(f.reads, before);
  f.availability(true);
  f.onRead(() => { throw Error('OS read failed'); });
  await assert.rejects(c.verifyPresence(current), unavailable);
  f.onRead(current);
  f.items.clear();
  await assert.rejects(c.verifyPresence(current), unavailable);
});

test('presence verification binds every enrollment field across the protected read', async () => {
  const changes: Partial<DeviceUnlockEnrollmentSnapshot>[] = [
    { installationId: '66'.repeat(16) },
    { walletBindingId: '77'.repeat(32) },
    { pairFingerprint: '88'.repeat(32) },
    { enrollmentId: second },
    { enrollmentId: null },
  ];
  for (const change of changes) {
    const f = fixture(), c = f.coordinator;
    await c.issue(f.prove, current);
    f.onRead(() => f.replaceReference(change));
    await assert.rejects(c.verifyPresence(current), unavailable);
    assert.deepEqual(f.decoded, new Uint8Array(32));
  }
});

test('revoked presence verification erases already-read bytes and rejects non-synchronous guards', async () => {
  const f = fixture(), c = f.coordinator;
  await c.issue(f.prove, current);
  let live = true;
  const check = () => { if (!live) throw Error('CANCELLED'); };
  f.onDecode(() => { live = false; });
  await assert.rejects(c.verifyPresence(check), unavailable);
  assert.deepEqual(f.decoded, new Uint8Array(32));
  const before = f.reads;
  await assert.rejects(c.verifyPresence(check), unavailable);
  await assert.rejects(c.verifyPresence(async () => undefined), unavailable);
  assert.equal(f.reads, before);
});

test('presence verification shares the single active operation with issue, resume and disable', async () => {
  const f = fixture(), c = f.coordinator;
  await c.issue(f.prove, current);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.onRead(() => { entered.resolve(); return release.promise; });
  const pending = c.verifyPresence(current);
  await entered.promise;
  await assert.rejects(c.verifyPresence(current), unavailable);
  await assert.rejects(c.issue(f.prove, current), unavailable);
  await assert.rejects(c.resume(async () => assert.fail('SDK must not run'), current, retire), unavailable);
  await assert.rejects(c.disable(current), unavailable);
  assert.equal(await c.sdkPort.readCredential(scope.pairFingerprint), null);
  release.resolve();
  await pending;
  assert.deepEqual(f.decoded, new Uint8Array(32));
  f.onRead(current);
  await c.verifyPresence(current);
});
