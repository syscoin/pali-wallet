import { assertEvmGasLimit } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { getAddress } from 'ethers/address';
import { sha256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { concat, getBytes } from 'ethers/utils';

import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';

import type {
  IEncryptedPrivateRecord,
  EvmSignedSubmission,
} from '@sidhujag/sysweb3-keyring';

export const EVM_SIGNED_RECORD_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  transactions: 4096,
  chunkBytes: 48 * 1024,
});
export const EVM_SIGNED_RECORD_PREFIX = 'pali-evm-signed-v1:';
const encoder = new TextEncoder();
const ROOT_DOMAIN = 'org.syscoin.pali.evm.signed.root.v1';
const CHUNK_DOMAIN = 'org.syscoin.pali.evm.signed.chunk.v1';
const PROFILE = /^0x[0-9a-f]{64}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const SIGNED_PHASES = [
  'signed',
  'attempted',
  'submitted',
  'confirmed',
  'reverted',
  'nonce-consumed',
] as const;
export type EvmSignedPhase = (typeof SIGNED_PHASES)[number];
const MAX_PHASE_BYTES = Math.max(...SIGNED_PHASES.map((phase) => phase.length));
const MAX_REVISION_DIGITS = String(Number.MAX_SAFE_INTEGER).length;

export type EvmSignedRecordStorage = {
  compareAndSet(
    profileId: string,
    expected: string | undefined,
    next: string,
    assertCurrent: () => void
  ): Promise<boolean>;
  read(profileId: string): Promise<string | undefined>;
};
export type EvmSignedRecordSession = {
  assertCurrent(): void;
  keyring: {
    decryptPrivateRecord(input: {
      domain: string;
      envelope: IEncryptedPrivateRecord;
      recordId: string;
    }): Promise<Uint8Array>;
    encryptPrivateRecord(input: {
      domain: string;
      plaintext: Uint8Array;
      recordId: string;
    }): Promise<IEncryptedPrivateRecord>;
    getPrivateRecordProfileId(): Promise<string>;
  };
};
export type EvmSignedRecordSummary = Readonly<{
  chainId: string;
  createdAt: number;
  from: string;
  hash: string;
  metadata?: Readonly<Record<string, unknown>>;
  nonce: number;
  operation: EvmSignedSubmission['context']['operation'];
  originalHash?: string;
  phase: EvmSignedPhase;
  signer: Readonly<{ id: number; type: string }>;
}>;
export type EvmRetainedSignedRecord = EvmSignedRecordSummary &
  Readonly<{ rawTransaction: string }>;
type Entry = EvmSignedRecordSummary &
  Readonly<{ chunks: readonly IEncryptedPrivateRecord[] }>;
type Bundle = Readonly<{
  entries: readonly Entry[];
  profileId: string;
  revision: number;
  root: IEncryptedPrivateRecord;
  version: 1;
}>;
const queues = new WeakMap<EvmSignedRecordStorage, Promise<unknown>>();
const invalid = (): never => {
  throw new Error('EVM_SIGNED_RECORD_CORRUPT');
};
const limit = (): never => {
  throw new Error('EVM_SIGNED_RECORD_CAPACITY');
};
function exact(value: unknown, fields: readonly string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return invalid();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return invalid();
  }
  return value as Record<string, any>;
}
function snapshotMetadata(
  value: unknown,
  depth = 0,
  budget = { nodes: 0 }
): any {
  if (++budget.nodes > 1024 || depth > 8) return invalid();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 8192) return invalid();
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalid();
    return value;
  }
  if (!value || typeof value !== 'object') return invalid();
  if (Array.isArray(value)) {
    if (
      value.length > 1024 ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      return invalid();
    return Object.freeze(
      value.map((_, i) => {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !('value' in d)) return invalid();
        return snapshotMetadata(d.value, depth + 1, budget);
      })
    );
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      key === '__proto__' ||
      !d ||
      !d.enumerable ||
      !('value' in d)
    )
      return invalid();
    out[key] = snapshotMetadata(d.value, depth + 1, budget);
  }
  return Object.freeze(out);
}
function envelope(
  value: unknown,
  profileId: string,
  domain: string,
  recordId: string
): IEncryptedPrivateRecord {
  const data = exact(value, [
    'version',
    'profileId',
    'domain',
    'recordId',
    'nonce',
    'ciphertext',
  ]);
  if (
    data.version !== 1 ||
    data.profileId !== profileId ||
    data.domain !== domain ||
    data.recordId !== recordId ||
    typeof data.nonce !== 'string' ||
    !/^[A-Za-z0-9+/]{16}$/.test(data.nonce) ||
    typeof data.ciphertext !== 'string' ||
    data.ciphertext.length < 24 ||
    data.ciphertext.length > Math.ceil((64 * 1024 + 16) / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data.ciphertext
    )
  )
    return invalid();
  return Object.freeze({ ...data }) as IEncryptedPrivateRecord;
}
function parse(raw: string, expectedProfile?: string): Bundle {
  if (
    typeof raw !== 'string' ||
    raw.length > EVM_SIGNED_RECORD_LIMITS.bytes ||
    encoder.encode(raw).length > EVM_SIGNED_RECORD_LIMITS.bytes
  )
    return limit();
  assertJsonTextBudget(raw, {
    depth: 16,
    nodes: 500000,
    tokenCharacters: 100000,
  });
  const value = exact(JSON.parse(raw), [
    'version',
    'profileId',
    'revision',
    'root',
    'entries',
  ]);
  if (
    JSON.stringify(value) !== raw ||
    value.version !== 1 ||
    !PROFILE.test(value.profileId) ||
    (expectedProfile !== undefined && value.profileId !== expectedProfile) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.length > EVM_SIGNED_RECORD_LIMITS.transactions
  )
    return invalid();
  const hashes = new Set<string>();
  const entries: Entry[] = value.entries.map((input: unknown) => {
    const keys = input && typeof input === 'object' ? Object.keys(input) : [];
    const data = exact(input, [
      'hash',
      'chainId',
      'from',
      'nonce',
      'phase',
      'createdAt',
      'signer',
      'operation',
      'chunks',
      ...(keys.includes('originalHash') ? ['originalHash'] : []),
      ...(keys.includes('metadata') ? ['metadata'] : []),
    ]);
    if (
      !HASH.test(data.hash) ||
      hashes.has(data.hash) ||
      typeof data.chainId !== 'string' ||
      !/^[1-9][0-9]{0,77}$/.test(data.chainId) ||
      BigInt(data.chainId) >= 1n << 256n ||
      typeof data.from !== 'string' ||
      getAddress(data.from).toLowerCase() !== data.from ||
      !Number.isSafeInteger(data.nonce) ||
      data.nonce < 0 ||
      !Number.isSafeInteger(data.createdAt) ||
      data.createdAt < 0 ||
      !SIGNED_PHASES.includes(data.phase) ||
      !['send', 'cancel', 'speed-up', 'erc20', 'erc721', 'erc1155'].includes(
        data.operation
      ) ||
      (data.originalHash !== undefined && !HASH.test(data.originalHash)) ||
      !Array.isArray(data.chunks) ||
      !data.chunks.length
    )
      return invalid();
    exact(data.signer, ['id', 'type']);
    if (
      !Number.isSafeInteger(data.signer.id) ||
      data.signer.id < 0 ||
      typeof data.signer.type !== 'string' ||
      !data.signer.type ||
      data.signer.type.length > 64
    )
      return invalid();
    if (
      data.metadata !== undefined &&
      (!data.metadata ||
        typeof data.metadata !== 'object' ||
        Array.isArray(data.metadata))
    )
      return invalid();
    hashes.add(data.hash);
    return Object.freeze({
      ...data,
      signer: Object.freeze({ ...data.signer }),
      chunks: Object.freeze(
        data.chunks.map((chunk: unknown, i: number) =>
          envelope(chunk, value.profileId, CHUNK_DOMAIN, `${data.hash}/${i}`)
        )
      ),
    }) as Entry;
  });
  return Object.freeze({
    version: 1,
    profileId: value.profileId,
    revision: value.revision,
    root: envelope(value.root, value.profileId, ROOT_DOMAIN, 'manifest'),
    entries: Object.freeze(entries),
  });
}
/** Structural physical admission only; authenticated completeness is checked after SDK decryption. */
export function inspectEvmSignedBundle(
  raw: string,
  expectedProfile?: string
): Readonly<{
  bytes: number;
  profileId: string;
  revision: number;
  transactions: number;
}> {
  const value = parse(raw, expectedProfile);
  return Object.freeze({
    profileId: value.profileId,
    revision: value.revision,
    transactions: value.entries.length,
    bytes: encoder.encode(raw).length,
  });
}
function guard(session: EvmSignedRecordSession): void {
  const result: unknown = session.assertCurrent();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
    throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
  }
}
async function profile(session: EvmSignedRecordSession): Promise<string> {
  guard(session);
  const id = await session.keyring.getPrivateRecordProfileId();
  guard(session);
  if (!PROFILE.test(id)) return invalid();
  return id;
}
function summary(entry: Entry): EvmSignedRecordSummary {
  const { chunks: _chunks, ...value } = entry;
  void _chunks;
  return Object.freeze(value);
}
async function entriesHash(entries: readonly Entry[]): Promise<string> {
  const bytes = encoder.encode(JSON.stringify(entries));
  try {
    return sha256(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** One portable retention policy; host ports own physical atomicity and protection. */
export class EvmSignedRecords {
  private readonly storage: EvmSignedRecordStorage;
  private readonly now: () => number;
  private readonly onUnavailable: () => void;
  private unavailable = false;
  get requiresReopen(): boolean {
    return this.unavailable;
  }
  constructor(
    storage: EvmSignedRecordStorage,
    now = Date.now,
    onUnavailable: () => void = () => undefined
  ) {
    this.storage = storage;
    this.now = now;
    this.onUnavailable = onUnavailable;
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.storage) ?? Promise.resolve();
    const pending = previous
      .then(() => {
        if (this.unavailable)
          throw new Error('EVM_SIGNED_RECORD_REOPEN_REQUIRED');
        return operation();
      })
      .catch((error) => {
        if (
          (error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'STORAGE_REOPEN_REQUIRED') ||
          (error instanceof Error &&
            error.message === 'EVM_SIGNED_RECORD_REOPEN_REQUIRED')
        ) {
          if (!this.unavailable) {
            this.unavailable = true;
            this.onUnavailable();
          }
        }
        throw error;
      });
    queues.set(
      this.storage,
      pending.catch(() => undefined)
    );
    return pending;
  }
  private async load(
    session: EvmSignedRecordSession,
    id: string
  ): Promise<{ bundle: Bundle | null; raw: string | undefined }> {
    guard(session);
    const raw = await this.storage.read(id);
    guard(session);
    if (raw === undefined) return { raw, bundle: null };
    const bundle = parse(raw, id);
    const plaintext = await session.keyring.decryptPrivateRecord({
      domain: ROOT_DOMAIN,
      recordId: 'manifest',
      envelope: bundle.root,
    });
    try {
      guard(session);
      const root = exact(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)),
        ['version', 'revision', 'transactions', 'entriesHash']
      );
      if (
        root.version !== 1 ||
        root.revision !== bundle.revision ||
        root.transactions !== bundle.entries.length ||
        root.entriesHash !== (await entriesHash(bundle.entries))
      )
        return invalid();
    } finally {
      plaintext.fill(0);
    }
    guard(session);
    return { raw, bundle };
  }
  private async write(
    session: EvmSignedRecordSession,
    id: string,
    before: string | undefined,
    revision: number,
    entries: readonly Entry[],
    reserveStatusGrowth: boolean
  ): Promise<boolean> {
    if (
      entries.length > EVM_SIGNED_RECORD_LIMITS.transactions ||
      !Number.isSafeInteger(revision)
    )
      return limit();
    const digest = await entriesHash(entries);
    guard(session);
    const bytes = encoder.encode(
      JSON.stringify({
        version: 1,
        revision,
        transactions: entries.length,
        entriesHash: digest,
      })
    );
    let root: IEncryptedPrivateRecord;
    try {
      root = await session.keyring.encryptPrivateRecord({
        domain: ROOT_DOMAIN,
        recordId: 'manifest',
        plaintext: bytes,
      });
      guard(session);
    } finally {
      bytes.fill(0);
    }
    const next = JSON.stringify({
      version: 1,
      profileId: id,
      revision,
      root: envelope(root, id, ROOT_DOMAIN, 'manifest'),
      entries,
    });
    const inspected = inspectEvmSignedBundle(next, id);
    if (reserveStatusGrowth) {
      // Entry fields other than the ASCII phase are immutable. For fixed entry
      // count, the root plaintext can grow only with revision digits (at most
      // 16). AES-GCM adds a fixed tag; base64 grows by at most 4*ceil(delta/3).
      // Reserve every entry's largest phase plus both revision representations.
      const revisionGrowth = MAX_REVISION_DIGITS - String(revision).length;
      const phaseGrowth = entries.reduce(
        (sum, entry) => sum + MAX_PHASE_BYTES - entry.phase.length,
        0
      );
      const headroom =
        phaseGrowth + revisionGrowth + 4 * Math.ceil(revisionGrowth / 3);
      if (inspected.bytes > EVM_SIGNED_RECORD_LIMITS.bytes - headroom)
        return limit();
    }
    guard(session);
    const committed = await this.storage.compareAndSet(id, before, next, () =>
      guard(session)
    );
    guard(session);
    if (typeof committed !== 'boolean')
      throw new Error('EVM_SIGNED_RECORD_REOPEN_REQUIRED');
    return committed;
  }
  private async materialize(
    session: EvmSignedRecordSession,
    entry: Entry
  ): Promise<EvmRetainedSignedRecord> {
    const pieces: Uint8Array[] = [];
    try {
      for (let i = 0; i < entry.chunks.length; i++) {
        guard(session);
        const bytes = await session.keyring.decryptPrivateRecord({
          domain: CHUNK_DOMAIN,
          recordId: `${entry.hash}/${i}`,
          envelope: entry.chunks[i]!,
        });
        pieces.push(bytes);
        guard(session);
        if (!bytes.length || bytes.length > EVM_SIGNED_RECORD_LIMITS.chunkBytes)
          return invalid();
      }
      const rawTransaction = concat(pieces);
      const tx = Transaction.from(rawTransaction);
      if (
        !tx.isSigned() ||
        tx.serialized !== rawTransaction ||
        tx.hash !== entry.hash ||
        tx.from?.toLowerCase() !== entry.from ||
        tx.chainId.toString() !== entry.chainId ||
        tx.nonce !== entry.nonce
      )
        return invalid();
      return Object.freeze({ ...summary(entry), rawTransaction });
    } finally {
      pieces.forEach((bytes) => bytes.fill(0));
    }
  }
  append(
    session: EvmSignedRecordSession,
    signed: EvmSignedSubmission,
    metadata?: Readonly<Record<string, unknown>>
  ): Promise<EvmRetainedSignedRecord> {
    guard(session);
    const raw = signed.rawTransaction,
      hash = signed.hash;
    if (
      typeof raw !== 'string' ||
      raw.length > 2 * EVM_SIGNED_RECORD_LIMITS.bytes ||
      !HASH.test(hash)
    )
      return Promise.reject(new Error('EVM_SIGNED_RECORD_CAPACITY'));
    const source = signed.context;
    const context = Object.freeze({
      account: Object.freeze({
        id: source.account.id,
        type: source.account.type,
        address: source.account.address,
      }),
      network: Object.freeze({ chainId: source.network.chainId }),
      operation: source.operation,
      originalHash: source.originalHash,
    });
    const tx = Transaction.from(raw);
    if (
      !tx.isSigned() ||
      tx.serialized !== raw ||
      tx.hash !== hash ||
      tx.from?.toLowerCase() !== context.account.address.toLowerCase() ||
      tx.chainId.toString() !== String(context.network.chainId)
    )
      return Promise.reject(new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED'));
    assertEvmGasLimit(tx.gasLimit, tx.chainId);
    const metadataSnapshot =
      metadata === undefined ? undefined : snapshotMetadata(metadata);
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id);
        const duplicate = previous.bundle?.entries.find(
          (entry) => entry.hash === hash
        );
        if (duplicate) {
          const existing = await this.materialize(session, duplicate);
          if (existing.rawTransaction !== raw) return invalid();
          return existing;
        }
        if (
          (previous.bundle?.entries.length ?? 0) >=
          EVM_SIGNED_RECORD_LIMITS.transactions
        )
          return limit();
        // Bound added payload before allocating/encrypting its chunks. The final
        // canonical encoding below remains the exact capacity check.
        if (
          (previous.raw?.length ?? 0) +
            Math.ceil((((raw.length - 2) / 2) * 4) / 3) >
          EVM_SIGNED_RECORD_LIMITS.bytes
        )
          return limit();
        const allBytes = getBytes(raw);
        const chunks: IEncryptedPrivateRecord[] = [];
        try {
          for (
            let offset = 0;
            offset < allBytes.length;
            offset += EVM_SIGNED_RECORD_LIMITS.chunkBytes
          ) {
            const bytes = allBytes.slice(
              offset,
              offset + EVM_SIGNED_RECORD_LIMITS.chunkBytes
            );
            try {
              const chunk = await session.keyring.encryptPrivateRecord({
                domain: CHUNK_DOMAIN,
                recordId: `${hash}/${chunks.length}`,
                plaintext: bytes,
              });
              guard(session);
              chunks.push(
                envelope(chunk, id, CHUNK_DOMAIN, `${hash}/${chunks.length}`)
              );
            } finally {
              bytes.fill(0);
            }
          }
        } finally {
          allBytes.fill(0);
        }
        const createdAt = this.now();
        if (!Number.isSafeInteger(createdAt) || createdAt < 0) return invalid();
        const entry: Entry = Object.freeze({
          hash,
          chainId: tx.chainId.toString(),
          from: tx.from!.toLowerCase(),
          nonce: tx.nonce,
          phase: 'signed',
          createdAt,
          signer: Object.freeze({
            id: context.account.id,
            type: context.account.type,
          }),
          operation: context.operation,
          ...(context.originalHash
            ? { originalHash: context.originalHash }
            : {}),
          ...(metadataSnapshot ? { metadata: metadataSnapshot } : {}),
          chunks: Object.freeze(chunks),
        });
        const entries = [...(previous.bundle?.entries ?? []), entry];
        if (
          await this.write(
            session,
            id,
            previous.raw,
            (previous.bundle?.revision ?? -1) + 1,
            entries,
            true
          )
        )
          return Object.freeze({ ...summary(entry), rawTransaction: raw });
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    });
  }
  validate(session: EvmSignedRecordSession): Promise<number> {
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      return bundle?.entries.length ?? 0;
    });
  }
  listSender(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string
  ): Promise<readonly EvmSignedRecordSummary[]> {
    const from = getAddress(address).toLowerCase();
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      guard(session);
      return Object.freeze(
        (bundle?.entries ?? [])
          .filter((entry) => entry.chainId === chainId && entry.from === from)
          .map(summary)
      );
    });
  }
  listAddress(
    session: EvmSignedRecordSession,
    address: string
  ): Promise<readonly EvmSignedRecordSummary[]> {
    const from = getAddress(address).toLowerCase();
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      return Object.freeze(
        (bundle?.entries ?? [])
          .filter((entry) => entry.from === from)
          .map(summary)
      );
    });
  }
  readRecent(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    maximum: number
  ): Promise<
    Readonly<{ entries: readonly EvmRetainedSignedRecord[]; total: number }>
  > {
    const from = getAddress(address).toLowerCase();
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > EVM_SIGNED_RECORD_LIMITS.transactions
    )
      throw new Error('EVM_SIGNED_RECORD_CAPACITY');
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const matching = (bundle?.entries ?? []).filter(
        (entry) => entry.chainId === chainId && entry.from === from
      );
      const entries: EvmRetainedSignedRecord[] = [];
      for (const entry of matching.slice(-maximum))
        entries.push(await this.materialize(session, entry));
      guard(session);
      return Object.freeze({
        entries: Object.freeze(entries),
        total: matching.length,
      });
    });
  }
  readExact(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ): Promise<EvmRetainedSignedRecord | null> {
    const from = getAddress(address).toLowerCase();
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const entry = bundle?.entries.find(
        (candidate) =>
          candidate.chainId === chainId &&
          candidate.from === from &&
          candidate.hash === hash
      );
      return entry ? this.materialize(session, entry) : null;
    });
  }
  updatePhase(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string,
    phase: EvmSignedPhase
  ): Promise<EvmSignedRecordSummary> {
    const from = getAddress(address).toLowerCase();
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id);
        const entry = previous.bundle?.entries.find(
          (candidate) =>
            candidate.chainId === chainId &&
            candidate.from === from &&
            candidate.hash === hash
        );
        if (!entry || !previous.bundle)
          throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
        if (entry.phase === phase) return summary(entry);
        const next = Object.freeze({ ...entry, phase });
        if (
          await this.write(
            session,
            id,
            previous.raw,
            previous.bundle.revision + 1,
            previous.bundle.entries.map((candidate) =>
              candidate === entry ? next : candidate
            ),
            false
          )
        )
          return summary(next);
      }
      throw new Error('EVM_SIGNED_RECORD_CONFLICT');
    });
  }
}

/** Shared SDK hook implementation; hosts contribute only a captured session and storage. */
export function createEvmSignedRecordLifecycle(
  records: EvmSignedRecords,
  session: EvmSignedRecordSession
) {
  guard(session);
  return Object.freeze({
    assertCurrent: () => guard(session),
    persistSigned: async (record: EvmSignedSubmission) => {
      await records.append(session, record);
      guard(session);
    },
  });
}
