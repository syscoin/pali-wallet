import { decodeAccountRecord } from '../storage/accountRecordKey.ts';
import { inspectNoteDomain } from '../storage/noteDomain.ts';
import { decodeStorageValue, STORAGE_LIMITS } from '../storage/json.ts';
import type { OpenWalletStorage, RecoveryStorageSnapshot } from '../storage/types.ts';
import { ACTIVITY_STORAGE_KEY, inspectRecoveryHistory } from '../activity/historyStore.ts';
import { NATIVE_TOKEN_REGISTRY_KEY, inspectRecoveryTokens } from '../portfolio/tokenRegistry.ts';
import { inspectRecoveryCatalogue, WALLET_CATALOGUE_KEY } from './walletCatalogue.ts';
import { parseNativeAccountId } from './accountIdentity.ts';
import { inspectEvmSignedBundle } from '../../../../source/wallet/evmSignedRecords.ts';
import { inspectUtxoSignedBundle, UTXO_SIGNED_RECORD_KEY } from '../../../../source/wallet/utxoSignedBundle.ts';

export type RecoveryInventoryCounts = Readonly<{
  hdAccounts: number; importedKeys: number;
  retainedSignedTransactions: number;
  tokenEntries: number; historySummaries: number; cachedTransactions: number; activityPreferences: number;
}>;
/** Public inventory only. This is neither a recovery ticket nor an authorization. */
export type RecoveryInventory = Readonly<{
  status: 'empty' | 'needs-matching-phrase-verification' | 'unavailable';
  reason: 'missing-catalogue' | 'unsupported-record' | 'invalid-record' | 'storage-unavailable' | null;
  backup: 'confirmed' | 'unconfirmed' | 'unknown';
  counts: RecoveryInventoryCounts | null;
  privateNotes: 'not-supported' | 'requires-matching-phrase-verification';
}>;
const result = (status: RecoveryInventory['status'], reason: RecoveryInventory['reason'],
  backup: RecoveryInventory['backup'], counts: RecoveryInventoryCounts | null, hasNotes = false): RecoveryInventory =>
  Object.freeze({ status, reason, backup, counts: counts && Object.freeze(counts), privateNotes: hasNotes ? 'requires-matching-phrase-verification' : 'not-supported' });
const zero = (): RecoveryInventoryCounts => ({ hdAccounts: 0, importedKeys: 0,
  retainedSignedTransactions: 0, tokenEntries: 0, historySummaries: 0, cachedTransactions: 0, activityPreferences: 0 });

/** Canonical native record domains. Runtime and recovery share this admission check. */
export function assertNativeRecordDomains(records: RecoveryStorageSnapshot['records']): void {
  for (const { key, value } of records) {
    if (!['vault', 'vault-keys', 'utf8Error', WALLET_CATALOGUE_KEY, NATIVE_TOKEN_REGISTRY_KEY, ACTIVITY_STORAGE_KEY, UTXO_SIGNED_RECORD_KEY].includes(key))
      throw new Error('NATIVE_STORAGE_UNSUPPORTED_RECORD');
    if (key === 'utf8Error') {
      const diagnostic = decodeStorageValue(value);
      if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic) || Object.keys(diagnostic).join(',') !== 'hasUtf8Error' ||
            typeof (diagnostic as { hasUtf8Error: unknown }).hasUtf8Error !== 'boolean'
      )
        throw new Error('NATIVE_STORAGE_INVALID_DIAGNOSTIC');
    }
  }
}

/** Consumes only an internal, bounded storage snapshot. Never derives/decrypts or writes. */
export function inspectRecoveryInventory(snapshot: RecoveryStorageSnapshot): RecoveryInventory {
  const backup = snapshot.state.backup;
  try {
    if (snapshot.records.length > STORAGE_LIMITS.records) throw new Error();
    const records = new Map(snapshot.records.map(({ key, value }) => [key, value]));
    if (records.size !== snapshot.records.length) throw new Error();
    try { assertNativeRecordDomains(snapshot.records); }
    catch { return result('unavailable', 'unsupported-record', backup, null); }
    if (snapshot.state.presence === 'empty') {
      if (snapshot.identity ||
        [...records.keys()].some((key) => key !== 'utf8Error') || snapshot.notes.length || snapshot.signedRecords.length) throw new Error();
      return result('empty', null, backup, zero());
    }
    if (!snapshot.identity) throw new Error();
    const rawCatalogue = records.get(WALLET_CATALOGUE_KEY);
    if (rawCatalogue === undefined) return result('unavailable', 'missing-catalogue', backup, null);
    const binding = snapshot.identity.walletBindingId;
    inspectNoteDomain(snapshot.notes, binding, snapshot.identity.root?.profileId);
    const catalogue = inspectRecoveryCatalogue(decodeAccountRecord(rawCatalogue), binding);
    const root = snapshot.identity.root;
    if (root && (root.address !== catalogue.root.address || root.publicKey !== catalogue.root.publicKey)) throw new Error();
    if (new Set(catalogue.importedProfiles).size > 1 || (root && catalogue.importedProfiles.some((profile) => profile !== root.profileId))) throw new Error();
    const counts = { ...zero(), hdAccounts: catalogue.accounts.filter((account) => account.type === 'HDAccount').length,
      importedKeys: catalogue.accounts.filter((account) => account.type === 'Imported').length,
    };
    if (!Array.isArray(snapshot.signedRecords) || snapshot.signedRecords.length > 1) throw new Error();
    for (const row of snapshot.signedRecords) {
      if (!root || row.walletBindingId !== binding || row.profileId !== root.profileId) throw new Error();
      counts.retainedSignedTransactions += inspectEvmSignedBundle(row.value, root.profileId).transactions;
    }
    const accountReference = (id: string, _address: string) => {
      // Historical public rows can outlive a removed or reused typed ID. They
      // are not account ownership or signing authority.
      parseNativeAccountId(id);
    };
    for (const [key, value] of records) {
      if (key === 'utf8Error') {
        // Public SDK2 diagnostic, not key material or an authorization result.
        const diagnostic = decodeStorageValue(value);
        if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic) || Object.keys(diagnostic).join(',') !== 'hasUtf8Error' ||
            typeof (diagnostic as { hasUtf8Error: unknown }).hasUtf8Error !== 'boolean') throw new Error();
      } else if (key === NATIVE_TOKEN_REGISTRY_KEY) {
        const tokens = inspectRecoveryTokens(decodeStorageValue(value), binding);
        tokens.accounts.forEach((account) => accountReference(account.id, account.address));
        counts.tokenEntries = tokens.tokens;
      } else if (key === ACTIVITY_STORAGE_KEY) {
        const history = inspectRecoveryHistory(decodeStorageValue(value), binding);
        history.accounts.forEach((account) => accountReference(account.id, account.address));
        counts.historySummaries = history.summaries; counts.cachedTransactions = history.cachedTransactions;
        counts.activityPreferences = history.preferences;
      } else if (key === UTXO_SIGNED_RECORD_KEY) {
        if (!root) throw new Error();
        counts.retainedSignedTransactions += inspectUtxoSignedBundle(value, root.profileId).entries.length;
      }
    }
    return result('needs-matching-phrase-verification', null, backup, counts, snapshot.notes.length > 0);
  } catch { return result('unavailable', 'invalid-record', backup, null); }
}

/** Read failure stays unavailable; it never creates an empty wallet or reveals error payloads. */
export async function readRecoveryInventory(storage: Pick<OpenWalletStorage, 'recovery'>): Promise<RecoveryInventory> {
  try {
    if (!storage.recovery) throw new Error();
    return inspectRecoveryInventory(await storage.recovery.readSnapshot());
  } catch { return result('unavailable', 'storage-unavailable', 'unknown', null); }
}
