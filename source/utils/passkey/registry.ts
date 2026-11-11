import type { PasskeyRegistrationResult } from './webauthn';
import type { IPasskeyCredentialProfile } from '../../types/network.ts';

// Durable (localStorage) registry of WebAuthn credentials per smart account.
// Records only hold public material (credential id, public key) — no secrets.
// Purpose:
// - reuse-first rotation: rotating back to the passkey validator reuses the
//   recorded credential instead of minting a new passkey every time;
// - idempotent creation: a credential minted right before an on-chain step is
//   recorded as "pending" so a failed/rejected flow can retry with the same
//   passkey instead of leaving an orphan and creating another.

export type PasskeyPendingRecord = {
  createdAt: number;
  profile: IPasskeyCredentialProfile;
};

export type PasskeyAccountRecords = {
  active?: IPasskeyCredentialProfile;
  pending?: PasskeyPendingRecord;
};

const ACCOUNT_RECORDS_KEY_PREFIX = 'pali-smart-account-passkey:v1:';
export const PASSKEY_CREATION_PENDING_KEY =
  'pali-smart-account-passkey:v1:creation-pending';

export const passkeyAccountRecordsKey = (accountAddress: string): string =>
  `${ACCOUNT_RECORDS_KEY_PREFIX}${accountAddress.toLowerCase()}`;

/** Same public record transitions for browser and protected native storage. */
export const withPendingPasskey = (
  records: PasskeyAccountRecords,
  profile: IPasskeyCredentialProfile,
  createdAt = Date.now()
): PasskeyAccountRecords => ({
  ...records,
  pending: { createdAt, profile },
});
export const withActivePasskey = (
  profile: IPasskeyCredentialProfile
): PasskeyAccountRecords => ({ active: profile });

const getLocalStorage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

const readJson = <T>(key: string): T | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  const raw = storage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const removeKey = (key: string) => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(key);
};

export const passkeyRegistrationToProfile = (
  credential: PasskeyRegistrationResult,
  passkeyName: string
): IPasskeyCredentialProfile => ({
  backupStatus: credential.backupStatus,
  credentialId: credential.credentialId,
  credentialIdHash: credential.credentialIdHash,
  passkeyName,
  publicKey: {
    originHash: credential.originHash,
    originLength: credential.originLength,
    rpIdHash: credential.rpIdHash,
    x: credential.x,
    y: credential.y,
  },
  userHandle: credential.userHandle,
});

export const getPasskeyAccountRecords = (
  accountAddress: string
): PasskeyAccountRecords =>
  readJson<PasskeyAccountRecords>(passkeyAccountRecordsKey(accountAddress)) ||
  {};

export const setActivePasskeyRecord = (
  accountAddress: string,
  profile: IPasskeyCredentialProfile
) =>
  writeJson(
    passkeyAccountRecordsKey(accountAddress),
    withActivePasskey(profile)
  );

export const setPendingPasskeyRecord = (
  accountAddress: string,
  profile: IPasskeyCredentialProfile
) => {
  const records = getPasskeyAccountRecords(accountAddress);
  return writeJson(
    passkeyAccountRecordsKey(accountAddress),
    withPendingPasskey(records, profile)
  );
};

export const clearPasskeyAccountRecords = (accountAddress: string) => {
  removeKey(passkeyAccountRecordsKey(accountAddress));
};

export const clearPendingPasskeyRecord = (accountAddress: string) => {
  const records = getPasskeyAccountRecords(accountAddress);
  if (!records.pending) {
    return;
  }
  delete records.pending;
  if (records.active) {
    writeJson(passkeyAccountRecordsKey(accountAddress), records);
  } else {
    removeKey(passkeyAccountRecordsKey(accountAddress));
  }
};

// Account-creation flows mint the passkey before the smart account address is
// final, so the pending record is kept in a single slot until the account
// exists and the record can be promoted under its address.
export const getPendingCreationPasskey = (): PasskeyPendingRecord | null =>
  readJson<PasskeyPendingRecord>(PASSKEY_CREATION_PENDING_KEY);

export const setPendingCreationPasskey = (profile: IPasskeyCredentialProfile) =>
  writeJson(PASSKEY_CREATION_PENDING_KEY, { createdAt: Date.now(), profile });

export const clearPendingCreationPasskey = (credentialId?: string) => {
  if (
    credentialId &&
    getPendingCreationPasskey()?.profile.credentialId !== credentialId
  ) {
    return;
  }
  removeKey(PASSKEY_CREATION_PENDING_KEY);
};
