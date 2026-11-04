import { getAddress } from 'ethers/address';
import { computeAddress } from 'ethers/transaction';
import { nativeTransferJournalKey, terminalJournalForRemoval, type TransferJournalEntry } from './transferJournal.ts';
import { RPC_ENDPOINTS } from '../platformRpc.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { KeyringStoragePort } from '../storage/types.ts';

export const WALLET_CATALOGUE_KEY = 'native-wallet-catalogue-v1';
export const MAX_HD_ACCOUNTS = 20;
export const MAX_HD_ACCOUNT_INDEX = 4095;
const accountId = (index: number) => `hd:60:${index}`;

export type NativeCatalogueAccount = Readonly<{
  id: string;
  type: 'HDAccount';
  index: number;
  slip44: 60;
  address: string;
  label: string;
}>;
/** Public projection only. No encrypted private keys or session state. */
export type NativeWalletCatalogueSnapshot = Readonly<{
  revision: number;
  removed: readonly Readonly<{ id: string; index: number }>[];
  accounts: readonly NativeCatalogueAccount[];
  networks: readonly Readonly<{
    id: 'ethereum'; kind: 'evm'; chainId: '1'; slip44: 60;
    rpcUrl: string; symbol: 'ETH'; decimals: 18;
  }>[];
  active: Readonly<{ accountId: string; networkId: 'ethereum' }>;
}>;
/** Supplied only after SDK authentication and account derivation. */
export type NativeWalletCatalogueIdentity = Readonly<{
  walletFingerprint: string; address: string; publicKey: string;
}>;
export type DerivedCatalogueIdentity = Readonly<{ address: string; publicKey: string }>;
type CatalogueAccount = NativeCatalogueAccount & { readonly publicKey: string };
type CatalogueRecord = Omit<NativeWalletCatalogueSnapshot, 'accounts' | 'removed'> & Readonly<{
  version: 1; walletFingerprint: string; nextIndex: number;
  retiredIndices: readonly number[]; accounts: readonly CatalogueAccount[];
}>;
export type CatalogueMutation =
  | Readonly<{ kind: 'create'; index: number; address: string; publicKey: string; label: string }>
  | Readonly<{ kind: 'restore'; index: number; address: string; publicKey: string; label: string }>
  | Readonly<{ kind: 'select'; id: string }>
  | Readonly<{ kind: 'rename'; id: string; label: string }>
  | Readonly<{ kind: 'remove'; id: string; journal: TransferJournalEntry | null }>;

export class WalletCatalogueError extends Error {
  readonly code: 'CATALOGUE_INVALID' | 'CATALOGUE_CONTEXT_CHANGED' | 'CATALOGUE_REOPEN_REQUIRED' | 'CATALOGUE_BUSY' | 'CATALOGUE_LIMIT' | 'CATALOGUE_NOT_REMOVABLE';
  constructor(code: WalletCatalogueError['code']) { super(code); this.code = code; this.name = 'WalletCatalogueError'; }
}
const invalid = (): never => { throw new WalletCatalogueError('CATALOGUE_INVALID'); };
const changed = (): never => { throw new WalletCatalogueError('CATALOGUE_CONTEXT_CHANGED'); };
function snapshot(value: unknown): unknown { return decodeStorageValue(encodeStorageValue(value)); }
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function publicIdentity(value: unknown): DerivedCatalogueIdentity {
  const raw = object(value, ['address', 'publicKey']);
  if (typeof raw.address !== 'string' || typeof raw.publicKey !== 'string' ||
      !/^0x(?:(?:02|03)[0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/.test(raw.publicKey)) return invalid();
  let address: string;
  try {
    address = getAddress(raw.address);
    if (computeAddress(raw.publicKey) !== address || /^0x0{40}$/i.test(address)) return invalid();
  } catch { return invalid(); }
  return Object.freeze({ address, publicKey: raw.publicKey.toLowerCase() });
}
function identity(value: NativeWalletCatalogueIdentity): NativeWalletCatalogueIdentity {
  const raw = object(snapshot(value), ['walletFingerprint', 'address', 'publicKey']);
  if (typeof raw.walletFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(raw.walletFingerprint)) return invalid();
  return Object.freeze({ walletFingerprint: raw.walletFingerprint,
    ...publicIdentity({ address: raw.address, publicKey: raw.publicKey }) });
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value || !value.isWellFormed() || value.trim() !== value ||
      value.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return invalid();
  return value;
}
function fresh(expected: NativeWalletCatalogueIdentity): CatalogueRecord {
  return Object.freeze({
    version: 1, revision: 0, walletFingerprint: expected.walletFingerprint,
    nextIndex: 1, retiredIndices: Object.freeze([]),
    accounts: Object.freeze([Object.freeze({ id: accountId(0), type: 'HDAccount', index: 0, slip44: 60,
      address: expected.address, publicKey: expected.publicKey, label: 'Account 1' })]),
    networks: Object.freeze([Object.freeze({ id: 'ethereum', kind: 'evm', chainId: '1', slip44: 60,
      rpcUrl: RPC_ENDPOINTS.ethereum!, symbol: 'ETH', decimals: 18 })]),
    active: Object.freeze({ accountId: accountId(0), networkId: 'ethereum' }),
  });
}
function decode(value: unknown, expected: NativeWalletCatalogueIdentity): CatalogueRecord {
  const raw = object(snapshot(value), ['version', 'revision', 'walletFingerprint', 'nextIndex', 'retiredIndices', 'accounts', 'networks', 'active']);
  if (raw.version !== 1 || raw.walletFingerprint !== expected.walletFingerprint ||
      !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 ||
      !Number.isSafeInteger(raw.nextIndex) || (raw.nextIndex as number) < 1 || (raw.nextIndex as number) > MAX_HD_ACCOUNT_INDEX + 1 ||
      !Array.isArray(raw.accounts) || raw.accounts.length < 1 || raw.accounts.length > MAX_HD_ACCOUNTS ||
      !Array.isArray(raw.retiredIndices) || !Array.isArray(raw.networks) || raw.networks.length !== 1) return invalid();
  const used = new Set<number>();
  const addresses = new Set<string>();
  const accounts: CatalogueAccount[] = raw.accounts.map((value) => {
    const a = object(value, ['id', 'type', 'index', 'slip44', 'address', 'publicKey', 'label']);
    if (!Number.isSafeInteger(a.index) || (a.index as number) < 0 || (a.index as number) >= (raw.nextIndex as number) ||
        a.id !== accountId(a.index as number) || a.type !== 'HDAccount' || a.slip44 !== 60 || used.has(a.index as number)) return invalid();
    const key = publicIdentity({ address: a.address, publicKey: a.publicKey });
    if (key.address !== a.address || key.publicKey !== a.publicKey || addresses.has(key.address)) return invalid();
    used.add(a.index as number); addresses.add(key.address);
    return Object.freeze({ id: a.id as string, type: 'HDAccount', index: a.index as number, slip44: 60,
      ...key, label: label(a.label) });
  });
  const retired = raw.retiredIndices.map((index) => {
    if (!Number.isSafeInteger(index) || index <= 0 || index >= (raw.nextIndex as number) || used.has(index)) return invalid();
    used.add(index); return index as number;
  });
  if (used.size !== raw.nextIndex || !accounts.some((a) => a.index === 0 && a.address === expected.address && a.publicKey === expected.publicKey) ||
      accounts.some((a, i) => i > 0 && accounts[i - 1]!.index >= a.index) ||
      retired.some((n, i) => i > 0 && retired[i - 1]! >= n)) return invalid();
  const network = object(raw.networks[0], ['id', 'kind', 'chainId', 'slip44', 'rpcUrl', 'symbol', 'decimals']);
  const active = object(raw.active, ['accountId', 'networkId']);
  if (network.id !== 'ethereum' || network.kind !== 'evm' || network.chainId !== '1' || network.slip44 !== 60 ||
      network.rpcUrl !== RPC_ENDPOINTS.ethereum || network.symbol !== 'ETH' || network.decimals !== 18 ||
      active.networkId !== 'ethereum' || !accounts.some((a) => a.id === active.accountId)) return invalid();
  return Object.freeze({ ...fresh(expected), revision: raw.revision as number, nextIndex: raw.nextIndex as number,
    retiredIndices: Object.freeze(retired), accounts: Object.freeze(accounts),
    active: Object.freeze({ accountId: active.accountId as string, networkId: 'ethereum' }) });
}
function projection(record: CatalogueRecord): NativeWalletCatalogueSnapshot {
  return Object.freeze({ revision: record.revision,
    removed: Object.freeze(record.retiredIndices.map((index) => Object.freeze({ id: accountId(index), index }))),
    accounts: Object.freeze(record.accounts.map(({ publicKey: _publicKey, ...account }) => Object.freeze(account))),
    networks: record.networks, active: record.active });
}
function guardFor(assertCurrent: () => void): () => void {
  return () => {
    const result: unknown = assertCurrent();
    if (result !== undefined) {
      if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
      changed();
    }
  };
}

/** Version 1 is unreleased; only exact current-schema records or absence are admitted. */
export class NativeWalletCatalogue {
  private busy = false;
  private uncertain = false;
  private record: CatalogueRecord | null = null;
  private stored: unknown;
  private root: NativeWalletCatalogueIdentity | null = null;
  private readonly storage: KeyringStoragePort;
  constructor(storage: KeyringStoragePort) { this.storage = storage; }
  get requiresReopen(): boolean { return this.uncertain; }
  get nextIndex(): number { if (!this.record) return changed(); return this.record.nextIndex; }

  reconcile(value: NativeWalletCatalogueIdentity, assertCurrent: () => void,
    derive?: (index: number) => Promise<DerivedCatalogueIdentity>): Promise<NativeWalletCatalogueSnapshot> {
    if (this.busy) return Promise.reject(new WalletCatalogueError('CATALOGUE_BUSY'));
    if (this.uncertain) return Promise.reject(new WalletCatalogueError('CATALOGUE_REOPEN_REQUIRED'));
    this.busy = true;
    const guard = guardFor(assertCurrent);
    let expected: NativeWalletCatalogueIdentity;
    try { expected = identity(value); guard(); } catch (error) { this.busy = false; return Promise.reject(error); }
    let writing = false;
    return (async () => {
      try {
        let raw = await this.storage.get(WALLET_CATALOGUE_KEY); guard();
        if (raw === undefined) {
          writing = true;
          const created = await this.storage.createManyIfAbsent({ [WALLET_CATALOGUE_KEY]: fresh(expected) }); guard();
          if (typeof created !== 'boolean') return invalid();
          raw = await this.storage.get(WALLET_CATALOGUE_KEY); guard();
          if (raw === undefined) return invalid();
        }
        const record = decode(raw, expected);
        for (const account of record.accounts) {
          if (account.index === 0) continue;
          if (!derive) return invalid();
          const actual = publicIdentity(snapshot(await derive(account.index))); guard();
          if (actual.address !== account.address || actual.publicKey !== account.publicKey) return invalid();
        }
        this.root = expected; this.record = record; this.stored = snapshot(raw);
        return projection(record);
      } catch (error) { if (writing) this.uncertain = true; throw error; }
      finally { this.busy = false; }
    })();
  }

  mutate(expectedRevision: number, input: CatalogueMutation, assertCurrent: () => void): Promise<NativeWalletCatalogueSnapshot> {
    if (this.busy) return Promise.reject(new WalletCatalogueError('CATALOGUE_BUSY'));
    if (this.uncertain) return Promise.reject(new WalletCatalogueError('CATALOGUE_REOPEN_REQUIRED'));
    this.busy = true;
    const guard = guardFor(assertCurrent);
    let next: CatalogueRecord;
    let cleanup: Readonly<Record<string, unknown>> | undefined;
    try {
      guard();
      const record = this.record;
      if (!record || !this.root || record.revision !== expectedRevision || record.revision === Number.MAX_SAFE_INTEGER) return changed();
      const mutation = snapshot(input) as CatalogueMutation;
      let accounts = [...record.accounts];
      let active = record.active;
      let nextIndex = record.nextIndex;
      let retiredIndices = record.retiredIndices;
      if (mutation.kind === 'create' || mutation.kind === 'restore') {
        object(mutation, ['kind', 'index', 'address', 'publicKey', 'label']);
        if (accounts.length >= MAX_HD_ACCOUNTS || (mutation.kind === 'create' && nextIndex > MAX_HD_ACCOUNT_INDEX)) throw new WalletCatalogueError('CATALOGUE_LIMIT');
        if (mutation.kind === 'create' ? mutation.index !== nextIndex : !retiredIndices.includes(mutation.index)) return changed();
        const key = publicIdentity({ address: mutation.address, publicKey: mutation.publicKey });
        accounts.push(Object.freeze({ id: accountId(mutation.index), type: 'HDAccount', index: mutation.index, slip44: 60, ...key, label: label(mutation.label) }));
        accounts.sort((a, b) => a.index - b.index);
        active = Object.freeze({ accountId: accountId(mutation.index), networkId: 'ethereum' });
        if (mutation.kind === 'create') nextIndex++;
        else retiredIndices = Object.freeze(retiredIndices.filter((index) => index !== mutation.index));
      } else {
        object(mutation, mutation.kind === 'rename' ? ['kind', 'id', 'label'] : mutation.kind === 'remove' ? ['kind', 'id', 'journal'] : ['kind', 'id']);
        const account = accounts.find((a) => a.id === mutation.id);
        if (!account) return changed();
        if (mutation.kind === 'select') active = Object.freeze({ accountId: account.id, networkId: 'ethereum' });
        else if (mutation.kind === 'rename') accounts = accounts.map((a) => a.id === account.id ? Object.freeze({ ...a, label: label(mutation.label) }) : a);
        else if (mutation.kind === 'remove') {
          if (account.index === 0 || account.id === active.accountId || accounts.length <= 1) throw new WalletCatalogueError('CATALOGUE_NOT_REMOVABLE');
          const entry = mutation.journal === null ? undefined : terminalJournalForRemoval(mutation.journal, { walletFingerprint: record.walletFingerprint, address: account.address, chainId: '1' });
          cleanup = { [nativeTransferJournalKey(account.index)]: entry };
          accounts = accounts.filter((a) => a.id !== account.id);
          retiredIndices = Object.freeze([...retiredIndices, account.index].sort((a, b) => a - b));
        } else return invalid();
      }
      next = decode({ ...record, revision: record.revision + 1, accounts, active, nextIndex, retiredIndices }, this.root);
    } catch (error) { this.busy = false; return Promise.reject(error); }
    let writing = false;
    return (async () => {
      try {
        guard(); writing = true;
        const committed = await this.storage.compareAndSet(WALLET_CATALOGUE_KEY, this.stored, next, cleanup);
        if (typeof committed !== 'boolean') return invalid();
        if (!committed) { writing = false; this.record = null; return changed(); }
        guard();
        const raw = await this.storage.get(WALLET_CATALOGUE_KEY); guard();
        if (encodeStorageValue(raw) !== encodeStorageValue(next)) return invalid();
        this.record = next; this.stored = snapshot(raw);
        return projection(next);
      } catch (error) { if (writing) this.uncertain = true; throw error; }
      finally { this.busy = false; }
    })();
  }
}
