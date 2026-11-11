import type { IPasskeyCredentialProfile , ISmartAccountMetadata } from '../../../../source/types/network.ts';
import { PasskeyBackupStatus } from '../../../../source/types/passkey.ts';
import { passkeyAccountRecordsKey, PASSKEY_CREATION_PENDING_KEY, withActivePasskey, withPendingPasskey, type PasskeyAccountRecords, type PasskeyPendingRecord } from '../../../../source/utils/passkey/registry.ts';
import { encodeP256WebAuthnAuthData } from '../../../../source/utils/passkey/account.ts';
import type { KeyringStoragePort } from '../storage/types.ts';
import { decodeStorageValue } from '../storage/json.ts';

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getOwnPropertySymbols(value).length ||
      Object.getOwnPropertyNames(value).some(key => !required.includes(key) && !optional.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(field => !('value' in field))) throw Error('Invalid saved passkey');
}
function profile(value: unknown): IPasskeyCredentialProfile {
  fields(value, ['credentialId', 'credentialIdHash', 'passkeyName', 'publicKey'], ['backupStatus', 'userHandle']);
  fields((value as IPasskeyCredentialProfile).publicKey, ['x', 'y', 'rpIdHash', 'originHash', 'originLength']);
  const copy = JSON.parse(JSON.stringify(value)) as IPasskeyCredentialProfile;
  if (typeof copy.credentialId !== 'string' || !/^[A-Za-z0-9_-]{1,1364}$/.test(copy.credentialId) ||
      !/^0x[0-9a-f]{64}$/i.test(copy.credentialIdHash) || typeof copy.passkeyName !== 'string' ||
      copy.passkeyName.length > 120 || !copy.publicKey || !Number.isSafeInteger(copy.publicKey.originLength) ||
      copy.publicKey.originLength < 1 || copy.publicKey.originLength > 512 ||
      ['x', 'y', 'rpIdHash', 'originHash'].some(key => !/^0x[0-9a-f]{64}$/i.test(copy.publicKey[key as 'x'])) ||
      (copy.backupStatus !== undefined && !Object.values(PasskeyBackupStatus).includes(copy.backupStatus)) ||
      (copy.userHandle !== undefined && !/^[A-Za-z0-9_-]{1,86}$/.test(copy.userHandle))) throw Error('Invalid saved passkey');
  return copy;
}
function records(value: unknown): PasskeyAccountRecords {
  if (value === undefined || value === null) return {};
  fields(value, [], ['active', 'pending']);
  const row = value as PasskeyAccountRecords;
  return {
    ...(Object.hasOwn(row, 'active') ? { active: profile(row.active) } : {}),
    ...(Object.hasOwn(row, 'pending') ? { pending: pending(row.pending) } : {}),
  };
}
function pending(value: unknown): PasskeyPendingRecord {
  fields(value, ['createdAt', 'profile']);
  const row = value as PasskeyPendingRecord;
  if (!row || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw Error('Invalid saved passkey');
  return { createdAt: row.createdAt, profile: profile(row.profile) };
}

/** Admit only the shared public-profile records, never arbitrary prefixed data. */
export function inspectNativePasskeyStorageRecord(key: string, encodedValue: string): boolean {
  if (key === PASSKEY_CREATION_PENDING_KEY) { pending(decodeStorageValue(encodedValue)); return true; }
  const account = key.slice(passkeyAccountRecordsKey('').length);
  if (!/^0x[0-9a-f]{40}$/.test(account) || key !== passkeyAccountRecordsKey(account)) return false;
  const value = decodeStorageValue(encodedValue);
  if (value === undefined || value === null) throw Error('Invalid saved passkeys');
  records(value);
  return true;
}

/** Wallet-scoped encrypted database adapter for the shared public profile records. */
export function createNativePasskeyRegistry(storage: KeyringStoragePort) {
  const read = async (key: string, guard: () => void) => { guard(); const value = await storage.get(key); guard(); return value; };
  const write = async (key: string, expected: unknown, value: unknown, guard: () => void) => {
    guard();
    if (!await storage.compareAndSetMany([{ key, expected, value }], guard)) throw Error('Passkey profile changed');
    guard();
  };
  return {
    async creation(guard: () => void) {
      const value = await read(PASSKEY_CREATION_PENDING_KEY, guard);
      return value === undefined || value === null ? null : pending(value);
    },
    async saveCreation(value: IPasskeyCredentialProfile, guard: () => void) {
      const old = await read(PASSKEY_CREATION_PENDING_KEY, guard);
      await write(PASSKEY_CREATION_PENDING_KEY, old, { createdAt: Date.now(), profile: profile(value) }, guard);
    },
    async read(account: string, guard: () => void) { return records(await read(passkeyAccountRecordsKey(account), guard)); },
    async savePending(account: string, value: IPasskeyCredentialProfile, guard: () => void) {
      const key = passkeyAccountRecordsKey(account), old = await read(key, guard);
      await write(key, old, withPendingPasskey(records(old), profile(value)), guard);
    },
    async transferCreation(account: string, value: IPasskeyCredentialProfile, guard: () => void) {
      const creation = await read(PASSKEY_CREATION_PENDING_KEY, guard), captured = profile(value);
      if (!creation || JSON.stringify(pending(creation).profile) !== JSON.stringify(captured)) throw Error('Passkey creation changed');
      const key = passkeyAccountRecordsKey(account), old = await read(key, guard);
      guard();
      if (!await storage.compareAndSetMany([
        { key, expected: old, value: withPendingPasskey(records(old), captured) },
        { key: PASSKEY_CREATION_PENDING_KEY, expected: creation, value: undefined },
      ], guard)) throw Error('Passkey creation changed');
      guard();
    },
    async activateObserved(account: string, metadata: ISmartAccountMetadata, guard: () => void) {
      const key = passkeyAccountRecordsKey(account), old = await read(key, guard), saved = records(old);
      if (metadata.auth?.module !== 'p256-webauthn' || !saved.pending) return;
      if (encodeP256WebAuthnAuthData(saved.pending.profile.publicKey).toLowerCase() !== metadata.auth.data.toLowerCase()) return;
      await write(key, old, withActivePasskey(saved.pending.profile), guard);
    },
  };
}
