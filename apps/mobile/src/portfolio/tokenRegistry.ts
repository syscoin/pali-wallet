import { getAddress } from 'ethers/address';
import { type Erc20Metadata } from '../../../../source/shared/erc20.ts';
import { parseErc20Metadata } from './erc20Metadata.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { KeyringStoragePort } from '../storage/types.ts';
import {
  getNativeNetwork,
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
}>;
type Entry = Omit<NativeTokenScope, 'walletFingerprint'> &
  Readonly<{ metadata: Erc20Metadata }>;
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
function object(value: unknown, fields: string[]): Record<string, unknown> {
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
    !/^hd:60:(0|[1-9][0-9]{0,3})$/.test(v.accountId) ||
    typeof v.address !== 'string' ||
    getAddress(v.address) !== v.address ||
    /^0x0{40}$/i.test(v.address) ||
    typeof v.network !== 'string'
  )
    return fail('INVALID');
  const network = getNativeNetwork(v.network);
  if (
    v.chainId !== network.chainId ||
    v.registrationHash !== network.registrationHash
  )
    return fail('INVALID');
  return Object.freeze(v as NativeTokenScope);
}
function decode(value: unknown, expected: NativeTokenScope): RecordValue {
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
  const entries = v.entries.map((value) => {
    const e = object(value, [
      'accountId',
      'address',
      'network',
      'chainId',
      'registrationHash',
      'metadata',
    ]);
    // Retired accounts are retained. Registration changes never relabel old provenance.
    if (
      typeof e.accountId !== 'string' ||
      !/^hd:60:(0|[1-9][0-9]{0,3})$/.test(e.accountId) ||
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
    const m = object(e.metadata, [
      'contractAddress',
      'name',
      'symbol',
      'decimals',
    ]);
    const metadata = parseErc20Metadata(m);
    if (
      metadata.contractAddress !== m.contractAddress ||
      metadata.name !== m.name ||
      metadata.symbol !== m.symbol ||
      metadata.decimals !== m.decimals
    )
      return fail('INVALID');
    const entry = Object.freeze({ ...e, metadata }) as Entry;
    const key = identity(entry);
    if (keys.has(key)) return fail('INVALID');
    keys.add(key);
    return entry;
  });
  return Object.freeze({
    version: 1,
    walletFingerprint: expected.walletFingerprint,
    revision: v.revision as number,
    entries: Object.freeze(entries),
  });
}
const identity = (e: Entry) =>
  `${e.accountId}:${e.address}:${e.network}:${e.chainId}:${
    e.registrationHash
  }:${e.metadata.contractAddress.toLowerCase()}`;
const sameScope = (entry: Entry, current: NativeTokenScope) =>
  entry.accountId === current.accountId &&
  entry.address === current.address &&
  entry.network === current.network &&
  entry.chainId === current.chainId &&
  entry.registrationHash === current.registrationHash;
function projected(
  record: RecordValue,
  current: NativeTokenScope
): NativeTokenInventory {
  return Object.freeze({
    revision: record.revision,
    items: Object.freeze(
      record.entries
        .filter((entry) => sameScope(entry, current))
        .map((entry) => entry.metadata)
    ),
  });
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
      { add: metadata },
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
  private mutate(
    input: NativeTokenScope,
    expectedRevision: number,
    change: { add: Erc20Metadata } | { remove: string },
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
        const metadata = parseErc20Metadata(
          object(copy(change.add), [
            'contractAddress',
            'name',
            'symbol',
            'decimals',
          ])
        );
        const { walletFingerprint: _fingerprint, ...bound } = current;
        const entry = Object.freeze({ ...bound, metadata });
        if (record.entries.some((value) => identity(value) === identity(entry)))
          return fail('DUPLICATE');
        if (record.entries.length >= MAX_NATIVE_TOKENS) return fail('CAPACITY');
        entries = [...record.entries, entry];
      } else {
        entries = record.entries.filter(
          (entry) =>
            !(
              sameScope(entry, current) &&
              entry.metadata.contractAddress === change.remove
            )
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
