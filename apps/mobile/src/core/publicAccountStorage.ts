import { utf8ByteLength } from '../platformRpc.ts';
import { parseAccountSelection, type AccountSelection } from './accountDirectory.ts';
import type { PublicAccount } from './types.ts';
import { createWatchAccountCodec, snapshotWatchRecords, type DecodedWatchRecords, type StoredWatchAccount } from './watchAccountCodec.ts';

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
export type WatchRecordRepository = Readonly<{
  load(): Promise<WatchRecordSnapshot>;
  compareAndSet(expected: WatchRecordSnapshot, next: unknown): Promise<WatchRecordSnapshot>;
}>;
/** One same-process serialized repository. This is not cross-process atomic CAS. */
export function createPublicAccountStorage(port: PublicStoragePort) {
  let queue: Promise<void> = Promise.resolve();
  let accountsUnavailable = false;
  let recordsEpoch = 0;
  const codec = createWatchAccountCodec();
  const snapshots = new WeakMap<WatchRecordSnapshot, { raw: string | null; used: boolean; epoch: number }>();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function readAccounts(): Promise<readonly PublicAccount[]> {
    const decoded = codec.decode(await readRecordRaw());
    return decoded.accounts;
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
      if (previous.kind === 'utxo-public' && record.kind === 'utxo-public') {
        if (record.networkId !== previous.networkId || record.identifier !== previous.identifier)
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
      if (!ticket || ticket.used) throw new Error('Reopen saved watch records before saving');
      if (accountsUnavailable) throw new Error('Saved watch records are unavailable. Reopen them before saving.');
      if (ticket.epoch !== recordsEpoch) throw new Error('Reopen saved watch records before saving');
      const validated = codec.validate(detached);
      retainedSources(expected, validated.records);
      const raw = codec.encode(validated.records);
      ticket.used = true;
      try {
        const current = await readRecordRaw();
        // Validate every read, even when the raw comparison will reject it.
        const currentDecoded = codec.decode(current);
        if (current !== ticket.raw || JSON.stringify(currentDecoded.records) !== JSON.stringify(expected.records) ||
            JSON.stringify(currentDecoded.accounts) !== JSON.stringify(expected.accounts))
          throw new Error('Saved watch accounts changed. Reopen them before saving.');
        // After this dispatch, always drain and verify; revocation cannot undo set.
        try { await port.set(PUBLIC_ACCOUNTS_KEY, raw); }
        catch { throw new Error('Saved watch records could not be verified. Reopen them before saving.'); }
        const persisted = await readRecordRaw();
        const decoded = codec.decode(persisted);
        if (persisted !== raw || JSON.stringify(decoded.records) !== JSON.stringify(validated.records) ||
            JSON.stringify(decoded.accounts) !== JSON.stringify(validated.accounts))
          throw new Error('Saved watch accounts could not be verified.');
        recordsEpoch++;
        return issue(decoded, persisted);
      } catch (cause) {
        accountsUnavailable = true; recordsEpoch++;
        throw cause;
      }
    });
  }
  const records = Object.freeze({
    load: (): Promise<WatchRecordSnapshot> => serialized(async () => {
      try {
        const raw = await readRecordRaw();
        const decoded = codec.decode(raw);
        accountsUnavailable = false;
        return issue(decoded, raw);
      } catch (cause) { accountsUnavailable = true; recordsEpoch++; throw cause; }
    }),
    compareAndSet: (expected: WatchRecordSnapshot, next: unknown) => compareAndSetRecords(expected, next),

  });
  return Object.freeze({
    loadAccounts: (): Promise<readonly PublicAccount[]> => serialized(async () => {
      try { const accounts = await readAccounts(); accountsUnavailable = false; return accounts; }
      catch (cause) { accountsUnavailable = true; recordsEpoch++; throw cause; }
    }),
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
    records,
  });
}
