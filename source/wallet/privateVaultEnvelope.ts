/** Shared encrypted note layout. No keys, decryption, storage or provider access. */
export interface IPrivateNoteEnvelope {
  ciphertext: string;
  domain: string;
  nonce: string;
  profileId: string;
  recordId: string;
  version: 1;
}
export interface IPrivateNoteBundle {
  format: 'pali-private-note-vault';
  root: IPrivateNoteEnvelope;
  shards: IPrivateNoteEnvelope[];
  version: 1;
}
import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';

export const PRIVATE_VAULT_STORAGE_PREFIX = 'state-private-vault-v1:';
export const PRIVATE_VAULT_DOMAIN = 'org.syscoin.pali.privacy.notes.v1';
export const PRIVATE_VAULT_FORMAT = 'pali-private-note-vault';
export const PRIVATE_VAULT_VERSION = 1;
export const DEFAULT_CAPACITY = 128;
export const MAX_NOTES = 512;
export const PRIVATE_VAULT_CAPACITIES = Object.freeze([
  DEFAULT_CAPACITY,
  256,
  MAX_NOTES,
] as const);
export const capacityValid = (value: unknown): value is 128 | 256 | 512 =>
  PRIVATE_VAULT_CAPACITIES.some((capacity) => capacity === value);
export const capacityBudget = (capacity: 128 | 256 | 512): number =>
  (capacity / 128) * 4 * 1024 * 1024;
export const MAX_PLAINTEXT_BYTES = 64 * 1024;
export const MAX_SHARD_BYTES = 32 * 1024;
export const MAX_SHARD_NOTES = 16;
export const PRIVATE_VAULT_SHARD_DOMAIN =
  'org.syscoin.pali.privacy.notes.shard.v2';
export const PROFILE = /^0x[0-9a-f]{64}$/;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Structured clone may return another realm's plain objects. Read own data only.
function snapshotBackupObject(
  value: unknown,
  allowed: readonly string[]
): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('privacy_vault_corrupt');
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && Object.getPrototypeOf(proto) !== null)
    throw new Error('privacy_vault_corrupt');
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) throw new Error('privacy_vault_corrupt');
  const out: Record<string, any> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key))
      throw new Error('privacy_vault_corrupt');
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !('value' in d))
      throw new Error('privacy_vault_corrupt');
    out[key] = d.value;
  }
  return out;
}
function snapshotBackupArray(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || !Array.isArray(Object.getPrototypeOf(value)))
    throw new Error('privacy_vault_corrupt');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > limit ||
    Reflect.ownKeys(value).length !== length + 1
  )
    throw new Error('privacy_vault_corrupt');
  const out: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !('value' in d))
      throw new Error('privacy_vault_corrupt');
    out.push(d.value);
  }
  return out;
}

/** Synchronous bounded own-data snapshot; no decryption, writes or authorization. */
export function snapshotPrivateVaultBundle(
  value: unknown,
  expectedProfile?: string
): IPrivateNoteBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('privacy_vault_corrupt');
  const format = Object.getOwnPropertyDescriptor(value, 'format');
  const version = Object.getOwnPropertyDescriptor(value, 'version');
  if ((format && !('value' in format)) || (version && !('value' in version)))
    throw new Error('privacy_vault_corrupt');
  if (format?.value !== PRIVATE_VAULT_FORMAT || version?.value !== 1)
    throw new Error('privacy_vault_unsupported_format');
  const raw = snapshotBackupObject(value, [
    'format',
    'version',
    'root',
    'shards',
  ]);
  if (raw.format !== PRIVATE_VAULT_FORMAT || raw.version !== 1)
    throw new Error('privacy_vault_unsupported_format');
  if (Object.keys(raw).length !== 4) throw new Error('privacy_vault_corrupt');
  const envelope = (
    input: unknown,
    domain: string,
    maximum: number
  ): IPrivateNoteEnvelope => {
    const data = snapshotBackupObject(input, [
      'version',
      'domain',
      'recordId',
      'profileId',
      'nonce',
      'ciphertext',
    ]);
    if (
      Object.keys(data).length !== 6 ||
      data.version !== 1 ||
      data.domain !== domain ||
      typeof data.recordId !== 'string' ||
      !UUID.test(data.recordId) ||
      typeof data.profileId !== 'string' ||
      !PROFILE.test(data.profileId) ||
      (expectedProfile !== undefined && data.profileId !== expectedProfile) ||
      typeof data.nonce !== 'string' ||
      !/^[A-Za-z0-9+/]{16}$/.test(data.nonce) ||
      typeof data.ciphertext !== 'string' ||
      data.ciphertext.length < 24 ||
      data.ciphertext.length > Math.ceil((maximum + 16) / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        data.ciphertext
      )
    )
      throw new Error('privacy_vault_corrupt');
    return Object.freeze({
      version: 1,
      domain,
      recordId: data.recordId,
      profileId: data.profileId,
      nonce: data.nonce,
      ciphertext: data.ciphertext,
    });
  };
  const root = envelope(raw.root, PRIVATE_VAULT_DOMAIN, MAX_PLAINTEXT_BYTES);
  const values = snapshotBackupArray(raw.shards, MAX_NOTES);
  if (!values.length) throw new Error('privacy_vault_corrupt');
  const ids = new Set([root.recordId]);
  const shards = values.map((entry) => {
    const shard = envelope(entry, PRIVATE_VAULT_SHARD_DOMAIN, MAX_SHARD_BYTES);
    if (shard.profileId !== root.profileId || ids.has(shard.recordId))
      throw new Error('privacy_vault_corrupt');
    ids.add(shard.recordId);
    return shard;
  });
  const result: IPrivateNoteBundle = {
    format: PRIVATE_VAULT_FORMAT,
    version: 1,
    root,
    shards,
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).length >
    capacityBudget(512)
  )
    throw new Error('privacy_vault_corrupt');
  return result;
}

/** Bound parser work before JSON.parse; stored bytes remain unchanged. */
export function parsePrivateVaultBundle(
  raw: unknown,
  expectedProfile?: string
): IPrivateNoteBundle {
  if (
    typeof raw !== 'string' ||
    raw.length > capacityBudget(512) ||
    new TextEncoder().encode(raw).length > capacityBudget(512)
  )
    throw new Error('privacy_vault_corrupt');
  assertJsonTextBudget(raw, {
    depth: 8,
    nodes: 8192,
    tokenCharacters: 90_000,
    whitespace: true,
  });
  const parsed: unknown = JSON.parse(raw);
  if (JSON.stringify(parsed) !== raw) throw new Error('privacy_vault_corrupt');
  return snapshotPrivateVaultBundle(parsed, expectedProfile);
}
