import { utf8ByteLength } from '../platformRpc.ts';
import { parseAccountSelection, type AccountSelection } from './accountDirectory.ts';
import type { PublicAccount } from './types.ts';
import { verifyUtxoRegistration, type UtxoFetch } from './utxoReadSession.ts';
import { UTXO_NETWORKS, findUtxoNetwork, isCustomUtxoNetworkId, projectUtxoRegistration, utxoRegistrationData, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import { createWatchAccountCodec, snapshotWatchRecords, type DecodedWatchRecords, type StoredWatchAccount } from './watchAccountCodec.ts';

export const PUBLIC_ACCOUNTS_KEY = 'pali.mobile.public-accounts.v1';
export const WATCH_UTXO_NETWORKS_KEY = 'pali.mobile.watch-utxo-networks.v1';
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
export type WatchUtxoNetworkDraft = Readonly<{ endpoint: string; name: string; explorer: string }>;
export type WatchUtxoNetworkSettings = Readonly<{ networks: readonly UtxoNetwork[] }>;
export class WatchUtxoNetworkReloadRequiredError extends Error {
  constructor(message = 'Saved UTXO networks changed. Reopen them before saving.') {
    super(message);
    this.name = 'WatchUtxoNetworkReloadRequiredError';
  }
}
export type WatchRecordRepository = Readonly<{
  load(): Promise<WatchRecordSnapshot>;
  assertNetworkCurrent(snapshot: WatchRecordSnapshot): void;
  compareAndSet(expected: WatchRecordSnapshot, next: unknown): Promise<WatchRecordSnapshot>;
}>;
/** One same-process serialized repository. This is not cross-process atomic CAS. */
export function createPublicAccountStorage(port: PublicStoragePort, fetch?: UtxoFetch) {
  let queue: Promise<void> = Promise.resolve();
  let accountsUnavailable = false;
  let recordsEpoch = 0;
  let networkEpoch = 0;
  const snapshots = new WeakMap<WatchRecordSnapshot, {
    raw: string | null; networkRaw: string | null; used: boolean; epoch: number; networkEpoch: number;
  }>();
  const settings = new WeakMap<WatchUtxoNetworkSettings, { raw: string | null; epoch: number }>();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function readSelection(): Promise<AccountSelection | null> {
    const raw = await port.get(ACCOUNT_SELECTION_KEY);
    if (raw === null) return null;
    assertSize(raw, 256);
    return parseAccountSelection(JSON.parse(raw));
  }
  function issue(value: DecodedWatchRecords, raw: string | null, networkRaw: string | null): WatchRecordSnapshot {
    snapshots.set(value, { raw, networkRaw, used: false, epoch: recordsEpoch, networkEpoch });
    return value;
  }
  async function readRecordRaw(): Promise<string | null> {
    try { return await port.get(PUBLIC_ACCOUNTS_KEY); }
    catch { throw new Error('Saved watch records could not be read. Reopen them before saving.'); }
  }
  function decodeNetworks(raw: string | null) {
    if (raw === null) return UTXO_NETWORKS;
    assertSize(raw, 8192);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 16) throw new Error('Invalid saved UTXO networks');
    const custom = parsed.map(projectUtxoRegistration);
    const all = [...UTXO_NETWORKS, ...custom];
    if (custom.some(({ id }) => !isCustomUtxoNetworkId(id)) ||
        new Set(all.map(({ id }) => id)).size !== all.length ||
        new Set(all.map(({ chainId, endpoint }) => JSON.stringify([chainId, endpoint]))).size !== all.length)
      throw new Error('Duplicate or invalid saved UTXO network');
    return Object.freeze(all);
  }
  async function readNetworks() {
    const raw = await port.get(WATCH_UTXO_NETWORKS_KEY);
    return { raw, networks: decodeNetworks(raw) };
  }
  function issueSettings(networks: readonly UtxoNetwork[], raw: string | null) {
    const snapshot = Object.freeze({ networks });
    settings.set(snapshot, { raw, epoch: networkEpoch });
    return snapshot;
  }
  const loadNetworkSettings = () => serialized(async () => {
    const { raw, networks } = await readNetworks();
    return issueSettings(networks, raw);
  });
  function networkOwner(expected: WatchUtxoNetworkSettings, signal: AbortSignal) {
    const ticket = settings.get(expected);
    const check = () => {
      if (!ticket || !signal || signal.aborted || networkEpoch !== ticket.epoch)
        throw new WatchUtxoNetworkReloadRequiredError();
    };
    check();
    return { raw: ticket!.raw, check };
  }
  async function saveNetworks(owner: ReturnType<typeof networkOwner>, next: readonly UtxoNetwork[], removed?: UtxoNetworkId) {
    const encoded = JSON.stringify(next.filter(({ id }) => isCustomUtxoNetworkId(id)).map(utxoRegistrationData));
    const admitted = decodeNetworks(encoded);
    return serialized(async () => {
      owner.check();
      const current = await readNetworks();
      owner.check();
      if (current.raw !== owner.raw) throw new WatchUtxoNetworkReloadRequiredError();
      if (removed) {
        const records = createWatchAccountCodec(current.networks).decode(await readRecordRaw()).records;
        owner.check();
        if (records.some((record) => record.kind === 'utxo-public' ? record.networkId === removed : Object.hasOwn(record.addresses, removed)))
          throw new Error('Remove the watch account using this network first.');
      }
      if (encoded === current.raw) return issueSettings(admitted, encoded);
      // Retire the old authority before dispatching a write whose result may be uncertain.
      networkEpoch++;
      try { await port.set(WATCH_UTXO_NETWORKS_KEY, encoded); }
      catch { /* Exact readback distinguishes a lost acknowledgement. */ }
      try {
        const observed = await readNetworks();
        if (observed.raw === encoded) return issueSettings(observed.networks, encoded);
      } catch { /* No verified snapshot can be issued. */ }
      throw new WatchUtxoNetworkReloadRequiredError('Saved UTXO networks could not be verified.');
    });
  }
  const utxoNetworkSettings = Object.freeze({
    load: loadNetworkSettings,
    async save(expected: WatchUtxoNetworkSettings, draft: WatchUtxoNetworkDraft, signal: AbortSignal, editId?: UtxoNetworkId) {
      if (!fetch) throw new Error('UTXO network verification is unavailable');
      const owner = networkOwner(expected, signal);
      const previous = editId === undefined ? undefined : findUtxoNetwork(editId, expected.networks);
      if (editId !== undefined && (!previous || !isCustomUtxoNetworkId(editId))) throw new Error('This network cannot be edited here.');
      let selected: UtxoNetwork;
      try { selected = await verifyUtxoRegistration(draft, previous, { fetch, timeoutMs: 10_000 }, signal, owner.check); }
      catch (error) { if (!signal.aborted) owner.check(); throw error; }
      owner.check();
      if ((!previous && findUtxoNetwork(selected.id, expected.networks)) ||
          expected.networks.some((network) => network.id !== selected.id &&
            network.chainId === selected.chainId && network.endpoint === selected.endpoint))
        throw new Error('This UTXO network endpoint is already saved.');
      return saveNetworks(owner, [...expected.networks.filter(({ id }) => id !== selected.id), selected]);
    },
    remove(expected: WatchUtxoNetworkSettings, id: UtxoNetworkId, signal: AbortSignal) {
      const owner = networkOwner(expected, signal);
      if (!isCustomUtxoNetworkId(id) || !findUtxoNetwork(id, expected.networks)) throw new Error('This network cannot be removed here.');
      return saveNetworks(owner, expected.networks.filter((entry) => entry.id !== id), id);
    },
  });
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
    const ticket = snapshots.get(expected);
    if (!ticket || ticket.used) return Promise.reject(new Error('Reopen saved watch records before saving'));
    // Detach before entering the queue; no host validation callback runs here.
    const detached = snapshotWatchRecords(next, expected.utxoNetworks);
    return serialized(async () => {
      if (ticket.used) throw new Error('Reopen saved watch records before saving');
      if (accountsUnavailable) throw new Error('Saved watch records are unavailable. Reopen them before saving.');
      if (ticket.epoch !== recordsEpoch || ticket.networkEpoch !== networkEpoch) throw new Error('Reopen saved watch records before saving');
      const codec = createWatchAccountCodec(expected.utxoNetworks);
      const validated = codec.validate(detached);
      retainedSources(expected, validated.records);
      const raw = codec.encode(validated.records);
      ticket.used = true;
      try {
        const networks = await readNetworks();
        if (networks.raw !== ticket.networkRaw) throw new Error('Saved UTXO networks changed. Reopen them before saving.');
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
        return issue(decoded, persisted, networks.raw);
      } catch (cause) {
        accountsUnavailable = true; recordsEpoch++;
        throw cause;
      }
    });
  }
  const records = Object.freeze({
    load: (): Promise<WatchRecordSnapshot> => serialized(async () => {
      try {
        const { raw: networkRaw, networks } = await readNetworks();
        const raw = await readRecordRaw();
        const decoded = createWatchAccountCodec(networks).decode(raw);
        accountsUnavailable = false;
        return issue(decoded, raw, networkRaw);
      } catch (cause) { accountsUnavailable = true; recordsEpoch++; throw cause; }
    }),
    assertNetworkCurrent(snapshot: WatchRecordSnapshot) {
      const ticket = snapshots.get(snapshot);
      if (!ticket || networkEpoch !== ticket.networkEpoch) throw new Error('Saved UTXO networks changed. Reopen the account.');
    },
    compareAndSet: (expected: WatchRecordSnapshot, next: unknown) => compareAndSetRecords(expected, next),

  });
  return Object.freeze({
    loadAccounts: async (): Promise<readonly PublicAccount[]> => (await records.load()).accounts,
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
    /** Removal may clear only an existing native hint, after retiring its owner. */
    clearNativeSelection: (assertCurrent: () => void): Promise<void> => {
      const check = () => {
        const result: unknown = assertCurrent();
        if (result !== undefined) {
          if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
          throw new Error('Saved account choice changed');
        }
      };
      return serialized(async () => {
        check();
        const selected = await readSelection();
        check();
        if (!selected || selected.kind === 'watch') return;
        try { await port.set(ACCOUNT_SELECTION_KEY, 'null'); } catch { /* Exact readback resolves a lost acknowledgement. */ }
        if (await readSelection() !== null) throw new Error('Saved account choice could not be cleared.');
        check();
      });
    },
    records,
    utxoNetworkSettings,
  });
}

export type WatchUtxoNetworksView = ReturnType<typeof createPublicAccountStorage>['utxoNetworkSettings'];
