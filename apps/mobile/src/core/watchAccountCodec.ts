import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { utf8ByteLength } from '../platformRpc.ts';
import { parseUtxoPublicIdentifier } from './utxoIdentifier.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import type { PublicAccount } from './types.ts';
import { validatePublicAccounts } from './watchOnlyAuthority.ts';

export const WATCH_RECORD_LIMITS = Object.freeze({ accounts: 20, bytes: 32 * 1024 });
export type StoredWatchAccount =
  | Readonly<{ kind: 'address'; id: string; name: string; addresses: PublicAccount['addresses'] }>
  | Readonly<{ kind: 'utxo-public'; id: string; name: string; networkId: UtxoNetworkId;
      identifier: string }>;
/** Internal data only. Ordinary public snapshots receive only accounts. */
export type DecodedWatchRecords = Readonly<{
  version: 1;
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
    const raw = dataRecord(value, tag.value === 'address' ? ['kind', 'id', 'name', 'addresses'] : ['kind', 'id', 'name', 'networkId', 'identifier']);
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id) || ids.has(raw.id) ||
        typeof raw.name !== 'string' || raw.name.trim() !== raw.name || raw.name.length < 1 || raw.name.length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(raw.name)) return invalid();
    ids.add(raw.id);
    if (raw.kind === 'address') {
      const account = validatePublicAccounts([{ id: raw.id, name: raw.name, addresses: raw.addresses }])[0]!;
      return Object.freeze({ kind: 'address', ...account });
    }
    if (raw.kind !== 'utxo-public' || typeof raw.identifier !== 'string') return invalid();
    const networkId = getUtxoNetwork(raw.networkId).id;
    const source = parseUtxoPublicIdentifier(raw.identifier, networkId);
    if (source.kind !== 'account') return invalid();
    return Object.freeze({ kind: 'utxo-public', id: raw.id, name: raw.name, networkId, identifier: source.identifier });
  }));
}

/** One canonical public-record codec; SDK validation/derivation supplies account addresses. */
export function createWatchAccountCodec() {
  const validatedLists = new WeakSet<readonly StoredWatchAccount[]>();
  function validate(input: unknown): DecodedWatchRecords {
    const records = snapshotWatchRecords(input), accounts: PublicAccount[] = [], identifiers = new Set<string>();
    for (const record of records) {
      if (record.kind === 'address') { accounts.push(Object.freeze({ id: record.id, name: record.name, addresses: record.addresses })); continue; }
      const source = parseUtxoPublicIdentifier(record.identifier, record.networkId);
      const key = `${record.networkId}:${source.identifier}`;
      if (identifiers.has(key)) return invalid(); identifiers.add(key);
      accounts.push(Object.freeze({ id: record.id, name: record.name, addresses: Object.freeze({ [record.networkId]: source.address }) }));
    }
    validatedLists.add(records);
    return Object.freeze({ version: 1, records, accounts: validatePublicAccounts(accounts) });
  }
  return Object.freeze({ validate,
    decode(raw: string | null): DecodedWatchRecords {
      if (raw === null) return validate([]);
      assertWatchRecordSize(raw); let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return invalid(); }
      assertJsonWorkBudget(parsed, WATCH_RECORD_LIMITS.bytes, 9, 1600);
      const doc = dataRecord(parsed, ['version', 'records']);
      if (doc.version !== 1) return invalid(); return validate(doc.records);
    },
    encode(records: readonly StoredWatchAccount[]): string {
      if (!validatedLists.has(records)) return invalid();
      const raw = JSON.stringify({ version: 1, records }); assertWatchRecordSize(raw); return raw;
    },
  });
}
