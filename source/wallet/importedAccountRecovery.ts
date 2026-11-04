import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';

import { isPublicExtendedKey } from './extendedPublicKey.ts';
import type { IEncryptedPrivateRecord } from '@sidhujag/sysweb3-keyring';

export const IMPORTED_RECOVERY_STORAGE_PREFIX =
  'state-imported-account-recovery-v1:';
export const IMPORTED_RECOVERY_DOMAIN = 'org.syscoin.pali.imported-account.v1';
const MAX_SECRET_BYTES = 2048;
const MAX_PAYLOAD_BYTES = 8192;
const profilePattern = /^0x[0-9a-f]{64}$/;

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
type ImportOptions = Readonly<{
  utxoAddressType?: 'p2wpkh' | 'p2pkh' | 'p2tr';
}>;
type ImportedAccount = {
  address: string;
  id: number;
  isImported: boolean;
  isLedgerWallet?: boolean;
  isSmartAccount?: boolean;
  isTrezorWallet?: boolean;
  label?: string;
  xprv: string;
  xpub: string;
};
export type ImportedRecoveryCrypto = Pick<
  import('@sidhujag/sysweb3-keyring').IKeyringManager,
  'getPrivateRecordProfileId' | 'encryptPrivateRecord' | 'decryptPrivateRecord'
>;
const invalid = (): never => {
  throw new Error('IMPORTED_RECOVERY_INVALID');
};
function check(guard: () => void): void {
  const result: unknown = guard();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
    invalid();
  }
}
function data(
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
function string(value: unknown, maximum = 2048): string {
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
const recordId = (identity: ImportedRecoveryIdentity) =>
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

/** The extended key is stable when a UTXO account advances its receive address. */
export function assertImportedRecoveryAccount(
  entry: ImportedRecoveryEntry,
  current: ImportedRecoveryIdentity
): void {
  const saved = snapshotImportedRecoveryEntry(entry).identity;
  const expected = snapshotImportedRecoveryIdentity(current);
  if (
    saved.kind !== expected.kind ||
    saved.slip44 !== expected.slip44 ||
    saved.id !== expected.id ||
    saved.xpub !== expected.xpub ||
    (saved.address !== expected.address &&
      !(saved.kind === 'syscoin' && isPublicExtendedKey(saved.xpub)))
  )
    invalid();
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
function optionsSnapshot(options?: ImportOptions): ImportOptions | null {
  if (options === undefined) return null;
  const names = Reflect.ownKeys(options);
  if (!names.length) return Object.freeze({});
  const raw = data(options, ['utxoAddressType']);
  if (!['p2wpkh', 'p2pkh', 'p2tr'].includes(raw.utxoAddressType as string))
    return invalid();
  return Object.freeze({
    utxoAddressType: raw.utxoAddressType as ImportOptions['utxoAddressType'],
  });
}

/** Import and protect the same SDK-validated key before either record is committed. */
export async function importAccountWithRecovery<T extends ImportedAccount>(
  keyring: ImportedRecoveryCrypto & {
    importAccount(
      secret: string,
      label?: string,
      options?: ImportOptions
    ): Promise<T>;
  },
  input: Readonly<{
    label?: string;
    network: Readonly<{ kind: 'ethereum' | 'syscoin'; slip44: number }>;
    options?: ImportOptions;
    secret: string;
  }>,
  guard: () => void
): Promise<Readonly<{ account: T; recovery: ImportedRecoveryEntry }>> {
  check(guard);
  const secret = string(input.secret, MAX_SECRET_BYTES);
  const label = input.label;
  const options = optionsSnapshot(input.options);
  const network = data(input.network, ['kind', 'slip44']);
  const account = await keyring.importAccount(
    secret,
    label,
    options ?? undefined
  );
  check(guard);
  if (
    account.isImported !== true ||
    account.isLedgerWallet ||
    account.isTrezorWallet ||
    account.isSmartAccount ||
    typeof account.xprv !== 'string' ||
    !account.xprv
  )
    return invalid();
  const profile = await keyring.getPrivateRecordProfileId();
  check(guard);
  if (typeof profile !== 'string' || !profilePattern.test(profile)) invalid();
  const identity = snapshotImportedRecoveryIdentity({
    ...network,
    id: account.id,
    address: account.address,
    xpub: account.xpub,
  });
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      identity,
      secret,
      options,
    })
  );
  try {
    if (plaintext.length > MAX_PAYLOAD_BYTES) return invalid();
    const envelope = await keyring.encryptPrivateRecord({
      domain: IMPORTED_RECOVERY_DOMAIN,
      recordId: recordId(identity),
      plaintext,
    });
    check(guard);
    const recovery = snapshotImportedRecoveryEntry({
      version: 1,
      identity,
      envelope,
    });
    if (recovery.envelope.profileId !== profile) return invalid();
    return Object.freeze({ account, recovery });
  } finally {
    plaintext.fill(0);
  }
}

/** Private caller only: authenticate a retained copy before using the existing SDK importer. */
export async function readImportedRecoverySecret(
  keyring: ImportedRecoveryCrypto,
  input: ImportedRecoveryEntry,
  expected: ImportedRecoveryIdentity,
  guard: () => void
): Promise<Readonly<{ options: ImportOptions | null; secret: string }>> {
  check(guard);
  const entry = snapshotImportedRecoveryEntry(input, expected);
  const profile = await keyring.getPrivateRecordProfileId();
  check(guard);
  if (profile !== entry.envelope.profileId) return invalid();
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = await keyring.decryptPrivateRecord({
      domain: IMPORTED_RECOVERY_DOMAIN,
      recordId: recordId(entry.identity),
      envelope: entry.envelope,
    });
    check(guard);
    if (
      !(plaintext instanceof Uint8Array) ||
      plaintext.length > MAX_PAYLOAD_BYTES
    )
      return invalid();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    assertJsonTextBudget(text, {
      depth: 4,
      nodes: 24,
      tokenCharacters: MAX_PAYLOAD_BYTES,
    });
    const raw = data(JSON.parse(text), [
      'version',
      'identity',
      'secret',
      'options',
    ]);
    if (
      raw.version !== 1 ||
      JSON.stringify(snapshotImportedRecoveryIdentity(raw.identity)) !==
        JSON.stringify(entry.identity)
    )
      return invalid();
    return Object.freeze({
      secret: string(raw.secret, MAX_SECRET_BYTES),
      options:
        raw.options === null
          ? null
          : optionsSnapshot(raw.options as ImportOptions),
    });
  } catch {
    check(guard);
    return invalid();
  } finally {
    plaintext?.fill(0);
  }
}
