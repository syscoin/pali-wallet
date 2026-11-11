import { utils as syscoinUtils } from 'syscoinjs-lib';

import { PSBT_WORK_LIMITS } from '../utils/psbtWorkBudget.ts';
import { utxoInputOutpoints } from '../utils/utxoAcknowledgedInputs.ts';

import type {
  EvmSignedRecordSession,
  EvmSignedRecordStorage,
} from './evmSignedRecords.ts';
import {
  capacity,
  CHUNK_BYTES,
  CHUNK_DOMAIN,
  corrupt,
  digest,
  entriesDigest,
  HASH,
  inspectUtxoSignedBundle,
  MAX_RECORDS,
  PROFILE,
  RAW_BYTES,
  recordKey,
  ROOT_DOMAIN,
  UTXO_SIGNED_RECORD_BYTES,
  validOutpoints,
  validUtxoEnvelope,
  type Entry,
  type Summary,
} from './utxoSignedBundle.ts';
import type { IEncryptedPrivateRecord } from '@sidhujag/sysweb3-keyring';

export {
  inspectUtxoSignedBundle,
  UTXO_SIGNED_RECORD_BYTES,
  UTXO_SIGNED_RECORD_KEY,
  UTXO_SIGNED_RECORD_PREFIX,
} from './utxoSignedBundle.ts';

const encoder = new TextEncoder();

export type UtxoRecordStorage = EvmSignedRecordStorage;
export type UtxoRecordSession = EvmSignedRecordSession;
type UtxoRecordChain = Readonly<{
  chainId: number;
  genesisHash: string;
  slip44: number;
}>;
export type UtxoRecordOwner = UtxoRecordChain &
  Readonly<{
    account: Readonly<{ id: number; type: string; xpub: string }>;
  }>;

export type UtxoDurableSubmission = Readonly<{
  feeSatoshis: string;
  operation: 'wallet' | 'external';
  outpoints: readonly string[];
  owner: UtxoRecordOwner;
  rawTransaction: string;
  txid: string;
  url: string;
  virtualSize: number;
}>;

export function snapshotUtxoSubmission(
  record: UtxoDurableSubmission
): UtxoDurableSubmission {
  const {
    owner,
    operation,
    rawTransaction,
    txid,
    url,
    outpoints,
    feeSatoshis,
    virtualSize,
  } = record;
  return Object.freeze({
    owner: Object.freeze({
      chainId: owner.chainId,
      slip44: owner.slip44,
      genesisHash: owner.genesisHash,
      account: Object.freeze({
        id: owner.account.id,
        type: owner.account.type,
        xpub: owner.account.xpub,
      }),
    }),
    operation,
    rawTransaction,
    txid,
    url,
    outpoints: Object.freeze([...outpoints]),
    feeSatoshis,
    virtualSize,
  });
}
const queues = new WeakMap<object, Promise<void>>();
const observationsByStorage = new WeakMap<
  UtxoRecordStorage,
  Map<string, object>
>();

const reopen = (): never => {
  throw new Error('UTXO_SIGNED_RECORD_REOPEN_REQUIRED');
};
function chainKey({ chainId, slip44, genesisHash }: UtxoRecordChain): string {
  if (
    !Number.isSafeInteger(chainId) ||
    chainId < 0 ||
    !Number.isSafeInteger(slip44) ||
    slip44 < 0 ||
    typeof genesisHash !== 'string' ||
    !HASH.test(genesisHash)
  )
    return corrupt();
  return digest([chainId, slip44, genesisHash]).slice(2);
}

function accountIdentity({
  id,
  type,
  xpub,
}: UtxoRecordOwner['account']): [number, string, string] {
  if (
    !Number.isSafeInteger(id) ||
    id < 0 ||
    !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(type) ||
    typeof xpub !== 'string' ||
    xpub.length === 0 ||
    xpub.length > 256
  )
    return corrupt();
  return [id, type, xpub];
}

function ownerIdForChain(
  chain: string,
  identity: ReturnType<typeof accountIdentity>
): string {
  return digest([chain, ...identity]).slice(2);
}

function ownerId(owner: UtxoRecordOwner): string {
  return ownerIdForChain(chainKey(owner), accountIdentity(owner.account));
}

function guard(session: UtxoRecordSession) {
  const result: unknown = session.assertCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw new Error('UTXO_SIGNED_RECORD_CONTEXT_CHANGED');
  }
}

function isUtxoSubmissionUrl(url: string): boolean {
  const endpoint = new URL(url);
  return (
    ['http:', 'https:'].includes(endpoint.protocol) &&
    !endpoint.username &&
    !endpoint.password &&
    !/[?#]/.test(endpoint.href) &&
    endpoint.href === url &&
    endpoint.pathname.endsWith('/api/v2/sendtx/')
  );
}

function checkRecord(record: UtxoDurableSubmission): string {
  const owner = ownerId(record.owner);
  const {
    url,
    txid,
    rawTransaction: raw,
    operation,
    feeSatoshis,
    virtualSize,
  } = record;
  if (
    !isUtxoSubmissionUrl(url) ||
    !HASH.test(txid) ||
    !['wallet', 'external'].includes(operation) ||
    !validOutpoints(record.outpoints) ||
    !/^(0|[1-9][0-9]{0,19})$/.test(feeSatoshis) ||
    typeof raw !== 'string' ||
    raw.length > 2 * RAW_BYTES ||
    raw.length % 2 ||
    !/^[0-9a-f]+$/.test(raw)
  )
    return corrupt();
  const tx = syscoinUtils.bitcoinjs.Transaction.fromHex(raw);
  if (
    tx.toHex() !== raw ||
    tx.getId() !== txid ||
    tx.virtualSize() !== virtualSize ||
    !tx.outs.length ||
    tx.outs.length > PSBT_WORK_LIMITS.outputs ||
    JSON.stringify(utxoInputOutpoints(tx.ins)) !==
      JSON.stringify(record.outpoints)
  )
    return corrupt();
  return owner;
}

/** Shared outpoint fence and authenticated bytes. Platform storage owns commit atomicity. */
export class UtxoSignedRecords {
  private readonly storage: UtxoRecordStorage;
  private readonly onUnavailable: () => void;
  private unavailable = false;
  private readonly observations: Map<string, object>;
  private readonly admissionOwner: object;
  private readonly reconciliations = new Map<
    string,
    { assertCurrent(): void; work: Promise<string> }
  >();
  private readonly reconciliationCursors = new Map<
    string,
    { confirmed?: string; pending?: string }
  >();
  get requiresReopen(): boolean {
    return this.unavailable;
  }

  constructor(
    storage: UtxoRecordStorage,
    admissionOwner: object,
    onUnavailable: () => void = () => undefined
  ) {
    this.storage = storage;
    this.admissionOwner = admissionOwner;
    this.onUnavailable = onUnavailable;
    this.observations = observationsByStorage.get(storage) ?? new Map();
    observationsByStorage.set(storage, this.observations);
  }

  private exclusive<T>(
    operation: (release: () => void) => Promise<T>
  ): Promise<T> {
    const prior = queues.get(this.admissionOwner) ?? Promise.resolve();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(() => barrier);
    queues.set(this.admissionOwner, queued);
    void queued.then(() => {
      if (queues.get(this.admissionOwner) === queued)
        queues.delete(this.admissionOwner);
    });
    const running = prior.then(() => operation(release));
    void running.then(release, release);
    return running;
  }

  /** Hold admission through synchronous dispatch only, never through network ACK. */
  admit<T>(
    session: UtxoRecordSession,
    record: UtxoDurableSubmission,
    intent: 'initial' | 'replay',
    dispatch: (prepare: () => Promise<void>, release: () => void) => Promise<T>
  ): Promise<T> {
    return this.exclusive((release) => {
      let replayKey: string | undefined;
      return dispatch(
        async () => {
          if (intent === 'initial')
            return this.persistRetained(session, record);
          const before = await this.load(session);
          const retained = await this.readMatching(
            session,
            record.owner,
            record.txid,
            before.entries
          );
          if (
            !retained ||
            retained.record.rawTransaction !== record.rawTransaction ||
            retained.record.url !== record.url
          )
            throw new Error('Retained UTXO submission changed');
          // Replay can outlive a reorg or lose its ACK. Remove the old terminal
          // eviction authority before the exact bytes can leave this lease.
          if (
            retained.entry.phase === 'confirmed' &&
            !(await this.write(
              session,
              before,
              before.entries.map((entry) =>
                entry === retained.entry
                  ? { ...entry, phase: 'pending' }
                  : entry
              )
            ))
          )
            throw new Error('UTXO_SIGNED_RECORD_CONFLICT');
          replayKey = retained.entry.key;
        },
        () => {
          // A status read begun before POST cannot restore stale eviction authority.
          if (replayKey) this.observations.delete(replayKey);
          release();
        }
      );
    });
  }

  private requireReopen(): never {
    this.unavailable = true;
    try {
      this.onUnavailable();
    } catch {
      /* Preserve the storage quarantine result. */
    }
    return reopen();
  }

  private storageFailure(error: unknown): never {
    if (
      error instanceof Error &&
      (error.message === 'UTXO_SIGNED_RECORD_REOPEN_REQUIRED' ||
        error.message === 'STORAGE_REOPEN_REQUIRED')
    ) {
      return this.requireReopen();
    }
    throw error;
  }

  private async load(session: UtxoRecordSession) {
    if (this.unavailable) return reopen();
    guard(session);
    const profile = await session.keyring.getPrivateRecordProfileId();
    guard(session);
    if (!PROFILE.test(profile)) return corrupt();
    const raw = await this.storage
      .read(profile)
      .catch((error) => this.storageFailure(error));
    guard(session);
    if (raw === undefined)
      return { profile, raw, revision: -1, entries: [] as readonly Entry[] };
    const bundle = inspectUtxoSignedBundle(raw, profile);
    const root = await session.keyring.decryptPrivateRecord({
      domain: ROOT_DOMAIN,
      recordId: 'manifest',
      envelope: bundle.root,
    });
    try {
      guard(session);
      if (
        new TextDecoder().decode(root) !==
        JSON.stringify([bundle.revision, entriesDigest(bundle.entries)])
      )
        return corrupt();
    } finally {
      root.fill(0);
    }
    return { profile, raw, revision: bundle.revision, entries: bundle.entries };
  }

  private async write(
    session: UtxoRecordSession,
    before: Awaited<ReturnType<UtxoSignedRecords['load']>>,
    entries: readonly Entry[]
  ) {
    const revision = before.revision + 1;
    if (!Number.isSafeInteger(revision) || entries.length > MAX_RECORDS)
      return capacity();
    guard(session);
    const plaintext = encoder.encode(
      JSON.stringify([revision, entriesDigest(entries)])
    );
    let root: IEncryptedPrivateRecord;
    try {
      root = await session.keyring.encryptPrivateRecord({
        domain: ROOT_DOMAIN,
        recordId: 'manifest',
        plaintext,
      });
    } finally {
      plaintext.fill(0);
    }
    guard(session);
    if (!validUtxoEnvelope(root, before.profile, ROOT_DOMAIN, 'manifest'))
      return corrupt();
    const next = JSON.stringify({
      version: 1,
      profileId: before.profile,
      revision,
      root,
      entries,
    });
    if (next.length > UTXO_SIGNED_RECORD_BYTES) return capacity();
    const committed = await this.storage
      .compareAndSet(before.profile, before.raw, next, () => guard(session))
      .catch((error) => this.storageFailure(error));
    guard(session);
    if (typeof committed !== 'boolean') {
      return this.requireReopen();
    }
    return committed;
  }

  persist(
    session: UtxoRecordSession,
    candidate: UtxoDurableSubmission
  ): Promise<void> {
    const record = snapshotUtxoSubmission(candidate);
    return this.exclusive(() => this.persistRetained(session, record));
  }

  private async persistRetained(
    session: UtxoRecordSession,
    record: UtxoDurableSubmission
  ): Promise<void> {
    guard(session);
    const owner = checkRecord(record);
    const chain = chainKey(record.owner);
    const key = recordKey(chain, record.txid);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.load(session);
      if (before.entries.some((entry) => entry.key === key))
        throw new Error('UTXO_SIGNED_RECORD_ALREADY_RETAINED');
      // Independently approved external/RBF PSBTs deliberately can spend a predecessor's inputs.
      const selected = new Set(record.outpoints);
      if (
        record.operation === 'wallet' &&
        before.entries.some(
          (entry) =>
            entry.chain === chain &&
            entry.outpoints.some((point) => selected.has(point))
        )
      )
        throw new Error('UTXO_SIGNED_OUTPOINT_PENDING');
      const serialized = encoder.encode(JSON.stringify(record));
      const chunks: IEncryptedPrivateRecord[] = [];
      try {
        if (serialized.length > 2 * RAW_BYTES + 64 * 1024) return capacity();
        for (
          let offset = 0;
          offset < serialized.length;
          offset += CHUNK_BYTES
        ) {
          const bytes = serialized.subarray(offset, offset + CHUNK_BYTES);
          guard(session);
          const recordId = `${key}/${chunks.length}`;
          const chunk = await session.keyring.encryptPrivateRecord({
            domain: CHUNK_DOMAIN,
            recordId,
            plaintext: bytes,
          });
          guard(session);
          if (!validUtxoEnvelope(chunk, before.profile, CHUNK_DOMAIN, recordId))
            return corrupt();
          chunks.push(chunk);
        }
      } finally {
        serialized.fill(0);
      }
      const entry: Entry = {
        key,
        owner,
        chain,
        txid: record.txid,
        outpoints: record.outpoints,
        phase: 'pending',
        chunks,
      };
      // Reserve the larger future phase strings and a bounded revision increase.
      let projected =
        (before.raw?.length ?? 2048) + JSON.stringify(entry).length + 64;
      let count = before.entries.length + 1;
      for (const existing of before.entries)
        if (existing.phase === 'pending') projected += 2;
      const fits = () =>
        projected <= UTXO_SIGNED_RECORD_BYTES && count <= MAX_RECORDS;
      const evicted: string[] = [];
      const retained = before.entries.filter((existing) => {
        if (
          fits() ||
          existing.phase !== 'confirmed' ||
          this.observations.has(existing.key)
        )
          return true;
        projected -= JSON.stringify(existing).length + 1;
        count--;
        evicted.push(existing.key);
        return false;
      });
      if (!fits()) return capacity();
      // A status check can acquire the retained row while the manifest is
      // being encrypted or the host is waiting at its commit boundary.
      let evictionBlocked = false;
      const guardedSession: UtxoRecordSession = evicted.length
        ? {
            ...session,
            assertCurrent: () => {
              guard(session);
              if (
                evicted.some((evictedKey) => this.observations.has(evictedKey))
              ) {
                evictionBlocked = true;
                capacity();
              }
            },
          }
        : session;
      try {
        if (await this.write(guardedSession, before, [...retained, entry]))
          return;
      } catch (error) {
        // Native storage may normalize a rejected guard after rolling back.
        // A failed rollback or uncertain write takes precedence over capacity.
        if (evictionBlocked && !this.unavailable) return capacity();
        throw error;
      }
    }
    throw new Error('UTXO_SIGNED_RECORD_CONFLICT');
  }

  async acknowledge(
    session: UtxoRecordSession,
    owner: UtxoRecordOwner,
    txid: string
  ): Promise<void> {
    return this.exclusive(() =>
      this.mark(session, owner, txid, 'submitted', 'pending')
    );
  }

  private async mark(
    session: UtxoRecordSession,
    owner: UtxoRecordOwner,
    txid: string,
    phase: Summary['phase'],
    onlyFrom?: Summary['phase'],
    observedChunks?: Entry['chunks']
  ) {
    const identity = ownerId(owner),
      key = recordKey(chainKey(owner), txid);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.load(session);
      const match = before.entries.find(
        (entry) => entry.key === key && entry.owner === identity
      );
      if (
        observedChunks &&
        (match?.chunks.length !== observedChunks.length ||
          !match.chunks.every(
            (chunk, index) =>
              chunk.nonce === observedChunks[index]?.nonce &&
              chunk.ciphertext === observedChunks[index]?.ciphertext
          ))
      )
        throw new Error('UTXO observation changed');
      if (!match) return corrupt();
      if (
        match.phase === phase ||
        (onlyFrom !== undefined && match.phase !== onlyFrom) ||
        (await this.write(
          session,
          before,
          before.entries.map((entry) =>
            entry === match ? { ...entry, phase } : entry
          )
        ))
      )
        return;
    }
    throw new Error('UTXO_SIGNED_RECORD_CONFLICT');
  }

  async readExact(
    session: UtxoRecordSession,
    owner: UtxoRecordOwner,
    txid: string
  ): Promise<UtxoDurableSubmission | undefined> {
    const { entries } = await this.load(session);
    return (await this.readMatching(session, owner, txid, entries))?.record;
  }

  private async readMatching(
    session: UtxoRecordSession,
    owner: UtxoRecordOwner,
    txid: string,
    entries: readonly Entry[]
  ) {
    const identity = ownerId(owner),
      key = recordKey(chainKey(owner), txid);
    const entry = entries.find(
      (item) => item.key === key && item.owner === identity
    );
    return entry
      ? { record: await this.readEntry(session, entry), entry }
      : undefined;
  }

  private async readEntry(
    session: UtxoRecordSession,
    entry: Entry
  ): Promise<UtxoDurableSubmission> {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    for (let index = 0; index < entry.chunks.length; index++) {
      guard(session);
      const bytes = await session.keyring.decryptPrivateRecord({
        domain: CHUNK_DOMAIN,
        recordId: `${entry.key}/${index}`,
        envelope: entry.chunks[index]!,
      });
      try {
        guard(session);
        if (!bytes.length || bytes.length > CHUNK_BYTES) return corrupt();
        text += decoder.decode(bytes, { stream: true });
      } finally {
        bytes.fill(0);
      }
    }
    text += decoder.decode();
    const record = JSON.parse(text);
    if (
      JSON.stringify(record) !== text ||
      checkRecord(record) !== entry.owner ||
      chainKey(record.owner) !== entry.chain ||
      record.txid !== entry.txid ||
      JSON.stringify(record.outpoints) !== JSON.stringify(entry.outpoints)
    )
      return corrupt();
    guard(session);
    return record as UtxoDurableSubmission;
  }

  async fundingExclusions(session: UtxoRecordSession, owner: UtxoRecordOwner) {
    const chain = chainKey(owner);
    const identity = ownerIdForChain(chain, accountIdentity(owner.account));
    const { entries } = await this.load(session);
    const points = new Set<string>();
    const submitted = new Set<string>();
    for (const entry of entries) {
      if (entry.chain !== chain || entry.phase === 'confirmed') continue;
      // An exact POST acknowledgment or raw network observation can set
      // submitted. Locally signed bytes alone only protect the outpoint.
      const acknowledged =
        entry.owner === identity && entry.phase === 'submitted';
      for (const point of entry.outpoints) {
        points.add(point);
        if (acknowledged) submitted.add(point);
      }
    }
    return {
      outpoints: [...points].map((point) => ({
        txid: point.slice(0, 64),
        vout: Number(point.slice(65)),
      })),
      submitted,
    };
  }

  async list(
    session: UtxoRecordSession,
    owner: UtxoRecordOwner
  ): Promise<readonly Readonly<{ accepted: boolean; txid: string }>[]> {
    const identity = ownerId(owner);
    const { entries } = await this.load(session);
    return entries
      .filter(
        (entry) => entry.owner === identity && entry.phase !== 'confirmed'
      )
      .map(({ txid, phase }) => ({ txid, accepted: phase !== 'pending' }));
  }

  /** Refresh a bounded, rotating selection without discarding recovery bytes.
   * Confirmed entries remain candidates so a later reorg can expose them again. */
  async reconcile(
    session: UtxoRecordSession,
    owner: UtxoRecordOwner,
    observe: (txid: string) => Promise<unknown>
  ): Promise<void> {
    const identity = ownerId(owner);
    guard(session);
    const running = this.reconciliations.get(identity);
    if (running) {
      let previousProfile: string;
      try {
        previousProfile = await running.work;
      } catch (error) {
        guard(session);
        try {
          running.assertCurrent();
        } catch {
          // A fresh unlocked session must not inherit the old view's cancellation.
          return this.reconcile(session, owner, observe);
        }
        throw error;
      }
      guard(session);
      const profile = await session.keyring.getPrivateRecordProfileId();
      guard(session);
      if (profile !== previousProfile)
        return this.reconcile(session, owner, observe);
      return;
    }
    // Reserve before the asynchronous manifest read so concurrent host refreshes
    // cannot launch the same status pass while that read is still in flight.
    const work = (async () => {
      const { entries, profile } = await this.load(session);
      const key = `${profile}:${identity}`;
      // Background work must not supersede an explicit check already in flight.
      const available = entries.filter(
        (entry) => entry.owner === identity && !this.observations.has(entry.key)
      );
      const pending = available.filter((entry) => entry.phase !== 'confirmed');
      const confirmed = available.filter(
        (entry) => entry.phase === 'confirmed'
      );
      if (!pending.length && !confirmed.length) return profile;
      const cursor = this.reconciliationCursors.get(key) ?? {};
      const selected: string[] = [];
      for (const [phase, candidates] of [
        ['pending', pending],
        ['confirmed', confirmed],
      ] as const) {
        if (!candidates.length) continue;
        const limit = pending.length && confirmed.length ? 1 : 2;
        const start =
          (candidates.findIndex((entry) => entry.txid === cursor[phase]) + 1) %
          candidates.length;
        for (
          let offset = 0;
          offset < Math.min(limit, candidates.length);
          offset++
        )
          selected.push(candidates[(start + offset) % candidates.length]!.txid);
        cursor[phase] = selected[selected.length - 1];
      }
      this.reconciliationCursors.delete(key);
      this.reconciliationCursors.set(key, cursor);
      if (this.reconciliationCursors.size > MAX_RECORDS)
        this.reconciliationCursors.delete(
          this.reconciliationCursors.keys().next().value!
        );
      const results = await Promise.allSettled(
        selected.map(async (txid) => {
          guard(session);
          await observe(txid);
        })
      );
      guard(session);
      for (const result of results)
        if (result.status === 'rejected') throw result.reason;
      return profile;
    })();
    const admission = { assertCurrent: () => guard(session), work };
    this.reconciliations.set(identity, admission);
    try {
      await work;
    } finally {
      if (this.reconciliations.get(identity) === admission)
        this.reconciliations.delete(identity);
    }
  }

  /** Keep the original endpoint reachable until its pending transfers resolve. */
  replaceEndpoint<T>(
    session: UtxoRecordSession,
    chain: UtxoRecordChain,
    retiringSubmissionUrl: string,
    commit: () => Promise<T>
  ): Promise<T> {
    if (!isUtxoSubmissionUrl(retiringSubmissionUrl))
      throw new Error('Invalid UTXO submission endpoint');
    const identity = chainKey(chain);
    return this.exclusive(async () => {
      const { entries } = await this.load(session);
      for (const entry of entries) {
        if (entry.chain !== identity || entry.phase === 'confirmed') continue;
        const retained = await this.readEntry(session, entry);
        if (retained.url === retiringSubmissionUrl)
          throw Object.assign(
            new Error(
              'Check your saved transfers before changing this endpoint.'
            ),
            { code: 'UTXO_ENDPOINT_HAS_SAVED_TRANSFER' }
          );
      }
      guard(session);
      return commit();
    });
  }

  /** A registration can own retained bytes from more than one endpoint. */
  removeRegistration<T>(
    session: UtxoRecordSession,
    registration: Readonly<Pick<UtxoRecordChain, 'chainId' | 'slip44'>>,
    commit: () => Promise<T>
  ): Promise<T> {
    const { chainId, slip44 } = registration;
    if (
      !Number.isSafeInteger(chainId) ||
      chainId < 0 ||
      !Number.isSafeInteger(slip44) ||
      slip44 < 0
    )
      return corrupt();
    return this.exclusive(async () => {
      const { entries } = await this.load(session);
      const checked = new Set<string>();
      for (const entry of entries) {
        if (entry.phase === 'confirmed' || checked.has(entry.chain)) continue;
        const { owner } = await this.readEntry(session, entry);
        if (owner.chainId === chainId && owner.slip44 === slip44)
          throw Object.assign(
            new Error(
              'Check your saved transfers before removing this network.'
            ),
            { code: 'UTXO_NETWORK_HAS_SAVED_TRANSFER' }
          );
        checked.add(entry.chain);
      }
      guard(session);
      return commit();
    });
  }

  /** Wait for admission already in progress across the account group's networks. */
  hasUnresolvedForAccount(
    session: UtxoRecordSession,
    slip44: number,
    account: UtxoRecordOwner['account']
  ): Promise<boolean> {
    if (!Number.isSafeInteger(slip44) || slip44 < 0) return corrupt();
    const identity = accountIdentity(account);
    return this.exclusive(async () => {
      const { entries } = await this.load(session);
      const checkedChains = new Set<string>();
      for (const entry of entries) {
        if (entry.phase === 'confirmed' || checkedChains.has(entry.chain))
          continue;
        if (entry.owner !== ownerIdForChain(entry.chain, identity)) continue;
        // The header binds a hashed chain identity, so read only exact owner
        // matches to recover the authenticated group without using a provider.
        const record = await this.readEntry(session, entry);
        if (record.owner.slip44 === slip44) return true;
        checkedChains.add(entry.chain);
      }
      return false;
    });
  }

  /** Admit a status read only after authenticating the exact saved record. */
  async observeRetained(
    session: UtxoRecordSession,
    owner: UtxoRecordOwner,
    txid: string,
    read: (
      record: UtxoDurableSubmission,
      assertCurrent: () => void
    ) => Promise<unknown>
  ): Promise<'confirmed' | 'seen' | 'unknown'> {
    guard(session);
    const key = recordKey(chainKey(owner), txid),
      request = {};
    this.observations.set(key, request);
    const observation = {
      ...session,
      assertCurrent: () => {
        guard(session);
        if (this.observations.get(key) !== request)
          throw new Error('UTXO observation changed');
      },
    };
    try {
      const { entries } = await this.load(observation);
      const match = await this.readMatching(observation, owner, txid, entries);
      if (!match) return 'unknown';
      const retained = snapshotUtxoSubmission(match.record);
      guard(observation);
      let response: unknown = null;
      try {
        response = await read(retained, observation.assertCurrent);
      } catch {
        // A failed network read cannot keep an older confirmation eligible for eviction.
      }
      guard(observation);
      const observed = response as {
        blockHash?: string;
        confirmations?: number;
        hex?: string;
        txid?: string;
      } | null;
      const matches =
        observed?.txid === txid &&
        observed.hex === retained.rawTransaction &&
        Number.isSafeInteger(observed.confirmations) &&
        observed.confirmations! >= 0;
      const confirmed =
        matches &&
        observed.confirmations! > 0 &&
        typeof observed.blockHash === 'string' &&
        HASH.test(observed.blockHash);
      await this.exclusive(() =>
        this.mark(
          observation,
          owner,
          txid,
          confirmed ? 'confirmed' : matches ? 'submitted' : 'pending',
          // An unverified observation revokes terminal eviction authority.
          // Preserve any earlier submission ACK on an already retained record.
          matches ? undefined : 'confirmed',
          match.entry.chunks
        )
      );
      return confirmed ? 'confirmed' : matches ? 'seen' : 'unknown';
    } finally {
      if (this.observations.get(key) === request) this.observations.delete(key);
    }
  }

  async validate(session: UtxoRecordSession): Promise<void> {
    await this.load(session);
  }
}
