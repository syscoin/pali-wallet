import { getAddress } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { KeyringStoragePort } from '../storage/types.ts';
import { getNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from './networkContext.ts';
import { assertTransferIntentEnvelope, snapshotErc20TransferIntent, type Erc20TransferIntent } from './transferIntent.ts';
import type { LocalActivityRecord, TerminalActivityRecord } from '../activity/types.ts';
import { nativeAccountId, type NativeAccountType } from './accountIdentity.ts';

const STORAGE_KEY = 'native-evm-transfer-v1';
const MAX_RAW_CHARACTERS = 4096;
export const MAX_JOURNAL_ENTRIES = 12;
const CAS_ATTEMPTS = 3;
const queues = new WeakMap<KeyringStoragePort, Promise<void>>();
const quarantined = new WeakSet<KeyringStoragePort>();
export const journalRequiresReopen = (storage: KeyringStoragePort): boolean => quarantined.has(storage);
export function nativeTransferJournalKey(accountIndex: number, type: NativeAccountType = 'HDAccount'): string {
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0 || accountIndex > 4095) throw new TransferJournalError('CORRUPT');
  const id = nativeAccountId(type, accountIndex);
  return type === 'HDAccount' && accountIndex === 0 ? STORAGE_KEY : `${STORAGE_KEY}:${id}`;
}
export type TransferJournalPhase = 'signed' | 'attempted' | 'submitted' | 'confirmed' | 'reverted' | 'nonce-consumed';
export type TransferJournalScope = Readonly<{ walletFingerprint: string; address: string; chainId: string }>;
/** Existing private transfer-host DTO; never persisted as the container itself. */
export type TransferJournalEntry = Readonly<{
  version: 1; scope: TransferJournalScope; phase: TransferJournalPhase;
  rawTransaction: string; hash: string; nonce: number; createdAt: number;
  intent?: Erc20TransferIntent;
}>;
type ContainerEntry = Readonly<{
  registration: NativeNetworkRegistration; phase: TransferJournalPhase;
  rawTransaction: string; hash: string; nonce: number; createdAt: number;
  intent?: Erc20TransferIntent;
}>;
export type TransferJournalContainer = Readonly<{
  version: 2; revision: number; walletFingerprint: string;
  account: Readonly<{ id: string; index: number; type: NativeAccountType; slip44: 60; address: string }>;
  entries: readonly ContainerEntry[];
}>;
export type JournalRemovalSnapshot = TransferJournalContainer | TransferJournalEntry;
export class TransferJournalError extends Error {
  readonly code: 'CORRUPT' | 'CONTEXT_CHANGED' | 'PENDING_TRANSFER' | 'INVALID_TRANSITION' | 'CAPACITY' | 'CONFLICT' | 'REOPEN_REQUIRED' | 'HISTORY_UNAVAILABLE';
  constructor(code: TransferJournalError['code']) { super(code); this.name = 'TransferJournalError'; this.code = code; }
}
const corrupt = (): never => { throw new TransferJournalError('CORRUPT'); };
const terminal = (phase: TransferJournalPhase): boolean => ['confirmed', 'reverted', 'nonce-consumed'].includes(phase);
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return corrupt();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return corrupt();
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((key) => typeof key !== 'string' || !keys.includes(key))) return corrupt();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return corrupt();
    result[name] = descriptor.value;
  }
  return result;
}
function clone(value: unknown): unknown {
  try { return decodeStorageValue(encodeStorageValue(value)); } catch { return corrupt(); }
}
function scopeSnapshot(value: TransferJournalScope): TransferJournalScope {
  const scope = exact(value, ['walletFingerprint', 'address', 'chainId']);
  if (typeof scope.walletFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(scope.walletFingerprint) ||
      typeof scope.chainId !== 'string' || !/^[1-9][0-9]{0,15}$/.test(scope.chainId) ||
      !NATIVE_NETWORKS.some((network) => network.chainId === scope.chainId) || typeof scope.address !== 'string') return corrupt();
  let address: string;
  try { address = getAddress(scope.address); } catch { return corrupt(); }
  if (/^0x0{40}$/i.test(address)) return corrupt();
  return Object.freeze({ walletFingerprint: scope.walletFingerprint, address, chainId: scope.chainId });
}
function registrationSnapshot(value: unknown): NativeNetworkRegistration {
  const raw = exact(value, ['id', 'kind', 'chainId', 'slip44', 'rpcUrl', 'symbol', 'decimals', 'testnet', 'registrationHash']);
  if (typeof raw.id !== 'string') return corrupt();
  let expected: NativeNetworkRegistration;
  try { expected = getNativeNetwork(raw.id); } catch { return corrupt(); }
  if (Object.entries(expected).some(([key, field]) => raw[key] !== field)) return corrupt();
  return expected;
}
function signedIdentity(raw: unknown, scope: TransferJournalScope, intent?: Erc20TransferIntent): { hash: string; nonce: number } {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_CHARACTERS || !/^0x(?:[0-9a-f]{2})+$/.test(raw)) return corrupt();
  try {
    const tx = Transaction.from(raw);
    if (!tx.isSigned() || (tx.type !== 0 && tx.type !== 2) || tx.chainId !== BigInt(scope.chainId) ||
        tx.from !== scope.address || !tx.to || tx.accessList?.length ||
        tx.serialized !== raw || !Number.isSafeInteger(tx.nonce)) return corrupt();
    assertTransferIntentEnvelope({ chainId: tx.chainId.toString(), to: tx.to, value: tx.value.toString(), data: tx.data }, intent);
    const hash = keccak256(raw);
    if (tx.hash !== hash) return corrupt();
    return { hash, nonce: tx.nonce };
  } catch { return corrupt(); }
}
function entrySnapshot(value: unknown, scope: TransferJournalScope, legacy: boolean): ContainerEntry {
  const data = exact(value, legacy
    ? ['version', 'scope', 'phase', 'rawTransaction', 'hash', 'nonce', 'createdAt']
    : ['registration', 'phase', 'rawTransaction', 'hash', 'nonce', 'createdAt',
      ...(value && typeof value === 'object' && Object.hasOwn(value, 'intent') ? ['intent'] : [])]);
  let registration: NativeNetworkRegistration;
  if (legacy) {
    if (data.version !== 1) return corrupt();
    const recorded = scopeSnapshot(data.scope as TransferJournalScope);
    if (recorded.chainId !== '1' || recorded.walletFingerprint !== scope.walletFingerprint || recorded.address !== scope.address)
      throw new TransferJournalError('CONTEXT_CHANGED');
    registration = getNativeNetwork('ethereum');
  } else registration = registrationSnapshot(data.registration);
  if (!['signed', 'attempted', 'submitted', 'confirmed', 'reverted', 'nonce-consumed'].includes(data.phase as string) ||
      !Number.isSafeInteger(data.createdAt) || (data.createdAt as number) < 0) return corrupt();
  let intent: Erc20TransferIntent | undefined;
  try { if (!legacy && Object.hasOwn(data, 'intent')) intent = snapshotErc20TransferIntent(data.intent); } catch { return corrupt(); }
  const identity = signedIdentity(data.rawTransaction, { ...scope, chainId: registration.chainId }, intent);
  if (identity.hash !== data.hash || identity.nonce !== data.nonce) return corrupt();
  return Object.freeze({ registration, phase: data.phase as TransferJournalPhase, rawTransaction: data.rawTransaction as string,
    hash: identity.hash, nonce: identity.nonce, createdAt: data.createdAt as number, ...(intent ? { intent } : {}) });
}
function container(scope: TransferJournalScope, index: number, revision: number, entries: readonly ContainerEntry[], type: NativeAccountType = 'HDAccount'): TransferJournalContainer {
  return Object.freeze({ version: 2, revision, walletFingerprint: scope.walletFingerprint,
    account: Object.freeze({ id: nativeAccountId(type, index), index, type, slip44: 60, address: scope.address }),
    entries: Object.freeze([...entries].sort((a, b) => Number(a.registration.chainId) - Number(b.registration.chainId))) });
}
function decode(value: unknown, scope: TransferJournalScope, index: number, type: NativeAccountType = 'HDAccount'): { value: TransferJournalContainer; legacy: boolean } {
  const raw = clone(value);
  if ((raw as { version?: unknown } | null)?.version === 1) {
    if (type !== 'HDAccount') return corrupt();
    return { value: container(scope, index, 0, [entrySnapshot(raw, scope, true)]), legacy: true };
  }
  const data = exact(raw, ['version', 'revision', 'walletFingerprint', 'account', 'entries']);
  const account = exact(data.account, ['id', 'index', 'type', 'slip44', 'address']);
  if (data.version !== 2 || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0 ||
      !Array.isArray(data.entries) || data.entries.length < 1 || data.entries.length > MAX_JOURNAL_ENTRIES) return corrupt();
  if (data.walletFingerprint !== scope.walletFingerprint || account.id !== nativeAccountId(type, index) || account.index !== index ||
      account.type !== type || account.slip44 !== 60 || account.address !== scope.address)
    throw new TransferJournalError('CONTEXT_CHANGED');
  const entries = data.entries.map((entry) => entrySnapshot(entry, scope, false));
  if (new Set(entries.map((entry) => entry.registration.chainId)).size !== entries.length ||
      entries.some((entry, i) => i > 0 && Number(entries[i - 1]!.registration.chainId) >= Number(entry.registration.chainId))) return corrupt();
  return { value: container(scope, index, data.revision as number, entries, type), legacy: false };
}
function hostEntry(entry: ContainerEntry, scope: TransferJournalScope): TransferJournalEntry {
  return Object.freeze({ version: 1, scope: Object.freeze({ ...scope, chainId: entry.registration.chainId }), phase: entry.phase,
    rawTransaction: entry.rawTransaction, hash: entry.hash, nonce: entry.nonce, createdAt: entry.createdAt,
    ...(entry.intent ? { intent: entry.intent } : {}) });
}
/** Exact whole-row snapshot, never a selected-chain projection, for atomic cleanup. */
export function terminalJournalForRemoval(value: JournalRemovalSnapshot, scope: TransferJournalScope, accountIndex = 0, type: NativeAccountType = 'HDAccount'): JournalRemovalSnapshot {
  nativeTransferJournalKey(accountIndex, type);
  const expected = scopeSnapshot(scope);
  const parsed = decode(value, expected, accountIndex, type);
  if (parsed.value.entries.some((entry) => !terminal(entry.phase))) throw new TransferJournalError('PENDING_TRANSFER');
  return clone(value) as JournalRemovalSnapshot;
}

/** Private encrypted row; unrelated-chain mutations always use complete-row CAS. */
export class NativeTransferJournal {
  private readonly scope: TransferJournalScope;
  private readonly storage: KeyringStoragePort;
  private readonly assertCurrent: () => void;
  private readonly now: () => number;
  private readonly storageKey: string;
  private readonly index: number;
  private readonly type: NativeAccountType;
  private readonly registration: NativeNetworkRegistration;
  private readonly archiveTerminal?: (record: TerminalActivityRecord, guard: () => void) => Promise<void>;
  constructor(storage: KeyringStoragePort, scope: TransferJournalScope, assertCurrent: () => void,
    now = Date.now, accountIndex = 0, registration?: NativeNetworkRegistration,
    archiveTerminal?: (record: TerminalActivityRecord, guard: () => void) => Promise<void>, type: NativeAccountType = 'HDAccount') {
    this.storageKey = nativeTransferJournalKey(accountIndex, type);
    this.type = type;
    this.index = accountIndex;
    this.scope = scopeSnapshot(scope);
    this.registration = registrationSnapshot(registration ?? NATIVE_NETWORKS.find((network) => network.chainId === this.scope.chainId));
    if (this.registration.chainId !== this.scope.chainId) corrupt();
    this.storage = storage; this.assertCurrent = assertCurrent; this.now = now;
    this.archiveTerminal = archiveTerminal;
  }
  private guard() {
    const result: unknown = this.assertCurrent();
    if (result !== undefined) {
      if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
      throw new TransferJournalError('CONTEXT_CHANGED');
    }
  }
  private available() { if (journalRequiresReopen(this.storage)) throw new TransferJournalError('REOPEN_REQUIRED'); }
  private quarantine(): never { quarantined.add(this.storage); throw new TransferJournalError('REOPEN_REQUIRED'); }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.storage) ?? Promise.resolve();
    const pending = previous.then(async () => { this.available(); this.guard(); return operation(); });
    queues.set(this.storage, pending.then(() => undefined, () => undefined));
    return pending;
  }
  private selected(value: TransferJournalContainer): ContainerEntry | undefined {
    const entry = value.entries.find((item) => item.registration.chainId === this.scope.chainId);
    if (entry && entry.registration.registrationHash !== this.registration.registrationHash) throw new TransferJournalError('CONTEXT_CHANGED');
    return entry;
  }
  private async read() {
    this.guard(); const raw = await this.storage.get(this.storageKey); this.guard();
    return raw === undefined ? null : { raw: clone(raw), ...decode(raw, this.scope, this.index, this.type) };
  }
  private async write(before: unknown, next: TransferJournalContainer): Promise<boolean> {
    try { encodeStorageValue(next); } catch { throw new TransferJournalError('CAPACITY'); }
    this.guard();
    let committed: unknown;
    try {
      committed = before === undefined
        ? await this.storage.createManyIfAbsent({ [this.storageKey]: next })
        : await this.storage.compareAndSet(this.storageKey, before, next);
    } catch { return this.quarantine(); }
    if (typeof committed !== 'boolean') return this.quarantine();
    if (!committed) { this.guard(); return false; }
    // Acknowledgement is definitive. Ordinary revocation only discards the result.
    this.guard();
    let raw: unknown;
    try { raw = await this.storage.get(this.storageKey); } catch {
      // Close/revocation may reject readback after a definitive commit.
      this.guard();
      return this.quarantine();
    }
    this.guard();
    try {
      decode(raw, this.scope, this.index, this.type);
      if (encodeStorageValue(raw) !== encodeStorageValue(next)) return this.quarantine();
    } catch { return this.quarantine(); }
    return true;
  }
  private update(operation: (value: TransferJournalContainer | null) => { next?: TransferJournalContainer; result: TransferJournalEntry | null } | Promise<{ next?: TransferJournalContainer; result: TransferJournalEntry | null }>): Promise<TransferJournalEntry | null> {
    return this.exclusive(async () => {
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const old = await this.read();
        const change = await operation(old?.value ?? null);
        const next = change.next ?? (old?.legacy ? old.value : undefined);
        if (!next) return change.result;
        if (next.entries.length > MAX_JOURNAL_ENTRIES) throw new TransferJournalError('CAPACITY');
        if (await this.write(old?.raw, next)) return change.result;
      }
      throw new TransferJournalError('CONFLICT');
    });
  }
  load(): Promise<TransferJournalEntry | null> {
    return this.update((value) => ({ result: value && this.selected(value) ? hostEntry(this.selected(value)!, this.scope) : null }));
  }
  private publicRecord(entry: ContainerEntry): LocalActivityRecord {
    const tx = Transaction.from(entry.rawTransaction);
    const fee = tx.maxFeePerGas ?? tx.gasPrice;
    if (!tx.to || fee === null) return corrupt();
    return Object.freeze({ walletFingerprint: this.scope.walletFingerprint, accountId: nativeAccountId(this.type, this.index), address: this.scope.address,
      networkId: entry.registration.id, registrationHash: entry.registration.registrationHash, chainId: entry.registration.chainId,
      hash: entry.hash, phase: entry.phase, nonce: entry.nonce, createdAt: entry.createdAt,
      recipient: entry.intent?.recipient ?? tx.to, amountUnits: entry.intent?.amountUnits ?? tx.value.toString(),
      maximumFeeUnits: (tx.gasLimit * fee).toString(), ...(entry.intent ? { token: entry.intent.token } : {}) });
  }
  /** Public projection only. Raw signed bytes remain inside the recovery journal. */
  activity(): Promise<LocalActivityRecord | null> {
    return this.exclusive(async () => {
      const old = await this.read(); const entry = old && this.selected(old.value);
      return entry ? this.publicRecord(entry) : null;
    });
  }
  private async archive(entry: ContainerEntry): Promise<void> {
    this.guard();
    if (!terminal(entry.phase) || !this.archiveTerminal) throw new TransferJournalError('HISTORY_UNAVAILABLE');
    try { await this.archiveTerminal(this.publicRecord(entry) as TerminalActivityRecord, () => this.guard()); }
    catch (error) {
      this.guard();
      if (error && typeof error === 'object' && 'code' in error && error.code === 'REOPEN_REQUIRED') return this.quarantine();
      throw new TransferJournalError('HISTORY_UNAVAILABLE');
    }
    this.guard();
  }
  removalSnapshot(): Promise<JournalRemovalSnapshot | null> {
    return this.exclusive(async () => {
      const old = await this.read();
      if (!old) return null;
      const snapshot = terminalJournalForRemoval(old.raw as JournalRemovalSnapshot, this.scope, this.index, this.type);
      for (const entry of old.value.entries) await this.archive(entry);
      this.guard(); return snapshot;
    });
  }
  saveSigned(rawTransaction: string, inputIntent?: Erc20TransferIntent): Promise<TransferJournalEntry> {
    this.available(); this.guard();
    let intent: Erc20TransferIntent | undefined;
    try { if (inputIntent !== undefined) intent = snapshotErc20TransferIntent(inputIntent); } catch { return Promise.reject(new TransferJournalError('CORRUPT')); }
    const identity = signedIdentity(rawTransaction, this.scope, intent);
    const createdAt = this.now();
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) return Promise.reject(new TransferJournalError('CORRUPT'));
    const entry: ContainerEntry = Object.freeze({ registration: this.registration, phase: 'signed', rawTransaction, ...identity, createdAt,
      ...(intent ? { intent } : {}) });
    return this.update(async (value) => {
      const old = value && this.selected(value);
      if (old) {
        if (!terminal(old.phase)) throw new TransferJournalError('PENDING_TRANSFER');
        if (entry.nonce <= old.nonce) throw new TransferJournalError('INVALID_TRANSITION');
        // Archive and acknowledge BEFORE replacing the sole signed-byte record.
        // A crash leaves either the old journal or an idempotent public duplicate.
        await this.archive(old);
      }
      if (value?.revision === Number.MAX_SAFE_INTEGER) throw new TransferJournalError('CAPACITY');
      const entries = [...(value?.entries ?? []).filter((item) => item.registration.chainId !== this.scope.chainId), entry];
      return { next: container(this.scope, this.index, value ? value.revision + 1 : 0, entries, this.type), result: hostEntry(entry, this.scope) };
    }) as Promise<TransferJournalEntry>;
  }
  transition(hash: string, phase: Exclude<TransferJournalPhase, 'signed'>): Promise<TransferJournalEntry> {
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash)) return Promise.reject(new TransferJournalError('CORRUPT'));
    return this.update((value) => {
      const old = value && this.selected(value);
      if (!value || !old || old.hash !== hash) throw new TransferJournalError('INVALID_TRANSITION');
      if (old.phase === phase) return { result: hostEntry(old, this.scope) };
      const allowed = (phase === 'attempted' && old.phase === 'signed') || (phase === 'submitted' && old.phase === 'attempted') ||
        ((phase === 'confirmed' || phase === 'reverted' || phase === 'nonce-consumed') && ['attempted', 'submitted'].includes(old.phase)) ||
        (phase === 'nonce-consumed' && old.phase === 'signed');
      if (!allowed) throw new TransferJournalError('INVALID_TRANSITION');
      if (value.revision === Number.MAX_SAFE_INTEGER) throw new TransferJournalError('CAPACITY');
      const entry = Object.freeze({ ...old, phase });
      return { next: container(this.scope, this.index, value.revision + 1, value.entries.map((item) => item === old ? entry : item), this.type), result: hostEntry(entry, this.scope) };
    }) as Promise<TransferJournalEntry>;
  }
}
