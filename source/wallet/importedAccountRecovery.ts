import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';
import { hasBip84UtxoPrivateKeyPrefix } from '../shared/utxoPrivateKey.ts';

import { isPublicExtendedKey } from './extendedPublicKey.ts';
import {
  IMPORTED_RECOVERY_DOMAIN,
  MAX_PAYLOAD_BYTES,
  data,
  invalid,
  profilePattern,
  recordId,
  snapshotImportedRecoveryEntry,
  snapshotImportedRecoveryIdentity,
  string,
} from './importedAccountRecoveryFormat.ts';
import type {
  ImportedRecoveryEntry,
  ImportedRecoveryIdentity,
} from './importedAccountRecoveryFormat.ts';

export {
  IMPORTED_RECOVERY_DOMAIN,
  IMPORTED_RECOVERY_STORAGE_PREFIX,
  importedRecoveryStorageKey,
  importedRecoveryStorageKeyForIdentity,
  snapshotImportedRecoveryEntry,
  snapshotImportedRecoveryIdentity,
} from './importedAccountRecoveryFormat.ts';
export type {
  ImportedRecoveryEntry,
  ImportedRecoveryIdentity,
} from './importedAccountRecoveryFormat.ts';

const MAX_SECRET_BYTES = 2048;
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
function check(guard: () => void): void {
  const result: unknown = guard();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
    invalid();
  }
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
  const script = options?.utxoAddressType;
  if (
    hasBip84UtxoPrivateKeyPrefix(secret) &&
    script !== undefined &&
    script !== 'p2wpkh'
  )
    return invalid();
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
