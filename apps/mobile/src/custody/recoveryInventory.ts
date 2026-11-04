import { decodeStorageValue, STORAGE_LIMITS } from '../storage/json.ts';
import type { OpenWalletStorage, RecoveryStorageSnapshot } from '../storage/types.ts';
import { ACTIVITY_STORAGE_KEY, inspectRecoveryHistory } from '../activity/historyStore.ts';
import { NATIVE_TOKEN_REGISTRY_KEY, inspectRecoveryTokens } from '../portfolio/tokenRegistry.ts';
import { inspectRecoveryCatalogue, WALLET_CATALOGUE_KEY } from './walletCatalogue.ts';
import { inspectRecoveryJournal } from './transferJournal.ts';
import { parseNativeAccountId } from './accountIdentity.ts';

export type RecoveryInventoryCounts = Readonly<{
  hdAccounts: number; importedKeys: number; retiredHdAccounts: number; retiredImportedAccounts: number;
  journalRecords: number; pendingTransactions: number; terminalTransactions: number;
  tokenEntries: number; historySummaries: number; cachedTransactions: number; activityPreferences: number;
}>;
/** Public inventory only. This is neither a recovery ticket nor an authorization. */
export type RecoveryInventory = Readonly<{
  status: 'empty' | 'needs-matching-phrase-verification' | 'unavailable';
  reason: 'missing-catalogue' | 'unsupported-record' | 'invalid-record' | 'storage-unavailable' | null;
  backup: 'confirmed' | 'unconfirmed' | 'unknown';
  counts: RecoveryInventoryCounts | null;
  privateNotes: 'not-supported';
}>;
const result = (status: RecoveryInventory['status'], reason: RecoveryInventory['reason'],
  backup: RecoveryInventory['backup'], counts: RecoveryInventoryCounts | null): RecoveryInventory =>
  Object.freeze({ status, reason, backup, counts: counts && Object.freeze(counts), privateNotes: 'not-supported' });
const zero = (): RecoveryInventoryCounts => ({ hdAccounts: 0, importedKeys: 0, retiredHdAccounts: 0, retiredImportedAccounts: 0,
  journalRecords: 0, pendingTransactions: 0, terminalTransactions: 0, tokenEntries: 0, historySummaries: 0, cachedTransactions: 0, activityPreferences: 0 });

/** Consumes only an internal, bounded storage snapshot. Never derives/decrypts or writes. */
export function inspectRecoveryInventory(snapshot: RecoveryStorageSnapshot): RecoveryInventory {
  const backup = snapshot.state.backup;
  try {
    if (snapshot.records.length > STORAGE_LIMITS.records) throw new Error();
    const records = new Map(snapshot.records.map(({ key, value }) => [key, value]));
    if (records.size !== snapshot.records.length) throw new Error();
    for (const key of records.keys()) if (!['vault', 'vault-keys', 'utf8Error', WALLET_CATALOGUE_KEY, NATIVE_TOKEN_REGISTRY_KEY, ACTIVITY_STORAGE_KEY].includes(key) &&
      !/^native-evm-transfer-v1(?::(?:hd|imported):60:(?:0|[1-9][0-9]{0,3}))?$/.test(key))
      return result('unavailable', 'unsupported-record', backup, null);
    if (snapshot.state.presence === 'empty') {
      if (snapshot.identity || records.size) throw new Error();
      return result('empty', null, backup, zero());
    }
    if (!snapshot.identity) throw new Error();
    const rawCatalogue = records.get(WALLET_CATALOGUE_KEY);
    if (rawCatalogue === undefined) return result('unavailable', 'missing-catalogue', backup, null);
    const binding = snapshot.identity.walletBindingId;
    const catalogue = inspectRecoveryCatalogue(decodeStorageValue(rawCatalogue), binding);
    const root = snapshot.identity.root;
    if (root && (root.address !== catalogue.root.address || root.publicKey !== catalogue.root.publicKey)) throw new Error();
    if (new Set(catalogue.importedProfiles).size > 1 || (root && catalogue.importedProfiles.some((profile) => profile !== root.profileId))) throw new Error();
    const counts = { ...zero(), hdAccounts: catalogue.accounts.filter((account) => account.type === 'HDAccount').length,
      importedKeys: catalogue.accounts.filter((account) => account.type === 'Imported').length,
      retiredHdAccounts: catalogue.retiredIndices.length, retiredImportedAccounts: catalogue.retiredImportedIndices.length };
    const accountReference = (id: string, address: string) => {
      const parsed = parseNativeAccountId(id), active = catalogue.accounts.find((account) => account.id === id);
      if (active ? active.address !== address : !(parsed.type === 'HDAccount' ? catalogue.retiredIndices : catalogue.retiredImportedIndices).includes(parsed.index)) throw new Error();
    };
    for (const [key, value] of records) {
      if (key === 'utf8Error') {
        // Public SDK2 diagnostic, not key material or an authorization result.
        const diagnostic = decodeStorageValue(value);
        if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic) || Object.keys(diagnostic).join(',') !== 'hasUtf8Error' ||
            typeof (diagnostic as { hasUtf8Error: unknown }).hasUtf8Error !== 'boolean') throw new Error();
      } else if (key.startsWith('native-evm-transfer-v1')) {
        const journal = inspectRecoveryJournal(key, decodeStorageValue(value), binding);
        accountReference(journal.id, journal.address);
        counts.journalRecords++; counts.pendingTransactions += journal.pending;
        counts.terminalTransactions += journal.transactions - journal.pending;
      } else if (key === NATIVE_TOKEN_REGISTRY_KEY) {
        const tokens = inspectRecoveryTokens(decodeStorageValue(value), binding);
        tokens.accounts.forEach((account) => accountReference(account.id, account.address));
        counts.tokenEntries = tokens.tokens;
      } else if (key === ACTIVITY_STORAGE_KEY) {
        const history = inspectRecoveryHistory(decodeStorageValue(value), binding);
        history.accounts.forEach((account) => accountReference(account.id, account.address));
        counts.historySummaries = history.summaries; counts.cachedTransactions = history.cachedTransactions;
        counts.activityPreferences = history.preferences;
      }
    }
    return result('needs-matching-phrase-verification', null, backup, counts);
  } catch { return result('unavailable', 'invalid-record', backup, null); }
}

/** Read failure stays unavailable; it never creates an empty wallet or reveals error payloads. */
export async function readRecoveryInventory(storage: Pick<OpenWalletStorage, 'recovery'>): Promise<RecoveryInventory> {
  try {
    if (!storage.recovery) throw new Error();
    return inspectRecoveryInventory(await storage.recovery.readSnapshot());
  } catch { return result('unavailable', 'storage-unavailable', 'unknown', null); }
}
