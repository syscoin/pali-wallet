import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePasskeyRegistry, inspectNativePasskeyStorageRecord } from '../src/smartAccount/passkeyRegistry.ts';
import { buildP256WebAuthnAuthenticator } from '../../../source/utils/smartAccount/authenticators.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import { passkeyAccountRecordsKey, PASSKEY_CREATION_PENDING_KEY } from '../../../source/utils/passkey/registry.ts';
import { encodeStorageValue } from '../src/storage/json.ts';

const account = '0x' + '11'.repeat(20);
const profile = { credentialId: 'AQ', credentialIdHash: '0x' + '01'.repeat(32), passkeyName: 'Pali Smart account',
  publicKey: { x: '0x' + '02'.repeat(32), y: '0x' + '03'.repeat(32), rpIdHash: '0x' + '04'.repeat(32), originHash: '0x' + '05'.repeat(32), originLength: 22 } };
function fixture() {
  const data = new Map<string, unknown>();
  let live = true, pause: (() => void) | undefined;
  const check = () => { assert(live, 'CANCELLED'); };
  const storage = { get: async (key: string) => data.get(key),
    compareAndSetMany: async (changes: { key: string; expected: unknown; value: unknown }[], guard: () => void) => {
      pause?.(); guard();
      if (changes.some(item => data.get(item.key) !== item.expected)) return false;
      for (const item of changes) data.set(item.key, item.value);
      return true;
    } } as unknown as KeyringStoragePort;
  return { data, check, registry: createNativePasskeyRegistry(storage), cancelAtCommit() { pause = () => { live = false; }; } };
}
test('native pending profiles use the shared keys and survive re-opening before canonical activation', async () => {
  const f = fixture();
  await f.registry.savePending(account, profile, f.check);
  assert.deepEqual(f.data.get(passkeyAccountRecordsKey(account)), { pending: { createdAt: (f.data.get(passkeyAccountRecordsKey(account)) as any).pending.createdAt, profile } });
  assert.deepEqual((await f.registry.read(account, f.check)).pending?.profile, profile);
  const built = buildP256WebAuthnAuthenticator({ chainId: 1, config: profile });
  const metadata = { ...built.metadata, chainId: 1, auth: built.auth, contractVersion: '1', deploymentSalt: '0x00', isDeployed: true };
  await f.registry.activateObserved(account, { ...metadata, auth: { ...built.auth, data: '0x' } }, f.check);
  assert((await f.registry.read(account, f.check)).pending);
  await f.registry.activateObserved(account, metadata, f.check);
  assert.deepEqual(await f.registry.read(account, f.check), { active: profile });
});
test('cancelled native profile writes are refused at the protected commit', async () => {
  const f = fixture(); f.cancelAtCommit();
  await assert.rejects(f.registry.savePending(account, profile, f.check), /CANCELLED/);
  assert.equal(f.data.size, 0);
});
test('pending creation profiles are reused from the same shared record format', async () => {
  const f = fixture(); await f.registry.saveCreation(profile, f.check);
  assert.deepEqual((await f.registry.creation(f.check))?.profile, profile);
  await f.registry.transferCreation(account, profile, f.check);
  assert.equal(await f.registry.creation(f.check), null);
  assert.deepEqual((await f.registry.read(account, f.check)).pending?.profile, profile);
});
test('creation handoff cannot erase a newer profile or commit after cancellation', async () => {
  const f = fixture(); await f.registry.saveCreation(profile, f.check);
  const replacement = { ...profile, credentialId: 'Ag', credentialIdHash: '0x' + '06'.repeat(32) };
  await f.registry.saveCreation(replacement, f.check);
  await assert.rejects(f.registry.transferCreation(account, profile, f.check), /Passkey creation changed/);
  assert.equal(f.data.has(passkeyAccountRecordsKey(account)), false);
  assert.deepEqual((await f.registry.creation(f.check))?.profile, replacement);
  f.cancelAtCommit();
  await assert.rejects(f.registry.transferCreation(account, replacement, f.check), /CANCELLED/);
  assert.equal(f.data.has(passkeyAccountRecordsKey(account)), false);
});

test('native passkey admission and runtime reads reject non-public or malformed fields', async () => {
  const invalidProfiles = [
    { ...profile, extraSecret: 'must not be admitted' },
    { ...profile, publicKey: { ...profile.publicKey, extra: 'unknown' } },
    { ...profile, backupStatus: 'unknown' },
  ];
  for (const invalid of invalidProfiles) {
    const f = fixture(), value = { active: invalid };
    f.data.set(passkeyAccountRecordsKey(account), value);
    await assert.rejects(f.registry.read(account, f.check), /Invalid saved passkey/);
    assert.throws(() => inspectNativePasskeyStorageRecord(passkeyAccountRecordsKey(account), encodeStorageValue(value)), /Invalid saved passkey/);
  }
  const extraPending = { createdAt: 1, profile, extraField: 'unknown' };
  const f = fixture(); f.data.set(PASSKEY_CREATION_PENDING_KEY, extraPending);
  await assert.rejects(f.registry.creation(f.check), /Invalid saved passkey/);
  assert.throws(() => inspectNativePasskeyStorageRecord(PASSKEY_CREATION_PENDING_KEY, encodeStorageValue(extraPending)), /Invalid saved passkey/);
  assert.throws(() => inspectNativePasskeyStorageRecord(passkeyAccountRecordsKey(account), encodeStorageValue({ pending: extraPending })), /Invalid saved passkey/);
});
