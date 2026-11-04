import {
  captureEvmSubmission,
  submitSignedEvmTransaction,
  evmSubmissionFailure,
} from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';

import {
  createErc20Policy,
  decodeErc20Transfer,
  type Erc20Metadata,
} from '../shared/erc20.ts';

import {
  EvmSignedRecords,
  createEvmSignedRecordLifecycle,
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
export type EvmReplaySession = Readonly<{
  assertCurrent(): void;
  context: Pick<EvmSubmissionContext, 'account' | 'network'>;
  dispatch(rawTransaction: string): Promise<string>;
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
  lifecycle: ReturnType<typeof createEvmSignedRecordLifecycle>;
  review: EvmReplayReview;
  session: EvmReplaySession;
};
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
  if (entry.operation !== 'erc20' || !tx.to || tx.value !== BigInt(0))
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
  });
}

/** Ephemeral explicit consent over existing retained bytes, never a signer or nonce allocator. */
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
      { ...options, maximum: options.maximum ?? 30 }
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
    const lifecycle = createEvmSignedRecordLifecycle(
      this.records,
      session.recordSession
    );
    this.check(state);
    const entry = await this.records.readExact(
      session.recordSession,
      String(context.network.chainId),
      context.account.address,
      hash
    );
    this.check(state);
    if (!entry) throw new EvmReplayError('NOT_FOUND');
    const observation = await session.observe(request(entry));
    this.check(state);
    const phase =
      observation.status === 'mined'
        ? observation.outcome
        : BigInt(observation.latestNonce) > BigInt(entry.nonce)
        ? 'nonce-consumed'
        : null;
    if (phase) {
      await this.records.updatePhase(
        session.recordSession,
        entry.chainId,
        entry.from,
        entry.hash,
        phase
      );
      this.check(state);
      return Object.freeze({
        status: phase,
        hash: entry.hash,
        transaction: projectSavedEvmTransaction({ ...entry, phase }),
      });
    }
    if (['confirmed', 'reverted', 'nonce-consumed'].includes(entry.phase)) {
      // A fresh missing observation revises the old outcome even if the user
      // closes this review or a later dispatch acknowledgement is lost.
      await this.records.updatePhase(
        session.recordSession,
        entry.chainId,
        entry.from,
        entry.hash,
        'submitted'
      );
      this.check(state);
    }
    const missingNonce =
      observation.status === 'missing' &&
      BigInt(observation.latestNonce) < BigInt(entry.nonce)
        ? observation.latestNonce
        : undefined;
    const candidates =
      missingNonce === undefined
        ? []
        : (
            await this.records.listSender(
              session.recordSession,
              entry.chainId,
              entry.from
            )
          ).filter((candidate) => String(candidate.nonce) === missingNonce);
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
    this.pending = { ...state, entry, review, lifecycle };
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
    const boundary = captureEvmSubmission(
      {
        ...session.context,
        operation: entry.operation,
        ...(entry.originalHash ? { originalHash: entry.originalHash } : {}),
      },
      check,
      () => pending.lifecycle
    );
    let dispatched = false;
    try {
      const hash = await submitSignedEvmTransaction(
        entry.rawTransaction,
        async (raw) => {
          check();
          const result = await session.dispatch(raw);
          if (result.toLowerCase() !== entry.hash)
            throw new EvmReplayError('INVALID_RESPONSE');
          return result;
        },
        boundary,
        check
      );
      dispatched = true;
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
      if (!dispatched && evmSubmissionFailure(error).transactionNotBroadcast)
        throw error;
      // Retained bytes survive a lost acknowledgement; never dispatch again here.
      return Object.freeze({ status: 'unknown', hash: entry.hash });
    }
  }
}
