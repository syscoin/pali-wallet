import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';

import {
  createErc20Policy,
  decodeErc20Transfer,
  type Erc20Metadata,
} from '../shared/erc20.ts';
import { isEvmEmptySelfCall } from '../shared/evmCancellationPayer.ts';
import {
  decodeRetainedNftTransfer,
  type NftTransferIntent,
} from '../shared/nftTransfer.ts';

import {
  EvmSignedRecords,
  type EvmSignedRecordSession,
  type EvmRetainedSignedRecord,
  type EvmSignedRecordSummary,
} from './evmSignedRecords.ts';
import type {
  EvmObservationRequest,
  EvmTransactionObservation,
} from '../shared/evmTransactionObservation.ts';
import type { EvmSubmissionContext } from '@sidhujag/sysweb3-keyring';

export type EvmReplayCandidate = Pick<
  EvmSignedRecordSummary,
  'hash' | 'nonce' | 'operation' | 'originalHash'
>;
export type EvmSavedTransaction = EvmReplayCandidate &
  Readonly<{
    chainId: string;
    collectibleTransfer?: NftTransferIntent;
    createdAt: number;
    dataBytes: number;
    feePerGas: string;
    from: string;
    gasLimit: string;
    maximumFee: string;
    phase: EvmSignedRecordSummary['phase'];
    selector: string | null;
    to: string | null;
    tokenTransfer?: Readonly<{
      amountUnits: string;
      recipient: string;
      token?: Erc20Metadata;
    }>;
    type: number | null;
    value: string;
  }>;

export type EvmReplayReview = Readonly<{
  accessListEntries: number;
  chainId: string;
  dataBytes: number;
  feePerGas: string;
  from: string;
  gasLimit: string;
  hash: string;
  id: string;
  maximumFee: string;
  missingNonce?: string;
  nonce: string;
  operation: EvmSignedRecordSummary['operation'];
  originalHash?: string;
  predecessorCount: number;
  predecessors: readonly EvmReplayCandidate[];
  priorityFeePerGas: string | null;
  selector: string | null;
  to: string | null;
  tokenTransfer?: EvmSavedTransaction['tokenTransfer'];
  validForMs: number;
  value: string;
}>;
export type EvmReplayPreparation = Readonly<
  | { review: EvmReplayReview; status: 'review' }
  | {
      hash: string;
      status: 'confirmed' | 'reverted' | 'nonce-consumed';
      transaction: EvmSavedTransaction;
    }
>;
export type EvmReplayDispatchAdmission = (
  send: () => Promise<string>,
  preflight: () => Promise<void>
) => Promise<string>;
export type EvmReplayDispatchContext = Pick<
  EvmSignedRecordSummary,
  'operation' | 'originalHash' | 'chainId' | 'from' | 'nonce' | 'hash'
> &
  Readonly<{ requiresPayerCheck?: true }>;
export type EvmReplaySession = Readonly<{
  assertCurrent(): void;
  context: Pick<EvmSubmissionContext, 'account' | 'network'>;
  /** Replay supplies its bounded host preflight to admission. `send`
   * synchronously initiates transport and returns its acknowledgment promise. */
  dispatch(
    rawTransaction: string,
    admit: EvmReplayDispatchAdmission,
    context: EvmReplayDispatchContext
  ): Promise<string>;
  observe(expected: EvmObservationRequest): Promise<EvmTransactionObservation>;
  recordSession: EvmSignedRecordSession;
}>;
export class EvmReplayError extends Error {
  readonly code:
    | 'NOT_FOUND'
    | 'EXPIRED'
    | 'CONTEXT_CHANGED'
    | 'INVALID_RESPONSE';
  constructor(code: EvmReplayError['code']) {
    super(code);
    this.code = code;
    this.name = 'EvmReplayError';
  }
}
type Pending = {
  entry: EvmRetainedSignedRecord;
  expires: number;
  generation: number;
  review: EvmReplayReview;
  session: EvmReplaySession;
};
const REPLAY_PREFLIGHT_MS = 12000;
function selectedHash(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new EvmReplayError('NOT_FOUND');
  return value.toLowerCase();
}
const request = (entry: EvmRetainedSignedRecord): EvmObservationRequest => {
  const tx = Transaction.from(entry.rawTransaction);
  return Object.freeze({
    chainId: entry.chainId,
    hash: entry.hash,
    from: entry.from,
    to: tx.to,
    nonce: String(entry.nonce),
  });
};
function tokenTransfer(
  entry: EvmRetainedSignedRecord,
  tx: Transaction
): EvmSavedTransaction['tokenTransfer'] {
  if (
    (entry.operation !== 'erc20' &&
      (entry.operation !== 'speed-up' || !entry.metadata?.intent)) ||
    !tx.to ||
    tx.value !== BigInt(0)
  )
    return undefined;
  try {
    const decoded = decodeErc20Transfer(tx.data);
    let token: Erc20Metadata | undefined;
    try {
      const intent = entry.metadata?.intent as
        | Record<string, unknown>
        | undefined;
      const candidate = createErc20Policy(getAddress).parseMetadata(
        intent?.token
      );
      if (candidate.contractAddress === tx.to) token = candidate;
    } catch {
      /* The signed call is still reviewable without cached token metadata. */
    }
    return Object.freeze({ ...decoded, ...(token ? { token } : {}) });
  } catch {
    return undefined;
  }
}
export function projectSavedEvmTransaction(
  entry: EvmRetainedSignedRecord
): EvmSavedTransaction {
  const tx = Transaction.from(entry.rawTransaction),
    fee = tx.maxFeePerGas ?? tx.gasPrice;
  if (fee === null) throw new EvmReplayError('INVALID_RESPONSE');
  const token = tokenTransfer(entry, tx);
  const collectible = decodeRetainedNftTransfer(entry, tx);
  return Object.freeze({
    hash: entry.hash,
    nonce: entry.nonce,
    operation: entry.operation,
    ...(entry.originalHash ? { originalHash: entry.originalHash } : {}),
    chainId: entry.chainId,
    from: entry.from,
    to: tx.to,
    value: tx.value.toString(),
    createdAt: entry.createdAt,
    phase: entry.phase,
    type: tx.type,
    gasLimit: tx.gasLimit.toString(),
    feePerGas: fee.toString(),
    maximumFee: (tx.gasLimit * fee).toString(),
    dataBytes: (tx.data.length - 2) / 2,
    selector: tx.data.length >= 10 ? tx.data.slice(0, 10) : null,
    ...(token ? { tokenTransfer: token } : {}),
    ...(collectible ? { collectibleTransfer: collectible } : {}),
  });
}

/** Ephemeral explicit consent over existing retained bytes, never a signer or nonce allocator. */
/** Shared retained-record observation. It does not create a replay review or dispatch.
 * The caller owns the selected authority; every await retains that captured guard. */
export async function observeRetainedEvmTransaction(
  records: EvmSignedRecords,
  recordSession: EvmSignedRecordSession,
  chainId: string,
  from: string,
  hash: string,
  observe: EvmReplaySession['observe'],
  assertCurrent: () => void
): Promise<
  Readonly<{
    entry: EvmRetainedSignedRecord;
    observation: EvmTransactionObservation;
    terminalPhase: 'confirmed' | 'reverted' | 'nonce-consumed' | null;
  }>
> {
  const session = Object.freeze({
    keyring: recordSession.keyring,
    assertCurrent: recordSession.assertCurrent,
  });
  const current = assertCurrent,
    read = observe;
  current();
  const saved = await records.readForObservation(session, chainId, from, hash);
  current();
  if (!saved) throw new EvmReplayError('NOT_FOUND');
  const { entry, revision } = saved;
  const observation = await read(request(entry));
  current();
  const terminalPhase =
    observation.status === 'mined'
      ? observation.outcome
      : BigInt(observation.latestNonce) > BigInt(entry.nonce)
      ? 'nonce-consumed'
      : null;
  const phase =
    terminalPhase ??
    (['confirmed', 'reverted', 'nonce-consumed'].includes(entry.phase)
      ? 'submitted'
      : entry.phase);
  try {
    if (entry.operation === 'cancel' && observation.status === 'mined') {
      await records.reconcileMinedCancellation(
        session,
        entry,
        revision,
        observation,
        () => {
          current();
          return read(request(entry));
        }
      );
    } else if (terminalPhase || phase !== entry.phase) {
      await records.updateObservedPhase(session, entry, revision, phase);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'EVM_SIGNED_RECORD_OBSERVATION_CHANGED'
    )
      throw new EvmReplayError('CONTEXT_CHANGED');
    throw error;
  }
  current();
  return Object.freeze({
    entry: Object.freeze({ ...entry, phase }),
    observation,
    terminalPhase,
  });
}

export class EvmSignedReplay {
  private pending: Pending | null = null;
  private ownerId: string | null = null;
  private generation = 0;
  private readonly records: EvmSignedRecords;
  private readonly capture: () => EvmReplaySession;
  private readonly now: () => number;
  private readonly randomBytes: (length: number) => Uint8Array;
  constructor(
    records: EvmSignedRecords,
    capture: () => EvmReplaySession,
    now: () => number = () => performance.now(),
    randomBytes: (length: number) => Uint8Array = (length) =>
      globalThis.crypto.getRandomValues(new Uint8Array(length))
  ) {
    this.records = records;
    this.capture = capture;
    this.now = now;
    this.randomBytes = randomBytes;
  }
  cancel(id?: string): void {
    if (id !== undefined && this.ownerId !== id) return;
    this.generation++;
    this.pending = null;
    this.ownerId = null;
  }
  private time(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < 0)
      throw new EvmReplayError('EXPIRED');
    return value;
  }
  async get(hash: string): Promise<EvmSavedTransaction | null> {
    hash = selectedHash(hash);
    const session = this.capture();
    session.assertCurrent();
    const entry = await this.records.readExact(
      session.recordSession,
      String(session.context.network.chainId),
      session.context.account.address,
      hash
    );
    session.assertCurrent();
    return entry ? projectSavedEvmTransaction(entry) : null;
  }
  async list(
    options: Readonly<{
      beforeHash?: string;
      maximum?: number;
      nonce?: number;
    }> = {}
  ): Promise<
    Readonly<{
      nextCursor: string | null;
      transactions: readonly EvmSavedTransaction[];
    }>
  > {
    const session = this.capture();
    session.assertCurrent();
    const result = await this.records.readPage(
      session.recordSession,
      String(session.context.network.chainId),
      session.context.account.address,
      {
        ...options,
        maximum: options.maximum ?? 30,
        replayCandidatesOnly: options.nonce !== undefined,
      }
    );
    session.assertCurrent();
    return Object.freeze({
      nextCursor: result.nextCursor,
      transactions: Object.freeze(
        result.entries.map(projectSavedEvmTransaction)
      ),
    });
  }
  private check(
    pending: Pick<Pending, 'generation' | 'session' | 'expires'>
  ): void {
    if (pending.generation !== this.generation)
      throw new EvmReplayError('CONTEXT_CHANGED');
    pending.session.assertCurrent();
    pending.session.recordSession.assertCurrent();
    if (this.time() >= pending.expires) throw new EvmReplayError('EXPIRED');
  }
  private async waitReplayPreflight(
    expires: number,
    assertCurrent: () => void,
    preflight: () => Promise<void>
  ): Promise<void> {
    assertCurrent();
    const started = this.time();
    const cutoff = Math.min(expires, started + REPLAY_PREFLIGHT_MS);
    const timeoutMs = Math.ceil(cutoff - started);
    if (timeoutMs <= 0) throw new EvmReplayError('EXPIRED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new EvmReplayError('EXPIRED')),
          timeoutMs
        );
      });
      // This bounds the queue wait. The host still owns transport cancellation.
      const result = await Promise.race([preflight(), deadline]);
      if (this.time() >= cutoff) throw new EvmReplayError('EXPIRED');
      if (result !== undefined) throw new EvmReplayError('CONTEXT_CHANGED');
    } finally {
      clearTimeout(timer);
    }
  }
  async prepare(hash: string): Promise<EvmReplayPreparation> {
    hash = selectedHash(hash);
    this.cancel();
    const captured = this.capture();
    captured.assertCurrent();
    // Capture references before any read; the account/network cannot be swapped
    // while a provider or durable record is being awaited.
    const context = Object.freeze({
      account: Object.freeze({ ...captured.context.account }),
      network: Object.freeze({ ...captured.context.network }),
    });
    const session: EvmReplaySession = Object.freeze({
      recordSession: captured.recordSession,
      context,
      assertCurrent: captured.assertCurrent,
      observe: captured.observe,
      dispatch: captured.dispatch,
    });
    const state = {
      session,
      generation: this.generation,
      expires: this.time() + 90000,
    };
    this.check(state);
    const {
      entry,
      observation,
      terminalPhase: phase,
    } = await observeRetainedEvmTransaction(
      this.records,
      session.recordSession,
      String(context.network.chainId),
      context.account.address,
      hash,
      session.observe,
      () => this.check(state)
    );
    this.check(state);
    if (phase)
      return Object.freeze({
        status: phase,
        hash: entry.hash,
        transaction: projectSavedEvmTransaction(entry),
      });
    const missingNonce =
      observation.status === 'missing' &&
      BigInt(observation.latestNonce) < BigInt(entry.nonce)
        ? observation.latestNonce
        : undefined;
    const eligible = await this.records.withReplayAdmission(
      session.recordSession,
      entry,
      (candidates) => candidates,
      missingNonce === undefined ? undefined : Number(missingNonce)
    );
    this.check(state);
    if (!eligible) throw new EvmReplayError('CONTEXT_CHANGED');
    const candidates = eligible.result;
    const predecessors = candidates
      .slice(-20)
      .reverse()
      .map(({ hash: candidateHash, nonce, operation, originalHash }) =>
        Object.freeze({
          hash: candidateHash,
          nonce,
          operation,
          ...(originalHash ? { originalHash } : {}),
        })
      );
    this.check(state);
    const tx = Transaction.from(entry.rawTransaction),
      fee = tx.maxFeePerGas ?? tx.gasPrice;
    if (fee === null) throw new EvmReplayError('INVALID_RESPONSE');
    const entropy = this.randomBytes(16);
    if (!(entropy instanceof Uint8Array) || entropy.length !== 16)
      throw new EvmReplayError('INVALID_RESPONSE');
    const id = `${Array.from(entropy, (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')}-${state.generation}`;
    entropy.fill(0);
    const review: EvmReplayReview = Object.freeze({
      id,
      hash: entry.hash,
      chainId: entry.chainId,
      from: entry.from,
      to: tx.to,
      nonce: String(entry.nonce),
      value: tx.value.toString(),
      gasLimit: tx.gasLimit.toString(),
      feePerGas: fee.toString(),
      priorityFeePerGas: tx.maxPriorityFeePerGas?.toString() ?? null,
      maximumFee: (tx.gasLimit * fee).toString(),
      dataBytes: (tx.data.length - 2) / 2,
      selector: tx.data.length >= 10 ? tx.data.slice(0, 10) : null,
      accessListEntries: tx.accessList?.length ?? 0,
      operation: entry.operation,
      ...(entry.originalHash ? { originalHash: entry.originalHash } : {}),
      ...(missingNonce === undefined ? {} : { missingNonce }),
      predecessors: Object.freeze(predecessors),
      predecessorCount: candidates.length,
      validForMs: Math.max(0, Math.floor(state.expires - this.time())),
      ...(tokenTransfer(entry, tx)
        ? { tokenTransfer: tokenTransfer(entry, tx) }
        : {}),
    });
    this.ownerId = id;
    this.pending = { ...state, entry, review };
    return Object.freeze({ status: 'review', review });
  }
  async confirm(
    id: string
  ): Promise<Readonly<{ hash: string; status: 'submitted' | 'unknown' }>> {
    const pending = this.pending;
    if (!pending || pending.review.id !== id)
      throw new EvmReplayError('EXPIRED');
    this.pending = null; // Consume before the first await, including double clicks.
    const check = () => this.check(pending);
    check();
    const { session, entry } = pending;
    const current = await this.records.readExact(
      session.recordSession,
      entry.chainId,
      entry.from,
      entry.hash
    );
    check();
    if (!current || current.rawTransaction !== entry.rawTransaction)
      throw new EvmReplayError('CONTEXT_CHANGED');
    const observed = await session.observe(request(entry));
    check();
    if (
      observed.status === 'mined' ||
      BigInt(observed.latestNonce) > BigInt(entry.nonce)
    )
      throw new EvmReplayError('CONTEXT_CHANGED');
    const {
      operation,
      originalHash,
      chainId,
      from,
      nonce,
      hash: retainedHash,
    } = entry;
    const zeroSelfReplacement =
      operation === 'speed-up' &&
      isEvmEmptySelfCall(Transaction.from(entry.rawTransaction));
    const requiresPayerCheck = operation === 'cancel' || zeroSelfReplacement;
    const dispatchContext: EvmReplayDispatchContext = Object.freeze({
      operation,
      ...(zeroSelfReplacement ? { requiresPayerCheck: true as const } : {}),
      ...(originalHash ? { originalHash } : {}),
      chainId,
      from,
      nonce,
      hash: retainedHash,
    });
    let dispatched = false;
    try {
      // Replay comes only from the authenticated retained record. The network
      // callback must pass the durable replay admission below before sending.
      check();
      let open = true;
      let requested = false;
      let hash: string;
      try {
        const result = await session.dispatch(
          current.rawTransaction,
          async (send, preflight) => {
            if (!open || requested || typeof preflight !== 'function')
              throw new EvmReplayError('CONTEXT_CHANGED');
            requested = true;
            const checkAdmission = () => {
              if (!open) throw new EvmReplayError('CONTEXT_CHANGED');
              check();
            };
            const admission = await this.records.withReplayAdmission(
              session.recordSession,
              entry,
              () => {
                checkAdmission();
                if (!requiresPayerCheck) dispatched = true;
                const response = send();
                dispatched = true;
                // The response can reject before the storage queue yields.
                void response.catch(() => undefined);
                return response;
              },
              undefined,
              {
                assertCurrent: checkAdmission,
                run: () =>
                  this.waitReplayPreflight(
                    pending.expires,
                    checkAdmission,
                    preflight
                  ),
              }
            );
            if (!admission) throw new EvmReplayError('CONTEXT_CHANGED');
            return admission.result;
          },
          dispatchContext
        );
        if (!dispatched || result.toLowerCase() !== entry.hash)
          throw new EvmReplayError('INVALID_RESPONSE');
        hash = result;
      } finally {
        open = false;
      }
      check();
      await this.records.updatePhase(
        session.recordSession,
        entry.chainId,
        entry.from,
        entry.hash,
        'submitted'
      );
      check();
      return Object.freeze({ status: 'submitted', hash });
    } catch (error) {
      if (!dispatched) throw error;
      // Retained bytes survive a lost acknowledgement; never dispatch again here.
      return Object.freeze({ status: 'unknown', hash: entry.hash });
    }
  }
}
