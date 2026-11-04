import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { utf8ByteLength } from '../platformRpc.ts';
import { parseBip84DiscoveryCursor, type Bip84DiscoveryCursor } from './bip84Discovery.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import type { PublicAccount } from './types.ts';
import { validatePublicAccounts } from './watchOnlyAuthority.ts';

export const WATCH_RECORD_LIMITS = Object.freeze({ accounts: 20, bytes: 32 * 1024 });
/** Trusted host adapter for the published SDK public entry, never a caller's verified flag. */
export type PublicBip84ValidationPort = Readonly<{
  canonicalize(request: Readonly<{ networkId: UtxoNetworkId; accountKey: string }>): Readonly<{ canonicalKey: string }>;
  deriveFirstReceive(request: Readonly<{ networkId: UtxoNetworkId; canonicalKey: string }>): Readonly<{ address: string }>;
}>;
export type StoredWatchAccount =
  | Readonly<{ kind: 'address'; id: string; name: string; addresses: PublicAccount['addresses'] }>
  | Readonly<{ kind: 'bip84-public'; id: string; name: string; networkId: UtxoNetworkId;
      policy: 'bip84-p2wpkh'; accountKey: string; checkpoint: Bip84DiscoveryCursor | null }>;
/** Internal data only. Ordinary public snapshots receive only accounts. */
export type DecodedWatchRecords = Readonly<{
  version: 1 | 2;
  records: readonly StoredWatchAccount[];
  accounts: readonly PublicAccount[];
}>;
const invalid = (): never => { throw new Error('Invalid saved watch account records'); };
export function assertWatchRecordSize(raw: string): void {
  if (typeof raw !== 'string' || raw.length > WATCH_RECORD_LIMITS.bytes || utf8ByteLength(raw) > WATCH_RECORD_LIMITS.bytes) invalid();
}
function dataRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object') return invalid();
  // Drain a rejected async adapter result, but never accept it as validation.
  if (value instanceof Promise) {
    try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* Reject even an exotic promise with a broken species. */ }
    return invalid();
  }
  if (Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== fields.length) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
    result[field] = descriptor.value;
  }
  return result;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > WATCH_RECORD_LIMITS.accounts || Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    result.push(d.value);
  }
  return result;
}
/** Detach untrusted input before queueing or invoking any host callback. */
export function snapshotWatchRecords(input: unknown): readonly StoredWatchAccount[] {
  assertJsonWorkBudget(input, WATCH_RECORD_LIMITS.bytes, 8, 1500);
  const ids = new Set<string>();
  return Object.freeze(array(input).map((value): StoredWatchAccount => {
    const tag = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'kind') : undefined;
    if (!tag?.enumerable || !Object.hasOwn(tag, 'value')) return invalid();
    const raw = dataRecord(value, tag.value === 'address' ? ['kind', 'id', 'name', 'addresses'] : ['kind', 'id', 'name', 'networkId', 'policy', 'accountKey', 'checkpoint']);
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id) || ids.has(raw.id) ||
        typeof raw.name !== 'string' || raw.name.trim() !== raw.name || raw.name.length < 1 || raw.name.length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(raw.name)) return invalid();
    ids.add(raw.id);
    if (raw.kind === 'address') {
      const account = validatePublicAccounts([{ id: raw.id, name: raw.name, addresses: raw.addresses }])[0]!;
      return Object.freeze({ kind: 'address', ...account });
    }
    if (raw.kind !== 'bip84-public' || raw.policy !== 'bip84-p2wpkh' || typeof raw.accountKey !== 'string' ||
        raw.accountKey.length < 1 || raw.accountKey.length > 112 || !/^[\x21-\x7e]+$/.test(raw.accountKey)) return invalid();
    const networkId = getUtxoNetwork(raw.networkId as UtxoNetworkId).id;
    const checkpoint = raw.checkpoint === null ? null : parseBip84DiscoveryCursor(raw.checkpoint, { networkId, sourceId: raw.id });
    return Object.freeze({ kind: 'bip84-public', id: raw.id, name: raw.name, networkId,
      policy: 'bip84-p2wpkh', accountKey: raw.accountKey, checkpoint });
  }));
}

/** Shape checks supplement the trusted SDK adapter; they do not parse a key or prove ownership. */
export function createWatchAccountCodec(port: PublicBip84ValidationPort) {
  const captured = dataRecord(port, ['canonicalize', 'deriveFirstReceive']);
  if (typeof captured.canonicalize !== 'function' || typeof captured.deriveFirstReceive !== 'function') return invalid();
  const canonicalize = captured.canonicalize as PublicBip84ValidationPort['canonicalize'];
  const derive = captured.deriveFirstReceive as PublicBip84ValidationPort['deriveFirstReceive'];
  const invoke = <T>(operation: () => T): T => {
    try { return operation(); } catch { return invalid(); }
  };
  const validatedLists = new WeakSet<readonly StoredWatchAccount[]>();
  function validate(input: unknown, boundary?: () => void): DecodedWatchRecords {
    const checkBoundary = () => {
      if (!boundary) return;
      const result: unknown = boundary();
      if (result !== undefined) {
        if (result instanceof Promise) void Promise.prototype.then.call(result, undefined, () => undefined);
        return invalid();
      }
    };
    const guarded = <T>(operation: () => T): T => {
      checkBoundary();
      try { return invoke(operation); }
      finally { checkBoundary(); }
    };
    const detached = snapshotWatchRecords(input), accounts: PublicAccount[] = [], keys = new Set<string>();
    const records = detached.map((record): StoredWatchAccount => {
      if (record.kind === 'address') {
        accounts.push(Object.freeze({ id: record.id, name: record.name, addresses: record.addresses })); return record;
      }
      const request = Object.freeze({ networkId: record.networkId, accountKey: record.accountKey });
      const output = dataRecord(guarded(() => canonicalize(request)), ['canonicalKey']);
      if (typeof output.canonicalKey !== 'string' || !/^zpub[1-9A-HJ-NP-Za-km-z]{96,108}$/.test(output.canonicalKey)) return invalid();
      const key = output.canonicalKey;
      if (dataRecord(guarded(() => canonicalize(Object.freeze({ networkId: record.networkId, accountKey: key }))), ['canonicalKey']).canonicalKey !== key) return invalid();
      const identity = `${record.networkId}:${key}`;
      if (keys.has(identity)) return invalid();
      keys.add(identity);
      const first = dataRecord(guarded(() => derive(Object.freeze({ networkId: record.networkId, canonicalKey: key }))), ['address']);
      const address = normalizeUtxoAddress(first.address, record.networkId);
      accounts.push(Object.freeze({ id: record.id, name: record.name, addresses: Object.freeze({ [record.networkId]: address }) }));
      return Object.freeze({ ...record, accountKey: key });
    });
    // Retain existing public projection validation and never include an account key.
    const frozen = Object.freeze(records);
    validatedLists.add(frozen);
    return Object.freeze({ version: 2, records: frozen, accounts: validatePublicAccounts(accounts) });
  }
  return Object.freeze({
    validate,
    decode(raw: string | null, boundary?: () => void): DecodedWatchRecords {
      if (raw === null) return Object.freeze({ version: 1, records: Object.freeze([]), accounts: Object.freeze([]) });
      assertWatchRecordSize(raw);
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return invalid(); }
      assertJsonWorkBudget(parsed, WATCH_RECORD_LIMITS.bytes, 9, 1600);
      const version = parsed && typeof parsed === 'object' ? Object.getOwnPropertyDescriptor(parsed, 'version')?.value : undefined;
      if (version === 1) {
        const doc = dataRecord(parsed, ['version', 'accounts']);
        const accounts = validatePublicAccounts(doc.accounts);
        return Object.freeze({ version: 1, accounts, records: Object.freeze(accounts.map((account) => Object.freeze({ kind: 'address' as const, ...account }))) });
      }
      if (version !== 2) return invalid();
      return validate(dataRecord(parsed, ['version', 'records']).records, boundary);
    },
    encode(records: readonly StoredWatchAccount[]): string {
      if (!validatedLists.has(records)) return invalid();
      const raw = JSON.stringify({ version: 2, records }); assertWatchRecordSize(raw); return raw;
    },
  });
}
