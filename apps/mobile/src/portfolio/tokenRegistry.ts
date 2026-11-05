import { isNativeAccountId } from '../custody/accountIdentity.ts';
import { getAddress } from 'ethers/address';
import { type Erc20Metadata } from '../../../../source/shared/erc20.ts';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId.ts';
import { normalizeErc20Address, parseErc20Metadata } from './erc20Metadata.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { KeyringStoragePort } from '../storage/types.ts';
import {
  type EvmNetworkId,
} from '../custody/networkContext.ts';

export const NATIVE_TOKEN_REGISTRY_KEY = 'native-token-registry-v1';
export const MAX_NATIVE_TOKENS = 256;
export type NativeTokenScope = Readonly<{
  walletFingerprint: string;
  accountId: string;
  address: string;
  network: EvmNetworkId;
  chainId: string;
  registrationHash: string;
}>;
export type NativeTokenInventory = Readonly<{
  revision: number;
  items: readonly Erc20Metadata[];
  collectibles?: readonly SavedCollectible[];
}>;
export type SavedCollectible = Readonly<
  | { contractAddress: string; tokenStandard: 'ERC-721' }
  | { contractAddress: string; tokenStandard: 'ERC-1155'; tokenId: string }
>;
type EntryPayload = Readonly<
  { metadata: Erc20Metadata } | { collectible: SavedCollectible }
>;
type Entry = Omit<NativeTokenScope, 'walletFingerprint'> & EntryPayload;
type RecordValue = Readonly<{
  version: 1;
  walletFingerprint: string;
  revision: number;
  entries: readonly Entry[];
}>;
export class NativeTokenRegistryError extends Error {
  readonly code:
    | 'INVALID'
    | 'CHANGED'
    | 'BUSY'
    | 'CAPACITY'
    | 'DUPLICATE'
    | 'REOPEN_REQUIRED';
  constructor(code: NativeTokenRegistryError['code']) {
    super(code);
    this.code = code;
    this.name = 'NativeTokenRegistryError';
  }
}
const fail = (code: NativeTokenRegistryError['code']): never => {
  throw new NativeTokenRegistryError(code);
};
const copy = (value: unknown) => decodeStorageValue(encodeStorageValue(value));
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    return fail('INVALID');
  return value as Record<string, unknown>;
}
function scope(value: unknown): NativeTokenScope {
  const v = object(copy(value), [
    'walletFingerprint',
    'accountId',
    'address',
    'network',
    'chainId',
    'registrationHash',
  ]);
  if (
    typeof v.walletFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.walletFingerprint) ||
    typeof v.accountId !== 'string' ||
    !isNativeAccountId(v.accountId) ||
    typeof v.address !== 'string' ||
    getAddress(v.address) !== v.address ||
    /^0x0{40}$/i.test(v.address) ||
    typeof v.network !== 'string'
  )
    return fail('INVALID');
  if (typeof v.chainId !== 'string' || !/^[1-9][0-9]{0,15}$/.test(v.chainId) ||
      BigInt(v.chainId) > BigInt(Number.MAX_SAFE_INTEGER) || typeof v.registrationHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(v.registrationHash)) return fail('INVALID');
  return Object.freeze(v as NativeTokenScope);
}
const metadataFields = ['contractAddress', 'name', 'symbol', 'decimals'];
function storedMetadata(value: unknown): Erc20Metadata {
  const m = object(value, metadataFields);
  const metadata = parseErc20Metadata(m);
  if (
    metadata.contractAddress !== m.contractAddress ||
    metadata.name !== m.name ||
    metadata.symbol !== m.symbol ||
    metadata.decimals !== m.decimals
  )
    return fail('INVALID');
  return metadata;
}
function parseCollectible(value: unknown, stored = false): SavedCollectible {
  const standard = value && typeof value === 'object' && 'tokenStandard' in value
    ? value.tokenStandard : undefined;
  if (standard !== 'ERC-721' && standard !== 'ERC-1155') return fail('INVALID');
  const fields = ['contractAddress', 'tokenStandard'];
  if (standard === 'ERC-1155') fields.push('tokenId');
  const row = object(value, fields);
  try {
    const contractAddress = normalizeErc20Address(row.contractAddress);
    if (stored && contractAddress !== row.contractAddress) return fail('INVALID');
    if (standard === 'ERC-721') return Object.freeze({ contractAddress, tokenStandard: standard });
    if (typeof row.tokenId !== 'string') return fail('INVALID');
    const tokenId = normalizeNftTokenId(row.tokenId);
    if (stored && tokenId !== row.tokenId) return fail('INVALID');
    return Object.freeze({ contractAddress, tokenStandard: standard, tokenId });
  } catch {
    return fail('INVALID');
  }
}
export function snapshotSavedCollectible(value: unknown): SavedCollectible {
  return parseCollectible(copy(value));
}
const contractIdentity = (e: Entry) =>
  `${e.accountId}:${e.address}:${e.chainId}:${('metadata' in e ? e.metadata : e.collectible).contractAddress.toLowerCase()}`;
const collectibleId = (collectible: SavedCollectible) =>
  collectible.tokenStandard === 'ERC-1155' ? collectible.tokenId : undefined;
const entryId = (entry: Entry) => 'collectible' in entry ? collectibleId(entry.collectible) : undefined;

function decode(value: unknown, expected: Pick<NativeTokenScope, 'walletFingerprint'>): RecordValue {
  const v = object(copy(value), [
    'version',
    'walletFingerprint',
    'revision',
    'entries',
  ]);
  if (
    v.version !== 1 ||
    v.walletFingerprint !== expected.walletFingerprint ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 0 ||
    !Array.isArray(v.entries) ||
    v.entries.length > MAX_NATIVE_TOKENS
  )
    return fail('INVALID');
  const keys = new Set<string>();
  const contracts = new Set<string>();
  const entries = v.entries.map((value) => {
    const field = value && typeof value === 'object' && Object.hasOwn(value, 'collectible')
      ? 'collectible' : 'metadata';
    const e = object(value, [
      'accountId',
      'address',
      'network',
      'chainId',
      'registrationHash',
      field,
    ]);
    // Retired accounts are retained. Registration changes never relabel old provenance.
    if (
      typeof e.accountId !== 'string' ||
      !isNativeAccountId(e.accountId) ||
      typeof e.address !== 'string' ||
      getAddress(e.address) !== e.address ||
      /^0x0{40}$/i.test(e.address) ||
      typeof e.network !== 'string' ||
      e.network.length > 64 ||
      typeof e.chainId !== 'string' ||
      !/^[1-9][0-9]{0,77}$/.test(e.chainId) ||
      typeof e.registrationHash !== 'string' ||
      !/^0x[0-9a-f]{64}$/.test(e.registrationHash)
    )
      return fail('INVALID');
    const payload = field === 'collectible' ? parseCollectible(e.collectible, true) : storedMetadata(e.metadata);
    const entry = Object.freeze({ ...e, [field]: payload }) as Entry;
    const contract = contractIdentity(entry), tokenId = entryId(entry);
    const key = tokenId === undefined ? contract : `${contract}:${tokenId}`;
    if (keys.has(key) || (tokenId === undefined ? contracts.has(contract) : keys.has(contract))) return fail('INVALID');
    keys.add(key);
    contracts.add(contract);
    return entry;
  });
  return Object.freeze({
    version: 1,
    walletFingerprint: expected.walletFingerprint,
    revision: v.revision as number,
    entries: Object.freeze(entries),
  });
}
/** Complete structural inventory, including retired-account entries; no write or read RPC. */
export function inspectRecoveryTokens(value: unknown, walletFingerprint: string) {
  const record = decode(value, { walletFingerprint });
  return Object.freeze({ tokens: record.entries.length,
    accounts: Object.freeze(record.entries.map((row) => Object.freeze({ id: row.accountId, address: row.address }))) });
}
const sameScope = (entry: Entry, current: NativeTokenScope) =>
  entry.accountId === current.accountId && entry.address === current.address && entry.chainId === current.chainId;
function projected(
  record: RecordValue,
  current: NativeTokenScope
): NativeTokenInventory {
  const items: Erc20Metadata[] = [], collectibles: SavedCollectible[] = [];
  for (const entry of record.entries) {
    if (!sameScope(entry, current)) continue;
    if ('metadata' in entry) items.push(entry.metadata);
    else collectibles.push(entry.collectible);
  }
  return Object.freeze({
    revision: record.revision,
    items: Object.freeze(items),
    ...(collectibles.length ? { collectibles: Object.freeze(collectibles) } : {}),
  });
}
function matchesRemoval(entry: Entry, target: string | SavedCollectible): boolean {
  if (typeof target === 'string') return 'metadata' in entry && entry.metadata.contractAddress === target;
  return 'collectible' in entry && entry.collectible.contractAddress === target.contractAddress &&
    entry.collectible.tokenStandard === target.tokenStandard && entryId(entry) === collectibleId(target);
}
function guard(callback: () => void): void {
  const value: unknown = callback();
  if (value !== undefined) {
    if (value && (typeof value === 'object' || typeof value === 'function'))
      void Promise.resolve(value).catch(() => undefined);
    fail('CHANGED');
  }
}
/** One bounded document. No balance cache or retired-account data is discarded. */
export class NativeTokenRegistry {
  private busy = false;
  private uncertain = false;
  private readonly storage: KeyringStoragePort;
  constructor(storage: KeyringStoragePort) {
    this.storage = storage;
  }
  get requiresReopen(): boolean {
    return this.uncertain;
  }
  private async operation<T>(
    work: (writing: (value: boolean) => void) => Promise<T>
  ): Promise<T> {
    if (this.uncertain) return fail('REOPEN_REQUIRED');
    if (this.busy) return fail('BUSY');
    this.busy = true;
    let writing = false;
    try {
      return await work((value) => {
        writing = value;
      });
    } catch (error) {
      if (writing) this.uncertain = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
  load(
    input: NativeTokenScope,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory> {
    return this.operation(async () => {
      const current = scope(input);
      guard(assertCurrent);
      const raw = await this.storage.get(NATIVE_TOKEN_REGISTRY_KEY);
      guard(assertCurrent);
      if (raw === undefined) {
        return Object.freeze({ revision: 0, items: Object.freeze([]) });
      }
      return projected(decode(raw, current), current);
    });
  }
  add(
    input: NativeTokenScope,
    expectedRevision: number,
    metadata: Erc20Metadata,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory> {
    return this.mutate(
      input,
      expectedRevision,
      { add: { metadata } },
      assertCurrent
    );
  }
  remove(
    input: NativeTokenScope,
    expectedRevision: number,
    contractAddress: string,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory> {
    return this.mutate(
      input,
      expectedRevision,
      { remove: getAddress(contractAddress) },
      assertCurrent
    );
  }
  async addCollectible(
    input: NativeTokenScope,
    expectedRevision: number,
    collectible: SavedCollectible,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory> {
    return this.mutate(input, expectedRevision, { add: { collectible: snapshotSavedCollectible(collectible) } }, assertCurrent);
  }
  async removeCollectible(
    input: NativeTokenScope,
    expectedRevision: number,
    collectible: SavedCollectible,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory> {
    return this.mutate(input, expectedRevision, { remove: snapshotSavedCollectible(collectible) }, assertCurrent);
  }
  private mutate(
    input: NativeTokenScope,
    expectedRevision: number,
    change: { add: EntryPayload } | { remove: string | SavedCollectible },
    assertCurrent: () => void
  ): Promise<NativeTokenInventory> {
    return this.operation(async (writing) => {
      const current = scope(input);
      guard(assertCurrent);
      const raw = await this.storage.get(NATIVE_TOKEN_REGISTRY_KEY);
      guard(assertCurrent);
      const record =
        raw === undefined
          ? {
              version: 1 as const,
              walletFingerprint: current.walletFingerprint,
              revision: 0,
              entries: [],
            }
          : decode(raw, current);
      if (
        record.revision !== expectedRevision ||
        record.revision === Number.MAX_SAFE_INTEGER
      )
        return fail('CHANGED');
      let entries: readonly Entry[];
      if ('add' in change) {
        const payload = 'metadata' in change.add
          ? { metadata: parseErc20Metadata(object(copy(change.add.metadata), metadataFields)) }
          : change.add;
        const { walletFingerprint: _fingerprint, ...bound } = current;
        const entry = Object.freeze({ ...bound, ...payload });
        const contract = contractIdentity(entry), tokenId = entryId(entry);
        // Same-chain standards collide except for distinct ERC-1155 items.
        if (record.entries.some((value) => {
          if (contractIdentity(value) !== contract) return false;
          const otherId = entryId(value);
          return tokenId === undefined || otherId === undefined || tokenId === otherId;
        }))
          return fail('DUPLICATE');
        if (record.entries.length >= MAX_NATIVE_TOKENS) return fail('CAPACITY');
        entries = [...record.entries, entry];
      } else {
        const target = change.remove;
        entries = record.entries.filter(
          (entry) => !(sameScope(entry, current) && matchesRemoval(entry, target))
        );
        if (entries.length === record.entries.length) return fail('CHANGED');
      }
      const next = { ...record, revision: record.revision + 1, entries };
      // Reject the complete proposed value at the byte budget; never truncate.
      try {
        encodeStorageValue(next);
      } catch {
        return fail('CAPACITY');
      }
      const checked = decode(next, current);
      guard(assertCurrent);
      writing(true);
      const committed =
        raw === undefined
          ? await this.storage.createManyIfAbsent({
              [NATIVE_TOKEN_REGISTRY_KEY]: checked,
            })
          : await this.storage.compareAndSet(
              NATIVE_TOKEN_REGISTRY_KEY,
              raw,
              checked
            );
      if (typeof committed !== 'boolean') return fail('INVALID');
      if (!committed) {
        writing(false);
        return fail('CHANGED');
      }
      guard(assertCurrent);
      const after = await this.storage.get(NATIVE_TOKEN_REGISTRY_KEY);
      guard(assertCurrent);
      if (encodeStorageValue(after) !== encodeStorageValue(checked))
        return fail('INVALID');
      return projected(checked, current);
    });
  }
}
