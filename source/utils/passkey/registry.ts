import type { IPasskeyCredentialProfile } from 'types/network';

import type { PasskeyRegistrationResult } from './webauthn';

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
const CREATION_PENDING_KEY = 'pali-smart-account-passkey:v1:creation-pending';

const accountRecordsKey = (accountAddress: string): string =>
  `${ACCOUNT_RECORDS_KEY_PREFIX}${accountAddress.toLowerCase()}`;

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
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota/serialization failures degrade to "no record" behaviour.
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
  readJson<PasskeyAccountRecords>(accountRecordsKey(accountAddress)) || {};

export const setActivePasskeyRecord = (
  accountAddress: string,
  profile: IPasskeyCredentialProfile
) => {
  writeJson(accountRecordsKey(accountAddress), { active: profile });
};

export const setPendingPasskeyRecord = (
  accountAddress: string,
  profile: IPasskeyCredentialProfile
) => {
  const records = getPasskeyAccountRecords(accountAddress);
  writeJson(accountRecordsKey(accountAddress), {
    ...records,
    pending: { createdAt: Date.now(), profile },
  });
};

export const clearPasskeyAccountRecords = (accountAddress: string) => {
  removeKey(accountRecordsKey(accountAddress));
};

export const clearPendingPasskeyRecord = (accountAddress: string) => {
  const records = getPasskeyAccountRecords(accountAddress);
  if (!records.pending) {
    return;
  }
  delete records.pending;
  if (records.active) {
    writeJson(accountRecordsKey(accountAddress), records);
  } else {
    removeKey(accountRecordsKey(accountAddress));
  }
};

// Account-creation flows mint the passkey before the smart account address is
// final, so the pending record is kept in a single slot until the account
// exists and the record can be promoted under its address.
export const getPendingCreationPasskey = (): PasskeyPendingRecord | null =>
  readJson<PasskeyPendingRecord>(CREATION_PENDING_KEY);

export const setPendingCreationPasskey = (
  profile: IPasskeyCredentialProfile
) => {
  writeJson(CREATION_PENDING_KEY, { createdAt: Date.now(), profile });
};

export const clearPendingCreationPasskey = () => {
  removeKey(CREATION_PENDING_KEY);
};
