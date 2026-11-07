import { assertEvmGasLimit } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { getAddress } from 'ethers/address';
import { sha256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { concat, getBytes } from 'ethers/utils';

import { EvmAutoNonceAcceptance } from '../shared/evmAutoNonce.ts';
import { isEvmProtectedEmptySelfCall } from '../shared/evmCancellationPayer.ts';
import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';

import type { EvmAutoNonceSnapshot } from '../shared/evmAutoNonce.ts';
import type { EvmTransactionObservation } from '../shared/evmTransactionObservation.ts';
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
export class EvmSignedRecordCancellationFence extends Error {
  readonly #recoveryHash: string | null;

  constructor(recoveryHash: string | null) {
    super('EVM_SIGNED_RECORD_CANCELLATION_FENCE');
    this.name = 'EvmSignedRecordCancellationFence';
    this.#recoveryHash = recoveryHash;
  }

  get recoveryHash(): string | null {
    return this.#recoveryHash;
  }
}

export const EVM_SIGNED_RECORD_NONCE_CONFLICT =
  'EVM_SIGNED_RECORD_NONCE_CONFLICT';

export class EvmSignedRecordNonceConflict extends Error {
  readonly code = EVM_SIGNED_RECORD_NONCE_CONFLICT;
  readonly transactionNotBroadcast = true;
  readonly operation: EvmSignedRecordSummary['operation'];
  readonly #recoveryHash: string;

  constructor(owner: Pick<EvmSignedRecordSummary, 'hash' | 'operation'>) {
    super(EVM_SIGNED_RECORD_NONCE_CONFLICT);
    this.name = 'EvmSignedRecordNonceConflict';
    this.operation = owner.operation;
    this.#recoveryHash = owner.hash;
  }

  get recoveryHash(): string {
    return this.#recoveryHash;
  }
}

// Unforgeable local provenance: only a failed held admission can mint this
// marker. It carries no RPC body or signed bytes across the SDK boundary.
const heldAssetPreflightFailures = new WeakMap<
  object,
  Pick<EvmSignedRecordSummary, 'hash' | 'operation'>
>();
export function retainedEvmAssetPreflightConflict(
  error: unknown
): EvmSignedRecordNonceConflict | null {
  if (!error || typeof error !== 'object') return null;
  const record = heldAssetPreflightFailures.get(error);
  return record ? new EvmSignedRecordNonceConflict(record) : null;
}

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

type VerifiedPendingOriginal = Readonly<{
  chainId: string;
  from: string;
  nonce: number;
  operation: 'cancel' | 'speed-up';
  originalHash: string;
}>;
export type EvmVerifiedReplacementBinding = VerifiedPendingOriginal &
  Readonly<{
    expectedTipHash: string | null;
    profileId: string;
  }>;
const verifiedReplacementBindings =
  new WeakSet<EvmVerifiedReplacementBinding>();
export type EvmReplacementRates = Readonly<
  | { gasPrice: bigint; type: 0 }
  | { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; type: 2 }
>;

function bindVerifiedReplacement(
  original: VerifiedPendingOriginal,
  profileId: string,
  expectedTipHash: string | null
): EvmVerifiedReplacementBinding {
  const binding = Object.freeze({ ...original, profileId, expectedTipHash });
  verifiedReplacementBindings.add(binding);
  return binding;
}

function isPendingPhase(phase: EvmSignedPhase): boolean {
  return phase === 'signed' || phase === 'attempted' || phase === 'submitted';
}

function matchesNonce(
  entry: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>,
  {
    chainId,
    from,
    nonce,
  }: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>
): boolean {
  return (
    entry.chainId === chainId && entry.from === from && entry.nonce === nonce
  );
}

function isCancellationEnvelope(tx: Transaction): boolean {
  return isEvmProtectedEmptySelfCall(tx, 'cancel');
}

function repricesCancellation(tx: Transaction, original: Transaction): boolean {
  return (
    isCancellationEnvelope(tx) &&
    tx.type === original.type &&
    tx.gasLimit === original.gasLimit
  );
}

type Entry = EvmSignedRecordSummary &
  Readonly<{ chunks: readonly IEncryptedPrivateRecord[] }>;
type MinedObservation = Extract<EvmTransactionObservation, { status: 'mined' }>;

function retainedReplacementLineage(
  sameNonce: readonly Entry[],
  retainedIndex: number
): readonly Entry[] | null {
  const lineage = sameNonce.slice(retainedIndex);
  const known = new Set([lineage[0]!.hash]);
  for (const entry of lineage.slice(1)) {
    if (
      entry.operation !== 'speed-up' ||
      !entry.originalHash ||
      !known.has(entry.originalHash) ||
      (entry.phase !== 'signed' && entry.phase !== 'attempted')
    )
      return null;
    known.add(entry.hash);
  }
  return lineage;
}

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
      BigInt(data.chainId) >= BigInt(1) << BigInt(256) ||
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
  readonly autoNonceAcceptance = new EvmAutoNonceAcceptance();
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
    reserveStatusGrowth: boolean,
    verifyBeforeCommit?: () => Promise<() => void>
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
    const assertFresh = verifyBeforeCommit
      ? await verifyBeforeCommit()
      : undefined;
    const assertWrite = () => {
      guard(session);
      assertFresh?.();
    };
    assertWrite();
    const committed = await this.storage.compareAndSet(
      id,
      before,
      next,
      assertWrite
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

  private async replayableVariants(
    session: EvmSignedRecordSession,
    entries: readonly Entry[]
  ): Promise<readonly Entry[]> {
    const firstCancel = entries.findIndex(
      (entry) => entry.operation === 'cancel'
    );
    if (firstCancel < 0) return entries;
    const allowed = new Map<string, Transaction>();
    const result: Entry[] = [];
    for (const entry of entries.slice(firstCancel)) {
      const parent = entry.originalHash
        ? allowed.get(entry.originalHash)
        : undefined;
      if (
        entry.operation !== 'cancel' &&
        !(entry.operation === 'speed-up' && parent)
      )
        continue;
      const tx = Transaction.from(
        (await this.materialize(session, entry)).rawTransaction
      );
      if (
        entry.operation === 'cancel'
          ? isCancellationEnvelope(tx)
          : repricesCancellation(tx, parent!)
      ) {
        allowed.set(entry.hash, tx);
        result.push(entry);
      }
    }
    return result;
  }

  private async cancellationFence(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    scope: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>
  ): Promise<Readonly<{ tip: Entry | undefined }> | undefined> {
    if (
      !entries.some(
        (entry) => entry.operation === 'cancel' && matchesNonce(entry, scope)
      )
    )
      return;
    const sameNonce = entries.filter((entry) => matchesNonce(entry, scope));
    const tip = (await this.replayableVariants(session, sameNonce)).at(-1);
    return { tip };
  }

  /** Only the authenticated pending tip of a cancellation lineage can be repriced. */
  readPendingCancellation(
    session: EvmSignedRecordSession,
    input: Omit<VerifiedPendingOriginal, 'operation'>
  ): Promise<string | null> {
    const scope = Object.freeze({
      ...input,
      from: getAddress(input.from).toLowerCase(),
    });
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const fence = await this.cancellationFence(
        session,
        bundle?.entries ?? [],
        scope
      );
      if (!fence) return null;
      const { tip } = fence;
      if (!tip || tip.hash !== scope.originalHash || !isPendingPhase(tip.phase))
        throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
      return (await this.materialize(session, tip)).rawTransaction;
    });
  }

  private async assertOrdinaryNonceAvailable(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    scope: Pick<VerifiedPendingOriginal, 'chainId' | 'from' | 'nonce'>
  ): Promise<void> {
    const fence = await this.cancellationFence(session, entries, scope);
    guard(session);
    if (fence)
      throw new EvmSignedRecordCancellationFence(fence.tip?.hash ?? null);
    // A terminal observation can change in a reorg. An ordinary send never
    // replaces a retained nonce, even if it would produce the same wire hash.
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]!;
      if (matchesNonce(entry, scope))
        throw new EvmSignedRecordNonceConflict(entry);
    }
  }

  assertSpendingNonce(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    nonce: number
  ): Promise<void> {
    if (!Number.isSafeInteger(nonce) || nonce < 0)
      return Promise.reject(new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED'));
    const scope = { chainId, from: getAddress(address).toLowerCase(), nonce };
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      await this.assertOrdinaryNonceAvailable(
        session,
        bundle?.entries ?? [],
        scope
      );
      guard(session);
    });
  }

  /** A host-verified pending transaction can predate this journal. Its exact
   * nonce lineage must still match at write time, even when initially empty. */
  captureVerifiedReplacement(
    session: EvmSignedRecordSession,
    input: VerifiedPendingOriginal
  ): Promise<EvmVerifiedReplacementBinding> {
    const original = Object.freeze({
      ...input,
      from: getAddress(input.from).toLowerCase(),
    });
    if (
      !HASH.test(original.originalHash) ||
      !Number.isSafeInteger(original.nonce) ||
      original.nonce < 0
    )
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      return bindVerifiedReplacement(
        original,
        id,
        await this.verifiedReplacementTip(
          session,
          bundle?.entries ?? [],
          original
        )
      );
    });
  }

  private async verifiedReplacementTip(
    session: EvmSignedRecordSession,
    entries: readonly Entry[],
    original: VerifiedPendingOriginal,
    replacement?: Transaction
  ): Promise<string | null> {
    const sameNonce = entries.filter((entry) => matchesNonce(entry, original));
    const tracked = entries.find(
      (entry) => entry.hash === original.originalHash
    );
    if (tracked && !matchesNonce(tracked, original))
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    if (sameNonce.some((entry) => entry.operation === 'cancel')) {
      const tip = (await this.replayableVariants(session, sameNonce)).at(-1);
      if (
        !tip ||
        !isPendingPhase(tip.phase) ||
        tip.hash !== original.originalHash ||
        (original.operation === 'speed-up' &&
          replacement &&
          !repricesCancellation(
            replacement,
            Transaction.from(
              (await this.materialize(session, tip)).rawTransaction
            )
          ))
      )
        throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
      return tip.hash;
    }
    const retainedIndex = sameNonce.findIndex(
      (entry) => entry.hash === original.originalHash
    );
    if (retainedIndex < 0) return sameNonce.at(-1)?.hash ?? null;
    if (
      !isPendingPhase(sameNonce[retainedIndex]!.phase) ||
      !retainedReplacementLineage(sameNonce, retainedIndex)
    )
      throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
    return sameNonce.at(-1)?.hash ?? null;
  }

  append(
    session: EvmSignedRecordSession,
    signed: EvmSignedSubmission,
    metadata?: Readonly<Record<string, unknown>>,
    replacement?: EvmVerifiedReplacementBinding
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
      originalHash: source.originalHash?.toLowerCase(),
    });
    const isReplacement =
      context.operation === 'speed-up' || context.operation === 'cancel';
    if (
      isReplacement !== Boolean(replacement) ||
      (replacement &&
        (!verifiedReplacementBindings.has(replacement) ||
          replacement.originalHash !== context.originalHash))
    )
      return Promise.reject(new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED'));
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
    if (context.operation === 'cancel' && !isCancellationEnvelope(tx))
      return Promise.reject(new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED'));
    const signedNonce = {
      chainId: tx.chainId.toString(),
      from: tx.from!.toLowerCase(),
      nonce: tx.nonce,
    };
    const metadataSnapshot =
      metadata === undefined ? undefined : snapshotMetadata(metadata);
    return this.exclusive(async () => {
      const id = await profile(session);
      for (let attempt = 0; attempt < 3; attempt++) {
        const previous = await this.load(session, id);
        if (replacement) {
          if (
            id !== replacement.profileId ||
            replacement.operation !== context.operation ||
            !matchesNonce(signedNonce, replacement) ||
            (await this.verifiedReplacementTip(
              session,
              previous.bundle?.entries ?? [],
              replacement,
              tx
            )) !== replacement.expectedTipHash
          )
            throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
        } else {
          await this.assertOrdinaryNonceAvailable(
            session,
            previous.bundle?.entries ?? [],
            signedNonce
          );
          guard(session);
        }
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
  readReplacement(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string,
    operation: VerifiedPendingOriginal['operation']
  ): Promise<Readonly<{
    binding: EvmVerifiedReplacementBinding | null;
    original: EvmRetainedSignedRecord;
    rates: EvmReplacementRates;
  }> | null> {
    const from = getAddress(address).toLowerCase();
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const entries = bundle?.entries ?? [];
      const selected = entries.find(
        (entry) =>
          entry.chainId === chainId &&
          entry.from === from &&
          entry.hash === hash
      );
      if (!selected) return null;
      const sameNonce = entries.filter((entry) =>
        matchesNonce(entry, selected)
      );
      if (sameNonce.some((entry) => entry.operation === 'cancel')) return null;
      const lineage = retainedReplacementLineage(
        sameNonce,
        sameNonce.indexOf(selected)
      );
      const tip = lineage?.at(-1);
      if (!lineage || !tip) return null;

      const original = await this.materialize(session, selected);
      const base = Transaction.from(original.rawTransaction);
      if (base.type !== 0 && base.type !== 2) return null;
      let cap = base.maxFeePerGas ?? base.gasPrice ?? BigInt(0);
      let tipRate = base.maxPriorityFeePerGas ?? BigInt(0);
      for (const entry of lineage.slice(1)) {
        const variant = Transaction.from(
          (await this.materialize(session, entry)).rawTransaction
        );
        if (
          variant.type !== base.type ||
          variant.to !== base.to ||
          variant.value !== base.value ||
          variant.data !== base.data ||
          variant.accessList?.length ||
          base.accessList?.length
        )
          return null;
        const variantCap =
          variant.maxFeePerGas ?? variant.gasPrice ?? BigInt(0);
        const variantTip = variant.maxPriorityFeePerGas ?? BigInt(0);
        if (variantCap > cap) cap = variantCap;
        if (variantTip > tipRate) tipRate = variantTip;
      }
      const rates: EvmReplacementRates =
        base.type === 0
          ? Object.freeze({ type: 0, gasPrice: cap })
          : Object.freeze({
              type: 2,
              maxFeePerGas: cap,
              maxPriorityFeePerGas: tipRate,
            });
      guard(session);
      return Object.freeze({
        original,
        rates,
        binding: isPendingPhase(selected.phase)
          ? bindVerifiedReplacement(
              {
                chainId,
                from,
                nonce: selected.nonce,
                originalHash: hash,
                operation,
              },
              id,
              tip.hash
            )
          : null,
      });
    });
  }
  validate(session: EvmSignedRecordSession): Promise<number> {
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      return bundle?.entries.length ?? 0;
    });
  }
  private autoNonceSnapshot(
    session: EvmSignedRecordSession,
    owner: string,
    entries: readonly Entry[]
  ): EvmAutoNonceSnapshot {
    const byHash = new Map(entries.map((entry) => [entry.hash, entry]));
    const budgets = new Map<
      string,
      Readonly<{
        callTarget: string | null;
        maximumCost: bigint;
      }>
    >();
    const readBudget = async (hash: string) => {
      guard(session);
      const cached = budgets.get(hash);
      if (cached) return cached;
      const entry = byHash.get(hash);
      if (!entry) throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
      const tx = Transaction.from(
        (await this.materialize(session, entry)).rawTransaction
      );
      const feePerGas = tx.maxFeePerGas ?? tx.gasPrice;
      // These envelope types each consume exactly one sender nonce.
      if (
        feePerGas === null ||
        (tx.type !== 0 && tx.type !== 1 && tx.type !== 2)
      )
        throw new Error('EVM_AUTO_NONCE_UNSUPPORTED_PREDECESSOR');
      guard(session);
      const budget = Object.freeze({
        callTarget: tx.to?.toLowerCase() ?? null,
        maximumCost: tx.value + tx.gasLimit * feePerGas,
      });
      budgets.set(hash, budget);
      return budget;
    };
    return Object.freeze({
      owner,
      retained: Object.freeze(
        entries.map(({ chainId, from, hash, nonce, phase }) =>
          Object.freeze({ chainId, from, hash, nonce, phase })
        )
      ),
      readMaximumCost: async (hash: string) =>
        (await readBudget(hash)).maximumCost,
      touchesContract: async (hash: string, contract: string) =>
        (await readBudget(hash)).callTarget === contract.toLowerCase(),
    });
  }

  captureAutoNonceSnapshot(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string
  ): Promise<EvmAutoNonceSnapshot> {
    const from = getAddress(address).toLowerCase();
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      guard(session);
      return this.autoNonceSnapshot(
        session,
        id,
        (bundle?.entries ?? []).filter(
          (entry) => entry.chainId === chainId && entry.from === from
        )
      );
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
  /**
   * Select a sender's current work from authenticated append order. Wall-clock
   * timestamps are presentation metadata: clock changes cannot hide unresolved
   * signed bytes behind a completed transaction.
   */
  readCurrent(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string
  ): Promise<EvmRetainedSignedRecord | null> {
    const from = getAddress(address).toLowerCase();
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      let latest: Entry | undefined;
      let unresolved: Entry | undefined;
      for (const entry of bundle?.entries ?? []) {
        if (entry.chainId !== chainId || entry.from !== from) continue;
        latest = entry;
        if (['signed', 'attempted', 'submitted'].includes(entry.phase))
          unresolved = entry;
      }
      const entry = unresolved ?? latest;
      return entry ? this.materialize(session, entry) : null;
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
  readPage(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    options: Readonly<{
      beforeHash?: string;
      maximum: number;
      nonce?: number;
      pendingOnly?: boolean;
      replayCandidatesOnly?: boolean;
    }>
  ): Promise<
    Readonly<{
      entries: readonly EvmRetainedSignedRecord[];
      nextCursor: string | null;
      total: number;
    }>
  > {
    const from = getAddress(address).toLowerCase();
    const { maximum, beforeHash, nonce, replayCandidatesOnly, pendingOnly } =
      options;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > 30 ||
      (replayCandidatesOnly && nonce === undefined) ||
      (pendingOnly && replayCandidatesOnly) ||
      (beforeHash !== undefined && !HASH.test(beforeHash)) ||
      (nonce !== undefined && (!Number.isSafeInteger(nonce) || nonce < 0))
    )
      throw new Error('EVM_SIGNED_RECORD_CAPACITY');
    return this.exclusive(async () => {
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const scoped = (bundle?.entries ?? []).filter(
        (entry) =>
          entry.chainId === chainId &&
          entry.from === from &&
          (nonce === undefined || entry.nonce === nonce)
      );
      const matching = replayCandidatesOnly
        ? await this.replayableVariants(session, scoped)
        : scoped;
      const end =
        beforeHash === undefined
          ? matching.length
          : matching.findIndex((entry) => entry.hash === beforeHash);
      if (end < 0) throw new Error('EVM_SIGNED_RECORD_NOT_FOUND');
      // Locate the anchor in append order before filtering. Its phase may
      // have changed while the preceding page was visible.
      const visible = pendingOnly
        ? matching.slice(0, end).filter((entry) => isPendingPhase(entry.phase))
        : matching;
      const pageEnd = pendingOnly ? visible.length : end;
      const start = Math.max(0, pageEnd - maximum),
        entries: EvmRetainedSignedRecord[] = [];
      for (const entry of visible.slice(start, pageEnd).reverse())
        entries.push(await this.materialize(session, entry));
      guard(session);
      return Object.freeze({
        entries: Object.freeze(entries),
        total: pendingOnly
          ? matching.filter((entry) => isPendingPhase(entry.phase)).length
          : matching.length,
        nextCursor: start > 0 ? visible[start]!.hash : null,
      });
    });
  }
  /** Admit initial dispatch or replay under the authenticated cancellation barrier.
   * An owned replay preflight runs inside the queue. Box the result to release before its ACK. */
  withReplayAdmission<T>(
    session: EvmSignedRecordSession,
    {
      chainId,
      from,
      hash,
      nonce,
      operation,
      originalHash,
    }: Pick<
      EvmSignedRecordSummary,
      'chainId' | 'from' | 'hash' | 'nonce' | 'operation' | 'originalHash'
    >,
    admit: (predecessors: readonly EvmSignedRecordSummary[]) => T,
    predecessorNonce?: number,
    preflight?: Readonly<{
      assertCurrent(): void;
      run(
        owner: string,
        autoNonceSnapshot: () => EvmAutoNonceSnapshot
      ): Promise<void>;
    }>
  ): Promise<Readonly<{ result: T }> | null> {
    const address = getAddress(from).toLowerCase();
    return this.exclusive(async () => {
      // A queued replay may have expired before reaching storage.
      preflight?.assertCurrent();
      const id = await profile(session);
      const { bundle } = await this.load(session, id);
      const sender = (bundle?.entries ?? []).filter(
        (entry) => entry.chainId === chainId && entry.from === address
      );
      const variants = await this.replayableVariants(
        session,
        sender.filter((entry) => entry.nonce === nonce)
      );
      const retained = variants.find((entry) => entry.hash === hash);
      if (
        !retained ||
        retained.operation !== operation ||
        retained.originalHash !== originalHash
      )
        return null;
      const predecessors =
        predecessorNonce === undefined
          ? []
          : (
              await this.replayableVariants(
                session,
                sender.filter((entry) => entry.nonce === predecessorNonce)
              )
            ).map(summary);
      guard(session);
      if (preflight) {
        await preflight.run(id, () =>
          this.autoNonceSnapshot(
            session,
            id,
            sender.filter((entry) => entry.hash !== hash)
          )
        );
        guard(session);
      }
      return { result: admit(predecessors) };
    });
  }
  async readExact(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ): Promise<EvmRetainedSignedRecord | null> {
    return (
      (await this.readForObservation(session, chainId, address, hash))?.entry ??
      null
    );
  }

  readForObservation(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string
  ): Promise<Readonly<{
    entry: EvmRetainedSignedRecord;
    revision: number;
  }> | null> {
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
      return entry && bundle
        ? Object.freeze({
            entry: await this.materialize(session, entry),
            revision: bundle.revision,
          })
        : null;
    });
  }
  updatePhase(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string,
    phase: EvmSignedPhase
  ): Promise<EvmSignedRecordSummary> {
    return this.writePhase(session, chainId, address, hash, phase);
  }

  updateObservedPhase(
    session: EvmSignedRecordSession,
    entry: Pick<EvmSignedRecordSummary, 'chainId' | 'from' | 'hash' | 'phase'>,
    revision: number,
    phase: EvmSignedPhase
  ): Promise<EvmSignedRecordSummary> {
    return this.writePhase(
      session,
      entry.chainId,
      entry.from,
      entry.hash,
      phase,
      { phase: entry.phase, revision }
    );
  }

  reconcileMinedCancellation(
    session: EvmSignedRecordSession,
    entry: Pick<
      EvmSignedRecordSummary,
      'chainId' | 'from' | 'hash' | 'nonce' | 'phase'
    >,
    revision: number,
    observation: MinedObservation,
    reobserve: () => Promise<EvmTransactionObservation>
  ): Promise<EvmSignedRecordSummary> {
    const { hash, from, chainId, nonce } = entry;
    const { outcome, block, transactionIndex } = observation;
    const { number, hash: blockHash } = block;
    const changed = () => new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
    const observed = { phase: entry.phase, revision };
    return this.writePhase(session, chainId, from, hash, outcome, observed, {
      nonce,
      inclusionVerified:
        transactionIndex !== undefined &&
        Number.isSafeInteger(transactionIndex) &&
        transactionIndex >= 0,
      async verify() {
        const timeout = 12_000;
        const cutoff = performance.now() + timeout;
        const assertFresh = () => {
          guard(session);
          if (performance.now() >= cutoff) throw changed();
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          assertFresh();
          const current = await Promise.race([
            reobserve(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(changed()), timeout);
            }),
          ]);
          assertFresh();
          if (
            current.status !== 'mined' ||
            current.outcome !== outcome ||
            current.transactionIndex !== transactionIndex ||
            current.block.number !== number ||
            current.block.hash !== blockHash
          )
            throw changed();
          return assertFresh;
        } catch {
          guard(session);
          throw changed();
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  private writePhase(
    session: EvmSignedRecordSession,
    chainId: string,
    address: string,
    hash: string,
    phase: EvmSignedPhase,
    observed?: Readonly<{ phase: EvmSignedPhase; revision: number }>,
    cancellation?: Readonly<{
      inclusionVerified: boolean;
      nonce: number;
      verify(): Promise<() => void>;
    }>
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
        const revisionChanged =
          observed !== undefined &&
          observed.revision !== previous.bundle.revision;
        const hasSibling =
          (revisionChanged || cancellation !== undefined) &&
          previous.bundle.entries.some(
            (candidate) => candidate !== entry && matchesNonce(candidate, entry)
          );
        // Unrelated journal writes can overlap a standalone observation. With
        // competing hashes, the revision must still bind their whole lineage.
        if (
          observed &&
          (observed.phase !== entry.phase || (revisionChanged && hasSibling))
        )
          throw new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
        if (
          cancellation &&
          (entry.operation !== 'cancel' || entry.nonce !== cancellation.nonce)
        )
          throw new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
        const reconcile = hasSibling ? cancellation : undefined;
        if (reconcile && !reconcile.inclusionVerified)
          throw new Error('EVM_SIGNED_RECORD_OBSERVATION_CHANGED');
        if (!isPendingPhase(phase) || !isPendingPhase(entry.phase))
          this.autoNonceAcceptance.retireNonce(id, entry);
        if (!reconcile && entry.phase === phase) return summary(entry);
        const next =
          entry.phase === phase ? entry : Object.freeze({ ...entry, phase });
        let changesSibling = false;
        const entries = previous.bundle.entries.map((candidate) => {
          if (candidate === entry) return next;
          if (!reconcile || !matchesNonce(candidate, entry)) return candidate;
          if (candidate.phase === 'nonce-consumed') return candidate;
          changesSibling = true;
          return Object.freeze({
            ...candidate,
            phase: 'nonce-consumed' as const,
          });
        });
        if (entry === next && !changesSibling) return summary(entry);
        if (
          await this.write(
            session,
            id,
            previous.raw,
            previous.bundle.revision + 1,
            entries,
            false,
            reconcile?.verify
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
  session: EvmSignedRecordSession,
  options?: Readonly<{
    automaticNonceEndpoint?: string;
    metadata?: Readonly<Record<string, unknown>>;
    preflight?: (
      record: EvmSignedSubmission,
      assertCurrent: () => void,
      autoNonceSnapshot: EvmAutoNonceSnapshot
    ) => Promise<void>;
    replacement?:
      | EvmVerifiedReplacementBinding
      | Promise<EvmVerifiedReplacementBinding>;
    // Opt in only when the host can recheck the original token approval.
    retainAssetPreflightFailure?: boolean;
  }>
) {
  guard(session);
  return Object.freeze({
    assertCurrent: () => guard(session),
    persistSigned: async (record: EvmSignedSubmission) => {
      const replacement = options?.replacement;
      await records.append(
        session,
        record,
        options?.metadata,
        replacement && (await replacement)
      );
      guard(session);
    },
    async dispatchSigned<T>(
      record: EvmSignedSubmission,
      initiate: () => Promise<T>,
      preflight: () => Promise<void>
    ): Promise<T> {
      let expires: number | undefined;
      let trackAcknowledgement: (() => (hash: unknown) => void) | undefined;
      const expired = () => new Error('EVM_SIGNED_DISPATCH_PREFLIGHT_EXPIRED');
      const assertAdmission = () => {
        guard(session);
        if (expires !== undefined && performance.now() >= expires)
          throw expired();
      };
      let retainedAuthenticated = false;
      let wireStarted = false;
      let admitted: Readonly<{ result: Promise<T> }> | null;
      try {
        admitted = await records.withReplayAdmission(
          session,
          {
            chainId: record.chainId,
            from: record.from,
            nonce: record.nonce,
            hash: record.hash,
            operation: record.context.operation,
            originalHash: record.context.originalHash?.toLowerCase(),
          },
          () => {
            assertAdmission();
            const recordAcknowledgement = trackAcknowledgement?.();
            let response: Promise<T>;
            try {
              // Once initiation begins, even a synchronous failure may be an
              // ambiguous POST; never classify it as a held preflight refusal.
              wireStarted = true;
              response = initiate();
            } catch (error) {
              recordAcknowledgement?.(undefined);
              throw error;
            }
            if (recordAcknowledgement) {
              response = response.then(
                (value) => {
                  try {
                    guard(session);
                    recordAcknowledgement(
                      value && typeof value === 'object' && 'hash' in value
                        ? value.hash
                        : value
                    );
                  } catch {
                    // The acknowledged send may have outlived its wallet scope.
                    recordAcknowledgement(undefined);
                  }
                  return value;
                },
                (error: unknown) => {
                  recordAcknowledgement(undefined);
                  throw error;
                }
              );
            }
            void response.catch(() => undefined);
            return response;
          },
          undefined,
          {
            assertCurrent: assertAdmission,
            async run(owner, autoNonceSnapshot) {
              // withReplayAdmission has authenticated the exact retained record.
              retainedAuthenticated = true;
              const endpoint = options?.automaticNonceEndpoint;
              if (endpoint) {
                if (endpoint !== record.context.network.url)
                  throw new Error('EVM_SIGNED_RECORD_CONTEXT_CHANGED');
                trackAcknowledgement = () =>
                  records.autoNonceAcceptance.track(owner, endpoint, record);
              }
              const timeout = 12_000;
              expires = performance.now() + timeout;
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  (async () => {
                    await preflight();
                    assertAdmission();
                    await options?.preflight?.(
                      record,
                      assertAdmission,
                      autoNonceSnapshot()
                    );
                    assertAdmission();
                  })(),
                  new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(expired()), timeout);
                  }),
                ]);
              } finally {
                clearTimeout(timer);
              }
            },
          }
        );
      } catch (error) {
        const operation = record.context.operation;
        if (
          options?.retainAssetPreflightFailure &&
          retainedAuthenticated &&
          !wireStarted &&
          (operation === 'erc20' ||
            operation === 'erc721' ||
            operation === 'erc1155')
        ) {
          // Wallet/session invalidation has precedence over recovery guidance.
          guard(session);
          const marker = new Error('EVM_SIGNED_ASSET_PREFLIGHT_FAILED');
          heldAssetPreflightFailures.set(marker, {
            hash: record.hash,
            operation,
          });
          throw marker;
        }
        throw error;
      }
      if (!admitted) throw new Error('EVM_SIGNED_RECORD_ORIGINAL_CHANGED');
      return admitted.result;
    },
  });
}
