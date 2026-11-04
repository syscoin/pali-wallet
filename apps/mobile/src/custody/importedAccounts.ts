import { computeAddress } from 'ethers/transaction';
import { SigningKey } from 'ethers/crypto';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import { nativeAccountId } from './accountIdentity.ts';

export const IMPORTED_EVM_DOMAIN = 'pali/native-imported-evm/v1';
export type ImportedKeyEnvelope = Readonly<{
  version: 1; domain: string; recordId: string; profileId: string; nonce: string; ciphertext: string;
}>;
export type ImportedKeyIdentity = Readonly<{ id: string; index: number; address: string; publicKey: string }>;
export type ImportedKeyCryptography = Readonly<{
  encryptPrivateRecord(input: { domain: string; recordId: string; plaintext: Uint8Array }): Promise<ImportedKeyEnvelope>;
  decryptPrivateRecord(input: { domain: string; recordId: string; envelope: ImportedKeyEnvelope }): Promise<Uint8Array>;
}>;
const invalid = (): never => { throw new Error('IMPORTED_KEY_INVALID'); };
function check(guard: () => void): void {
  const result: unknown = guard();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
    invalid();
  }
}

/** Own-data only; no SDK records, error payloads or secret-bearing JSON are exposed. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const raw = decodeStorageValue(encodeStorageValue(value));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== keys.length || Object.keys(raw).some((key) => !keys.includes(key))) return invalid();
  return raw as Record<string, unknown>;
}
export function normalizeImportedKey(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(value)) return invalid();
  const key = `0x${value.replace(/^0x/, '').toLowerCase()}`;
  if (BigInt(key) === 0n || BigInt(key) >= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n) return invalid();
  return key;
}
export function importedKeyIdentity(key: string, index: number): ImportedKeyIdentity {
  const canonical = normalizeImportedKey(key);
  return Object.freeze({ id: nativeAccountId('Imported', index), index, address: computeAddress(canonical),
    publicKey: SigningKey.computePublicKey(canonical, true).toLowerCase() });
}
export function snapshotImportedEnvelope(value: unknown, id: string): ImportedKeyEnvelope {
  const raw = record(value, ['version', 'domain', 'recordId', 'profileId', 'nonce', 'ciphertext']);
  if (raw.version !== 1 || raw.domain !== IMPORTED_EVM_DOMAIN || raw.recordId !== id ||
      typeof raw.profileId !== 'string' || !/^0x[0-9a-f]{64}$/.test(raw.profileId) ||
      typeof raw.nonce !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(raw.nonce) ||
      typeof raw.ciphertext !== 'string' || raw.ciphertext.length < 24 || raw.ciphertext.length > 2048 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.ciphertext)) return invalid();
  return Object.freeze(raw) as ImportedKeyEnvelope;
}
function fingerprint(value: string): void { if (!/^[0-9a-f]{64}$/.test(value)) invalid(); }
export async function encryptImportedKey(crypto: ImportedKeyCryptography, walletFingerprint: string,
  index: number, input: string, guard: () => void): Promise<Readonly<{ identity: ImportedKeyIdentity; envelope: ImportedKeyEnvelope }>> {
  fingerprint(walletFingerprint); check(guard);
  const privateKey = normalizeImportedKey(input), identity = importedKeyIdentity(privateKey, index);
  const bytes = new TextEncoder().encode(encodeStorageValue({ version: 1, walletFingerprint, ...identity, privateKey }));
  try {
    const envelope = await crypto.encryptPrivateRecord({ domain: IMPORTED_EVM_DOMAIN, recordId: identity.id, plaintext: bytes });
    check(guard);
    return Object.freeze({ identity, envelope: snapshotImportedEnvelope(envelope, identity.id) });
  } catch { return invalid();
  } finally { bytes.fill(0); }
}
export async function decryptImportedKey(crypto: ImportedKeyCryptography, walletFingerprint: string,
  expected: ImportedKeyIdentity, input: ImportedKeyEnvelope, guard: () => void): Promise<string> {
  fingerprint(walletFingerprint); check(guard);
  const envelope = snapshotImportedEnvelope(input, expected.id);
  let bytes: Uint8Array | undefined;
  try {
    bytes = await crypto.decryptPrivateRecord({ domain: IMPORTED_EVM_DOMAIN, recordId: expected.id, envelope });
    check(guard);
    if (!(bytes instanceof Uint8Array) || bytes.length > 1536) return invalid();
    const raw = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      ['version', 'walletFingerprint', 'id', 'index', 'address', 'publicKey', 'privateKey']);
    if (raw.version !== 1 || raw.walletFingerprint !== walletFingerprint) return invalid();
    const key = normalizeImportedKey(raw.privateKey), actual = importedKeyIdentity(key, expected.index);
    if (Object.entries(actual).some(([field, value]) => raw[field] !== value || expected[field as keyof ImportedKeyIdentity] !== value)) return invalid();
    check(guard); return key;
  } catch { return invalid();
  } finally { if (bytes instanceof Uint8Array) bytes.fill(0); }
}
