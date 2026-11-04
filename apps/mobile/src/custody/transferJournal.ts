import { getAddress } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import type { KeyringStoragePort } from '../storage/types.ts';

const STORAGE_KEY = 'native-evm-transfer-v1';
export function nativeTransferJournalKey(accountIndex: number): string {
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0 || accountIndex > 4095) throw new TransferJournalError('CORRUPT');
  return accountIndex === 0 ? STORAGE_KEY : `${STORAGE_KEY}:hd:60:${accountIndex}`;
}
const MAX_RAW_CHARACTERS = 4096;
const queues = new WeakMap<KeyringStoragePort, Promise<void>>();
export type TransferJournalPhase =
  | 'signed'
  | 'attempted'
  | 'submitted'
  | 'confirmed'
  | 'reverted'
  | 'nonce-consumed';
export type TransferJournalScope = Readonly<{
  walletFingerprint: string;
  address: string;
  chainId: '1';
}>;
export type TransferJournalEntry = Readonly<{
  version: 1;
  scope: TransferJournalScope;
  phase: TransferJournalPhase;
  rawTransaction: string;
  hash: string;
  nonce: number;
  createdAt: number;
}>;
export class TransferJournalError extends Error {
  readonly code:
    | 'CORRUPT'
    | 'CONTEXT_CHANGED'
    | 'PENDING_TRANSFER'
    | 'INVALID_TRANSITION';
  constructor(code: TransferJournalError['code']) {
    super(code);
    this.name = 'TransferJournalError';
    this.code = code;
  }
}
const corrupt = (): never => {
  throw new TransferJournalError('CORRUPT');
};
function exact(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return corrupt();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return corrupt();
  const names = Reflect.ownKeys(value);
  if (
    names.length !== keys.length ||
    names.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return corrupt();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return corrupt();
    result[name] = descriptor.value;
  }
  return result;
}
function scopeSnapshot(value: TransferJournalScope): TransferJournalScope {
  const scope = exact(value, ['walletFingerprint', 'address', 'chainId']);
  if (
    typeof scope.walletFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(scope.walletFingerprint) ||
    scope.chainId !== '1' ||
    typeof scope.address !== 'string'
  )
    return corrupt();
  let address: string;
  try {
    address = getAddress(scope.address);
  } catch {
    return corrupt();
  }
  if (/^0x0{40}$/i.test(address)) return corrupt();
  return Object.freeze({
    walletFingerprint: scope.walletFingerprint,
    address,
    chainId: '1',
  });
}
function signedIdentity(
  raw: unknown,
  scope: TransferJournalScope
): { hash: string; nonce: number } {
  if (
    typeof raw !== 'string' ||
    raw.length > MAX_RAW_CHARACTERS ||
    !/^0x(?:[0-9a-f]{2})+$/.test(raw)
  )
    return corrupt();
  try {
    const tx = Transaction.from(raw);
    if (
      !tx.isSigned() ||
      (tx.type !== 0 && tx.type !== 2) ||
      tx.chainId !== 1n ||
      tx.from !== scope.address ||
      !tx.to ||
      tx.data !== '0x' ||
      tx.accessList?.length ||
      tx.serialized !== raw ||
      !Number.isSafeInteger(tx.nonce)
    )
      return corrupt();
    const hash = keccak256(raw);
    if (tx.hash !== hash) return corrupt();
    return { hash, nonce: tx.nonce };
  } catch {
    return corrupt();
  }
}
function decode(
  value: unknown,
  expected: TransferJournalScope
): TransferJournalEntry {
  const data = exact(value, [
    'version',
    'scope',
    'phase',
    'rawTransaction',
    'hash',
    'nonce',
    'createdAt',
  ]);
  const scope = scopeSnapshot(data.scope as TransferJournalScope);
  if (
    scope.walletFingerprint !== expected.walletFingerprint ||
    scope.address !== expected.address ||
    scope.chainId !== expected.chainId
  )
    throw new TransferJournalError('CONTEXT_CHANGED');
  if (
    data.version !== 1 ||
    ![
      'signed',
      'attempted',
      'submitted',
      'confirmed',
      'reverted',
      'nonce-consumed',
    ].includes(data.phase as string) ||
    !Number.isSafeInteger(data.createdAt) ||
    (data.createdAt as number) < 0
  )
    return corrupt();
  const identity = signedIdentity(data.rawTransaction, scope);
  if (identity.hash !== data.hash || identity.nonce !== data.nonce)
    return corrupt();
  return Object.freeze({
    version: 1,
    scope,
    phase: data.phase as TransferJournalPhase,
    rawTransaction: data.rawTransaction as string,
    hash: identity.hash,
    nonce: identity.nonce,
    createdAt: data.createdAt as number,
  });
}

/** Validate the complete signed entry and scope before atomic account cleanup. */
export function terminalJournalForRemoval(value: TransferJournalEntry, scope: TransferJournalScope): TransferJournalEntry {
  const entry = decode(value, scopeSnapshot(scope));
  if (!['confirmed', 'reverted', 'nonce-consumed'].includes(entry.phase)) throw new TransferJournalError('PENDING_TRANSFER');
  return entry;
}

/**
 * Internal encrypted-storage journal. Never expose signed bytes to a screen.
 * A durable attempted marker is required BEFORE any network submission. After
 * process death, attempted/submitted is unresolved: reconcile the same hash and
 * never create a replacement transaction automatically.
 * The native lease permits one owner in this process; this queue permits one writer.
 */
export class NativeTransferJournal {
  private readonly scope: TransferJournalScope;
  private readonly storage: KeyringStoragePort;
  private readonly assertCurrent: () => void;
  private readonly now: () => number;
  private readonly storageKey: string;
  constructor(
    storage: KeyringStoragePort,
    scope: TransferJournalScope,
    assertCurrent: () => void,
    now = Date.now,
    accountIndex = 0
  ) {
    this.storageKey = nativeTransferJournalKey(accountIndex);
    this.scope = scopeSnapshot(scope);
    this.storage = storage;
    this.assertCurrent = assertCurrent;
    this.now = now;
  }
  private guard() {
    const result: unknown = this.assertCurrent();
    if (result !== undefined) {
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function')
      )
        void Promise.resolve(result).catch(() => undefined);
      throw new TransferJournalError('CONTEXT_CHANGED');
    }
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.storage) ?? Promise.resolve();
    const pending = previous.then(async () => {
      this.guard();
      return operation();
    });
    queues.set(
      this.storage,
      pending.then(
        () => undefined,
        () => undefined
      )
    );
    return pending;
  }
  private async read(): Promise<TransferJournalEntry | null> {
    this.guard();
    const value = await this.storage.get(this.storageKey);
    this.guard();
    return value === undefined ? null : decode(value, this.scope);
  }
  load(): Promise<TransferJournalEntry | null> {
    return this.exclusive(() => this.read());
  }
  saveSigned(rawTransaction: string): Promise<TransferJournalEntry> {
    // Validate and detach before the first asynchronous boundary.
    this.guard();
    const identity = signedIdentity(rawTransaction, this.scope);
    const createdAt = this.now();
    if (!Number.isSafeInteger(createdAt) || createdAt < 0)
      return Promise.reject(new TransferJournalError('CORRUPT'));
    const entry: TransferJournalEntry = Object.freeze({
      version: 1,
      scope: this.scope,
      phase: 'signed',
      rawTransaction,
      ...identity,
      createdAt,
    });
    return this.exclusive(async () => {
      const old = await this.read();
      if (old) {
        if (!['confirmed', 'reverted', 'nonce-consumed'].includes(old.phase))
          throw new TransferJournalError('PENDING_TRANSFER');
        if (entry.nonce <= old.nonce)
          throw new TransferJournalError('INVALID_TRANSITION');
      }
      this.guard();
      if (!old) {
        if (!(await this.storage.createManyIfAbsent({ [this.storageKey]: entry })))
          throw new TransferJournalError('PENDING_TRANSFER');
      } else await this.storage.set(this.storageKey, entry);
      // Failure/lock after an acknowledged write must never authorize broadcast.
      this.guard();
      const stored = await this.read();
      if (!stored || stored.hash !== entry.hash || stored.phase !== 'signed')
        return corrupt();
      return stored;
    });
  }
  transition(
    hash: string,
    phase: Exclude<TransferJournalPhase, 'signed'>
  ): Promise<TransferJournalEntry> {
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash))
      return Promise.reject(new TransferJournalError('CORRUPT'));
    return this.exclusive(async () => {
      const old = await this.read();
      if (!old || old.hash !== hash)
        throw new TransferJournalError('INVALID_TRANSITION');
      if (old.phase === phase) return old;
      const allowed =
        (phase === 'attempted' && old.phase === 'signed') ||
        (phase === 'submitted' && old.phase === 'attempted') ||
        ((phase === 'confirmed' ||
          phase === 'reverted' ||
          phase === 'nonce-consumed') &&
          ['attempted', 'submitted'].includes(old.phase)) ||
        (phase === 'nonce-consumed' && old.phase === 'signed');
      if (!allowed) throw new TransferJournalError('INVALID_TRANSITION');
      const entry = Object.freeze({ ...old, phase });
      this.guard();
      await this.storage.set(this.storageKey, entry);
      this.guard();
      const stored = await this.read();
      if (!stored || stored.hash !== hash || stored.phase !== phase)
        return corrupt();
      return stored;
    });
  }
}
