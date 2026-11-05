import type { IEncryptedPrivateRecord } from '@sidhujag/sysweb3-keyring';

export const IMPORTED_RECOVERY_STORAGE_PREFIX =
  'state-imported-account-recovery-v1:';
export const IMPORTED_RECOVERY_DOMAIN = 'org.syscoin.pali.imported-account.v1';
export const MAX_PAYLOAD_BYTES = 8192;
export const profilePattern = /^0x[0-9a-f]{64}$/;

export type ImportedRecoveryIdentity = Readonly<{
  address: string;
  id: number;
  kind: 'ethereum' | 'syscoin';
  slip44: number;
  xpub: string;
}>;
export type ImportedRecoveryEntry = Readonly<{
  envelope: IEncryptedPrivateRecord;
  identity: ImportedRecoveryIdentity;
  version: 1;
}>;
export const invalid = (): never => {
  throw new Error('IMPORTED_RECOVERY_INVALID');
};
export function data(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && Object.getPrototypeOf(proto) !== null) return invalid();
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length) return invalid();
  const result: Record<string, unknown> = {};
  for (const name of names) {
    if (typeof name !== 'string' || !keys.includes(name)) return invalid();
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field || !field.enumerable || !('value' in field)) return invalid();
    result[name] = field.value;
  }
  return result;
}
export function string(value: unknown, maximum = 2048): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maximum ||
    !value.isWellFormed() ||
    new TextEncoder().encode(value).length > maximum
  )
    return invalid();
  return value;
}
export function snapshotImportedRecoveryIdentity(
  value: unknown
): ImportedRecoveryIdentity {
  const raw = data(value, ['kind', 'slip44', 'id', 'address', 'xpub']);
  if (
    (raw.kind !== 'ethereum' && raw.kind !== 'syscoin') ||
    !Number.isSafeInteger(raw.slip44) ||
    (raw.slip44 as number) < 0 ||
    (raw.kind === 'ethereum') !== (raw.slip44 === 60) ||
    !Number.isSafeInteger(raw.id) ||
    (raw.id as number) < 0
  )
    return invalid();
  return Object.freeze({
    kind: raw.kind,
    slip44: raw.slip44 as number,
    id: raw.id as number,
    address: string(raw.address),
    xpub: string(raw.xpub),
  });
}
export const recordId = (identity: ImportedRecoveryIdentity) =>
  `imported:${identity.slip44}:${identity.id}`;

export function snapshotImportedRecoveryEntry(
  value: unknown,
  expected?: ImportedRecoveryIdentity
): ImportedRecoveryEntry {
  const raw = data(value, ['version', 'identity', 'envelope']);
  const identity = snapshotImportedRecoveryIdentity(raw.identity);
  if (
    raw.version !== 1 ||
    (expected &&
      JSON.stringify(identity) !==
        JSON.stringify(snapshotImportedRecoveryIdentity(expected)))
  )
    return invalid();
  const envelope = data(raw.envelope, [
    'version',
    'domain',
    'recordId',
    'profileId',
    'nonce',
    'ciphertext',
  ]);
  if (
    envelope.version !== 1 ||
    envelope.domain !== IMPORTED_RECOVERY_DOMAIN ||
    envelope.recordId !== recordId(identity) ||
    typeof envelope.profileId !== 'string' ||
    !profilePattern.test(envelope.profileId) ||
    typeof envelope.nonce !== 'string' ||
    !/^[A-Za-z0-9+/]{16}$/.test(envelope.nonce) ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length < 24 ||
    envelope.ciphertext.length > Math.ceil((MAX_PAYLOAD_BYTES + 16) / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      envelope.ciphertext
    )
  )
    return invalid();
  return Object.freeze({
    version: 1,
    identity,
    envelope: Object.freeze({
      ...envelope,
    }) as unknown as IEncryptedPrivateRecord,
  });
}

export function importedRecoveryStorageKey(
  entry: ImportedRecoveryEntry
): string {
  const checked = snapshotImportedRecoveryEntry(entry);
  return importedRecoveryStorageKeyForIdentity(
    checked.identity,
    checked.envelope.profileId
  );
}
export function importedRecoveryStorageKeyForIdentity(
  input: ImportedRecoveryIdentity,
  profileId: string
): string {
  const identity = snapshotImportedRecoveryIdentity(input);
  if (typeof profileId !== 'string' || !profilePattern.test(profileId))
    return invalid();
  return `${IMPORTED_RECOVERY_STORAGE_PREFIX}${profileId}:${recordId(
    identity
  )}`;
}
