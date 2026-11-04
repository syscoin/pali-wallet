import { utf8ByteLength } from '../platformRpc.ts';
import { parseAccountSelection, type AccountSelection } from './accountDirectory.ts';
import type { PublicAccount } from './types.ts';
import { validatePublicAccounts } from './watchOnlyAuthority.ts';
import { createWatchAccountCodec, snapshotWatchRecords, type DecodedWatchRecords, type PublicBip84ValidationPort, type StoredWatchAccount } from './watchAccountCodec.ts';
import type { Bip84DiscoveryCursor } from './bip84Discovery.ts';

export const PUBLIC_ACCOUNTS_KEY = 'pali.mobile.public-accounts.v1';
export const ACCOUNT_SELECTION_KEY = 'pali.mobile.account-selection.v1';
export type PublicStoragePort = Readonly<{
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}>;
function assertSize(raw: string, limit: number): void {
  if (raw.length > limit || utf8ByteLength(raw) > limit) throw new Error('Public account configuration is too large');
}

/** Internal snapshot; only this repository can admit it as a compare token. */
export type WatchRecordSnapshot = DecodedWatchRecords;

/** One same-process serialized repository. This is not cross-process atomic CAS. */
export function createPublicAccountStorage(port: PublicStoragePort, bip84?: PublicBip84ValidationPort) {
  let queue: Promise<void> = Promise.resolve();
  let accountsUnavailable = false;
  let recordsEpoch = 0;
  const codec = bip84 === undefined ? null : createWatchAccountCodec(bip84);
  const snapshots = new WeakMap<WatchRecordSnapshot, { raw: string | null; used: boolean; epoch: number }>();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function readAccounts(): Promise<readonly PublicAccount[]> {
    const raw = await port.get(PUBLIC_ACCOUNTS_KEY);
    // Only an explicit missing key is empty. Corrupt/unknown records are retained.
    if (raw === null) return Object.freeze([]);
    assertSize(raw, 32 * 1024);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Unsupported public account configuration');
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || Object.keys(record).some((key) => key !== 'version' && key !== 'accounts')) throw new Error('Unsupported public account configuration');
    return validatePublicAccounts(record.accounts);
  }
  async function readSelection(): Promise<AccountSelection | null> {
    const raw = await port.get(ACCOUNT_SELECTION_KEY);
    if (raw === null) return null;
    assertSize(raw, 256);
    return parseAccountSelection(JSON.parse(raw));
  }
  function issue(value: DecodedWatchRecords, raw: string | null): WatchRecordSnapshot {
    snapshots.set(value, { raw, used: false, epoch: recordsEpoch });
    return value;
  }
  async function readRecordRaw(): Promise<string | null> {
    try { return await port.get(PUBLIC_ACCOUNTS_KEY); }
    catch { throw new Error('Saved watch records could not be read. Reopen them before saving.'); }
  }
  function retainedSources(expected: WatchRecordSnapshot, next: readonly StoredWatchAccount[]): void {
    const byId = new Map(next.map((record) => [record.id, record]));
    for (const previous of expected.records) {
      const record = byId.get(previous.id);
      if (!record) continue;
      if (record.kind !== previous.kind) throw new Error('Saved watch account identity cannot change');
      if (previous.kind === 'bip84-public' && record.kind === 'bip84-public') {
        if (record.networkId !== previous.networkId || record.policy !== previous.policy || record.accountKey !== previous.accountKey)
          throw new Error('Saved watch account identity cannot change');
      } else if (previous.kind === 'address' && record.kind === 'address') {
        const ordered = (addresses: PublicAccount['addresses']) => JSON.stringify(Object.entries(addresses).sort(([a], [b]) => a.localeCompare(b)));
        if (ordered(record.addresses) !== ordered(previous.addresses)) throw new Error('Saved watch account identity cannot change');
      }
    }
  }
  function compareAndSetRecords(expected: WatchRecordSnapshot, next: unknown): Promise<WatchRecordSnapshot> {
    // Detach before entering the queue; no host validation callback runs here.
    const detached = snapshotWatchRecords(next);
    return serialized(async () => {
      const ticket = snapshots.get(expected);
      if (!codec || !ticket || ticket.used) throw new Error('Reopen saved watch records before saving');
      if (accountsUnavailable) throw new Error('Saved watch records are unavailable. Reopen them before saving.');
      if (ticket.epoch !== recordsEpoch) throw new Error('Reopen saved watch records before saving');
      const validated = codec.validate(detached);
      retainedSources(expected, validated.records);
      const raw = codec.encode(validated.records);
      ticket.used = true;
      try {
        const current = await readRecordRaw();
        // Validate every v2 read, even when the raw comparison will reject it.
        const currentDecoded = codec.decode(current);
        if (current !== ticket.raw || JSON.stringify(currentDecoded.records) !== JSON.stringify(expected.records) ||
            JSON.stringify(currentDecoded.accounts) !== JSON.stringify(expected.accounts))
          throw new Error('Saved watch accounts changed. Reopen them before saving.');
        try { await port.set(PUBLIC_ACCOUNTS_KEY, raw); }
        catch { throw new Error('Saved watch records could not be verified. Reopen them before saving.'); }
        const persisted = await readRecordRaw();
        const decoded = codec.decode(persisted);
        if (persisted !== raw || JSON.stringify(decoded.records) !== JSON.stringify(validated.records) ||
            JSON.stringify(decoded.accounts) !== JSON.stringify(validated.accounts))
          throw new Error('Saved watch accounts could not be verified.');
        recordsEpoch++;
        return issue(decoded, persisted);
      } catch (cause) { accountsUnavailable = true; recordsEpoch++; throw cause; }
    });
  }
  const records = codec && Object.freeze({
    load: (): Promise<WatchRecordSnapshot> => serialized(async () => {
      try {
        const raw = await readRecordRaw();
        const decoded = codec.decode(raw);
        accountsUnavailable = false;
        return issue(decoded, raw);
      } catch (cause) { accountsUnavailable = true; recordsEpoch++; throw cause; }
    }),
    compareAndSet: compareAndSetRecords,
    saveCheckpoint: (expected: WatchRecordSnapshot, id: string, checkpoint: Bip84DiscoveryCursor | null): Promise<WatchRecordSnapshot> => {
      if (!snapshots.has(expected)) return Promise.reject(new Error('Reopen saved watch records before saving'));
      const target = expected.records.find((record) => record.id === id);
      if (!target || target.kind !== 'bip84-public') return Promise.reject(new Error('This public account is no longer available'));
      return compareAndSetRecords(expected, expected.records.map((record) => record === target ? { ...record, checkpoint } : record));
    },
  });
  return Object.freeze({
    // Legacy calls deliberately refuse every v2 document, including address-only
    // v2. They must never project away a key record or its checkpoint on save.
    loadAccounts: (): Promise<readonly PublicAccount[]> => serialized(async () => {
      try { const accounts = await readAccounts(); accountsUnavailable = false; return accounts; }
      catch (cause) { accountsUnavailable = true; recordsEpoch++; throw cause; }
    }),
    compareAndSetAccounts: (expected: readonly PublicAccount[], accounts: readonly PublicAccount[]): Promise<void> => {
      const validated = validatePublicAccounts(accounts);
      const expectedJson = JSON.stringify(validatePublicAccounts(expected));
      const raw = JSON.stringify({ version: 1, accounts: validated });
      assertSize(raw, 32 * 1024);
      return serialized(async () => {
        if (accountsUnavailable) throw new Error('Saved watch accounts are unavailable. Reopen them before saving.');
        if (JSON.stringify(await readAccounts()) !== expectedJson) throw new Error('Saved watch accounts changed. Reopen them before saving.');
        try {
          await port.set(PUBLIC_ACCOUNTS_KEY, raw);
          if (JSON.stringify(await readAccounts()) !== JSON.stringify(validated)) throw new Error('Saved watch accounts could not be verified.');
          recordsEpoch++;
        } catch (cause) { accountsUnavailable = true; recordsEpoch++; throw cause; }
      });
    },
    loadSelection: (): Promise<AccountSelection | null> => serialized(readSelection),
    saveSelection: (selection: AccountSelection | null): Promise<void> => {
      const checked = parseAccountSelection(selection);
      return serialized(async () => {
        // An unreadable existing hint is preserved rather than replaced.
        await readSelection();
        await port.set(ACCOUNT_SELECTION_KEY, JSON.stringify(checked));
        if (JSON.stringify(await readSelection()) !== JSON.stringify(checked)) throw new Error('Saved account choice could not be verified.');
      });
    },
    // No adapter is installed by production platform construction today.
    records,
  });
}
