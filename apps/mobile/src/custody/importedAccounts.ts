import { computeAddress } from 'ethers/transaction';
import { SigningKey } from 'ethers/crypto';
import { nativeAccountId } from './accountIdentity.ts';
import { UTXO_IMPORT_TYPES, type UtxoImportAddressType } from '../core/utxoAddresses.ts';

export type ImportedKeyIdentity = Readonly<{ id: string; index: number; address: string; publicKey: string }>;
export type NativeUtxoImportDraft = Readonly<{ privateKey: string; utxoAddressType: UtxoImportAddressType }>;

/** Private form input; never an account-directory action or public snapshot. */
export type NativeImportRequest = Readonly<{ privateKey: string; label: string; expectedAddress: string; utxoAddressType?: UtxoImportAddressType }>;
export interface NativeImportRuntime {
  previewUtxo(input: NativeUtxoImportDraft, catalogueRevision: number, assertCurrent: () => void): Promise<string>;
  reserve(input: NativeImportRequest, password: string, catalogueRevision: number): {
    execute(assertCurrent: () => void): Promise<void>;
    cancel(): void;
  };
}
export interface NativeImportView {
  previewUtxo(input: NativeUtxoImportDraft, contextRevision: number, catalogueRevision: number, assertCurrent: () => void): Promise<string>;
  submit(input: NativeImportRequest, password: string, contextRevision: number, catalogueRevision: number): Promise<void>;
  cancel(): void;
}
const invalid = (): never => { throw new Error('IMPORTED_KEY_INVALID'); };
export const isUtxoWifText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && /^[1-9A-HJ-NP-Za-km-z]{32,60}$/.test(value);
/** Bound the raw WIF lane before the SDK decodes checksum, network and key. */
export function normalizeUtxoImport(input: NativeUtxoImportDraft): NativeUtxoImportDraft {
  const { privateKey, utxoAddressType } = input;
  if (typeof privateKey !== 'string' || privateKey.length > 64 ||
      !isUtxoWifText(privateKey.trim()) ||
      !UTXO_IMPORT_TYPES.includes(utxoAddressType)) return invalid();
  return Object.freeze({ privateKey: privateKey.trim(), utxoAddressType });
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
    publicKey: SigningKey.computePublicKey(canonical, false).toLowerCase() });
}
