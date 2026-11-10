import { AsyncMutex } from '../utils/asyncMutex';

import {
  createBrowserLocalPasskeyStorage,
  LOCAL_PASSKEY_STORAGE_KEY,
} from './browserLocalPasskeyStorage';
import type { DeviceUnlockCredentialScope } from './deviceUnlockEnrollment';
import type { LocalPasskeyRecord } from './localPasskeyCredential';
import { localPasskeyBase64 } from './localPasskeyTypes';

const origin = `chrome-extension://${'a'.repeat(32)}`;
const check = () => undefined;
const record = (scope: DeviceUnlockCredentialScope): LocalPasskeyRecord => ({
  version: 1,
  scope,
  origin,
  credentialId: 'AQID',
  prfSalt: localPasskeyBase64(new Uint8Array(32)),
  publicKey: localPasskeyBase64(new Uint8Array(91)),
  envelope: `v1:${'0'.repeat(24)}:${'0'.repeat(96)}`,
});
function fixture() {
  let stored: unknown;
  let pair: string | null = '1'.repeat(64);
  let ids = 0;
  let lost = false;
  let afterSet: (() => void) | undefined;
  const mutex = new AsyncMutex();
  const storage = {
    get: jest.fn(async () =>
      stored === undefined
        ? {}
        : { [LOCAL_PASSKEY_STORAGE_KEY]: structuredClone(stored) }
    ),
    set: jest.fn(async (value: Record<string, unknown>) => {
      stored = structuredClone(value[LOCAL_PASSKEY_STORAGE_KEY]);
      afterSet?.();
      if (lost) {
        lost = false;
        throw new Error('lost acknowledgement');
      }
    }),
  } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  const create = () =>
    createBrowserLocalPasskeyStorage({
      storage,
      origin,
      assertCurrent: check,
      runExclusive: (work) => mutex.runExclusive(work),
      randomId: () => (++ids).toString(16).padStart(32, '0'),
      readVaultPair: async () =>
        pair === null ? null : { pairFingerprint: pair },
    });
  return {
    create,
    storage,
    get stored() {
      return structuredClone(stored);
    },
    setPair(value: string | null) {
      pair = value;
    },
    loseAck() {
      lost = true;
    },
    afterSet(value?: () => void) {
      afterSet = value;
    },
  };
}

it('stages an encrypted record before a one-use activation and never removes an active credential', async () => {
  const f = fixture(),
    store = f.create(),
    before = (await store.enrollment.read())!;
  const scope = { ...before, enrollmentId: 'a'.repeat(32) };
  const value = record(scope);
  await store.credentials.stage(scope, value, check);
  expect((await store.enrollment.read())!.enrollmentId).toBeNull();
  expect(
    await store.enrollment.compareAndSet(before, scope.enrollmentId, check)
  ).toBe(true);
  expect(await store.credentials.read(scope)).toEqual(value);
  expect(
    await store.enrollment.compareAndSet(before, scope.enrollmentId, check)
  ).toBe(false);
  await expect(store.credentials.remove(scope, check)).rejects.toThrow();
  const active = (await store.enrollment.read())!;
  expect(await store.enrollment.compareAndSet(active, null, check)).toBe(true);
  await store.credentials.remove(scope, check);
  expect(await store.credentials.read(scope)).toBeUndefined();
});

it('captures caller scope and record before entering asynchronous persistence', async () => {
  const f = fixture(),
    store = f.create(),
    before = (await store.enrollment.read())!;
  const scope = { ...before, enrollmentId: 'b'.repeat(32) },
    value = record(scope);
  const pending = store.credentials.stage(scope, value, check);
  scope.enrollmentId = 'c'.repeat(32);
  (value as { envelope: string }).envelope = 'changed';
  await pending;
  const original = { ...before, enrollmentId: 'b'.repeat(32) };
  expect(await store.credentials.read(original)).toEqual(record(original));
});

it('a pair replacement revokes old wrappers while preserving only installation identity', async () => {
  const f = fixture(),
    store = f.create(),
    before = (await store.enrollment.read())!;
  const scope = { ...before, enrollmentId: 'a'.repeat(32) };
  await store.credentials.stage(scope, record(scope), check);
  await store.enrollment.compareAndSet(before, scope.enrollmentId, check);
  f.setPair('2'.repeat(64));
  const next = (await store.enrollment.read())!;
  expect(next.installationId).toBe(before.installationId);
  expect(next.walletBindingId).not.toBe(before.walletBindingId);
  expect(next.enrollmentId).toBeNull();
  expect(await store.credentials.read(scope)).toBeUndefined();
  expect(
    await store.enrollment.compareAndSet(
      { ...before, enrollmentId: scope.enrollmentId },
      null,
      check
    )
  ).toBe(false);
  expect(JSON.stringify(f.stored)).not.toContain(scope.enrollmentId);
});

it('a missing wallet and explicit invalidation cannot leave an active enrollment', async () => {
  const f = fixture(),
    store = f.create(),
    before = (await store.enrollment.read())!;
  const scope = { ...before, enrollmentId: 'a'.repeat(32) };
  await store.credentials.stage(scope, record(scope), check);
  await store.enrollment.compareAndSet(before, scope.enrollmentId, check);
  await store.invalidate(check);
  expect((await store.enrollment.read())!.enrollmentId).toBeNull();
  f.setPair(null);
  expect(await store.enrollment.read()).toBeNull();
  expect(await store.credentials.read(scope)).toBeUndefined();
});

it('unknown write acknowledgement requires a fresh owner without compensating deletion', async () => {
  const f = fixture(),
    store = f.create(),
    before = (await store.enrollment.read())!;
  const scope = { ...before, enrollmentId: 'a'.repeat(32) };
  await store.credentials.stage(scope, record(scope), check);
  f.loseAck();
  await expect(
    store.enrollment.compareAndSet(before, scope.enrollmentId, check)
  ).rejects.toThrow('lost acknowledgement');
  await expect(
    Promise.resolve().then(() => store.enrollment.read())
  ).rejects.toThrow();
  const fresh = f.create();
  expect((await fresh.enrollment.read())!.enrollmentId).toBe(
    scope.enrollmentId
  );
  expect(await fresh.credentials.read(scope)).toEqual(record(scope));
});

it('cancellation after persistence cannot activate or erase another owner on retry', async () => {
  const f = fixture(),
    store = f.create(),
    before = (await store.enrollment.read())!;
  const scope = { ...before, enrollmentId: 'a'.repeat(32) };
  await store.credentials.stage(scope, record(scope), check);
  let live = true;
  f.afterSet(() => {
    live = false;
  });
  await expect(
    store.enrollment.compareAndSet(before, scope.enrollmentId, () => {
      if (!live) throw Error('retired');
    })
  ).rejects.toThrow('retired');
  await expect(
    Promise.resolve().then(() => store.enrollment.read())
  ).rejects.toThrow();
  f.afterSet();
  expect((await f.create().enrollment.read())!.enrollmentId).toBe(
    scope.enrollmentId
  );
});

it('rejects accessor scopes without invoking the accessor or writing storage', async () => {
  const f = fixture(),
    store = f.create(),
    before = (await store.enrollment.read())!;
  const getter = jest.fn(() => 'a'.repeat(32));
  const scope = { ...before, enrollmentId: 'a'.repeat(32) };
  Object.defineProperty(scope, 'enrollmentId', {
    get: getter,
    enumerable: true,
  });
  const writes = (f.storage.set as jest.Mock).mock.calls.length;
  expect(() => store.credentials.read(scope)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect((f.storage.set as jest.Mock).mock.calls.length).toBe(writes);
});
