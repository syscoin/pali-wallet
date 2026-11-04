import { parsePrivateVaultBundle, capacityBudget, PROFILE } from '../../../../source/wallet/privateVaultEnvelope.ts';
import { WalletStorageError, type NoteDomainRow } from './types.ts';

export const NOTE_DOMAIN_MAX_BYTES = capacityBudget(512);
export const NOTE_DOMAIN_MAX_ROWS = 1;

/** Structural admission only. Root/profile ownership still requires SDK authentication. */
export function inspectNoteDomain(rows: readonly NoteDomainRow[], walletBindingId: string, expectedProfile?: string): void {
  if (!Array.isArray(rows) || rows.length > NOTE_DOMAIN_MAX_ROWS || !/^[0-9a-f]{64}$/.test(walletBindingId))
    throw new WalletStorageError('STORAGE_CORRUPT');
  for (const row of rows) {
    if (!row || Object.keys(row).sort().join(',') !== 'profileId,value,walletBindingId' ||
      row.walletBindingId !== walletBindingId || !PROFILE.test(row.profileId) ||
      (expectedProfile !== undefined && row.profileId !== expectedProfile)) throw new WalletStorageError('STORAGE_CORRUPT');
    try { parsePrivateVaultBundle(row.value, row.profileId); }
    catch { throw new WalletStorageError('STORAGE_CORRUPT'); }
  }
}
