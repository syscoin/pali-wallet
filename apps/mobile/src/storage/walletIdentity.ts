import { getAddress } from 'ethers/address';
import { computeAddress } from 'ethers/transaction';
import { decodeStorageValue } from './json.ts';
import { WalletStorageError, type WalletIdentityRead } from './types.ts';

const invalid = (): never => { throw new WalletStorageError('STORAGE_CORRUPT'); };
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}

/** No writes, root derivation, private decryption or authorization. */
export function readWalletIdentity(pairFingerprint: string, raw?: string): WalletIdentityRead {
  if (!hash(pairFingerprint)) return invalid();
  if (raw === undefined) return Object.freeze({ walletBindingId: pairFingerprint, pairFingerprint, root: null, verification: 'requires-unlock' });
  const value = exact(decodeStorageValue(raw), ['version', 'walletBindingId', 'pairFingerprint', 'root']);
  if (value.version !== 1 || !hash(value.walletBindingId) || value.pairFingerprint !== pairFingerprint) return invalid();
  const root = exact(value.root, ['address', 'publicKey', 'profileId']);
  if (typeof root.address !== 'string' || typeof root.publicKey !== 'string' ||
      !/^0x(?:(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})$/.test(root.publicKey) ||
      typeof root.profileId !== 'string' || !/^0x[0-9a-f]{64}$/.test(root.profileId)) return invalid();
  try {
    if (getAddress(root.address) !== root.address || /^0x0{40}$/i.test(root.address) || computeAddress(root.publicKey) !== root.address) return invalid();
  } catch { return invalid(); }
  return Object.freeze({ walletBindingId: value.walletBindingId, pairFingerprint,
    root: Object.freeze({ address: root.address, publicKey: root.publicKey, profileId: root.profileId }), verification: 'requires-unlock' });
}
