import { computeAddress } from 'ethers/transaction';
import { SigningKey } from 'ethers/crypto';
import { nativeAccountId } from './accountIdentity.ts';
import { UTXO_IMPORT_TYPES, type UtxoImportAddressType } from '../core/utxoAddresses.ts';
import type { NativePrivateAuthentication, NativePrivateAuthenticationScope } from './privateAuthentication.ts';

export type ImportedKeyIdentity = Readonly<{ id: string; index: number; address: string; publicKey: string }>;
export type NativeUtxoImportDraft = Readonly<{ privateKey: string; utxoAddressType?: UtxoImportAddressType }>;

/** Private form input; never an account-directory action or public snapshot. */
export type NativeImportRequest = Readonly<{ privateKey: string; label: string; expectedAddress: string; utxoAddressType?: UtxoImportAddressType }>;
export interface NativeImportRuntime {
  previewUtxo(input: NativeUtxoImportDraft, catalogueRevision: number, assertCurrent: () => void): Promise<string>;
  reserve(input: NativeImportRequest, catalogueRevision: number, signal: AbortSignal, authentication: NativePrivateAuthentication): {
    execute(assertCurrent: () => void): Promise<void>;
    cancel(): void;
  };
}
export interface NativeImportView {
  previewUtxo(input: NativeUtxoImportDraft, contextRevision: number, catalogueRevision: number, assertCurrent: () => void): Promise<string>;
  submit(input: NativeImportRequest, contextRevision: number, catalogueRevision: number, signal: AbortSignal, authentication: NativePrivateAuthenticationScope): Promise<void>;
  cancel(): void;
}
const invalid = (): never => { throw new Error('IMPORTED_KEY_INVALID'); };
export const isUtxoWifText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && /^[1-9A-HJ-NP-Za-km-z]{32,60}$/.test(value);
export function isUtxoAccountPrivateKey(value: unknown, testnet?: boolean): value is string {
  return typeof value === 'string' && /^(zprv|vprv)[1-9A-HJ-NP-Za-km-z]{107}$/.test(value) &&
    (testnet === undefined || value.startsWith(testnet ? 'vprv' : 'zprv'));
}

/** Bound the form input before the SDK validates the key for the selected chain. */
export function normalizeUtxoImport(input: NativeUtxoImportDraft): NativeUtxoImportDraft {
  const { privateKey, utxoAddressType } = input;
  if (typeof privateKey !== 'string' || privateKey.length > 128) return invalid();
  const key = privateKey.trim();
  if (utxoAddressType === undefined && isUtxoAccountPrivateKey(key))
    return Object.freeze({ privateKey: key });
  if (privateKey.length <= 64 && isUtxoWifText(key) && utxoAddressType &&
      UTXO_IMPORT_TYPES.includes(utxoAddressType))
    return Object.freeze({ privateKey: key, utxoAddressType });
  return invalid();
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
