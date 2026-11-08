import {
  createEoaCallsSequence,
  type EoaCallsProgress,
  type EoaCallsStopped,
} from '../../../../source/wallet/evmCallsSequence.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeApproval.ts';
import type { EvmDappFeeChoiceFields } from '../../../../source/shared/evmDappFeePolicy.ts';
import type { DappCallsRequest } from '../../../../source/shared/dappCalls.ts';
import type { NativeConnectionHost } from './host.ts';
import type { NativePreparedConnectionTransaction } from './transactionRuntime.ts';

type Phase =
  | 'preparing'
  | 'review'
  | 'submitting'
  | 'failed'
  | 'unknown'
  | 'complete';
export type NativeEoaCallsSnapshot = Readonly<{
  revision: number;
  phase: Phase;
  index: number;
  total: number;
  prepared: NativePreparedConnectionTransaction | null;
  progress: readonly EoaCallsProgress[];
  hashes: readonly string[];
}>;

/** Per-call consent around the shared sequence. Signed bytes remain in the SDK journal. */
export function createNativeEoaCalls(
  input: Readonly<{
    calls: DappCallsRequest;
    origin: string;
    bundleId: string;
    reservationId: string;
    expiresAt: number;
    registry: NativeConnectionHost['calls'];
    assertCurrent(): void;
    onBroadcast(hash: string): void;
    prepare(transaction: unknown): Promise<NativePreparedConnectionTransaction>;
    persistStopped(submissionId: string, value: EoaCallsStopped): Promise<void>;
  }>
) {
  const sequence = createEoaCallsSequence(input.calls);
  const listeners = new Set<() => void>();
  let disposed = false;
  let running = false;
  let previousSubmissionId: string | undefined;
  let decision:
    | ReturnType<
        typeof Promise.withResolvers<NativePreparedConnectionTransaction>
      >
    | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let reviewRequest: Readonly<Record<string, unknown>> | undefined;
  let state: NativeEoaCallsSnapshot = Object.freeze({
    revision: 0,
    phase: 'preparing',
    index: 0,
    total: input.calls.calls.length,
    prepared: null,
    progress: Object.freeze([]),
    hashes: Object.freeze([]),
  });
  const descriptor = {
    atomic: false,
    smartAccount: false,
    chainId: Number(BigInt(input.calls.chainId!)),
  };
  const write = (
    fields: Parameters<typeof input.registry.recordSendCallsBundle>[2]
  ) =>
    input.registry.recordSendCallsBundle(input.origin, input.bundleId, fields);
  const check = () => {
    if (disposed || Date.now() >= input.expiresAt) throw new Error('CANCELLED');
    assertSynchronousEvmFeeGuard(input.assertCurrent);
  };
  const publish = (next: Partial<NativeEoaCallsSnapshot>) => {
    if (disposed) return;
    state = Object.freeze({ ...state, ...next, revision: state.revision + 1 });
    for (const listener of listeners) listener();
  };
  const ready = () =>
    new Promise<void>((resolve) => {
      const onChange = () => {
        if (
          disposed ||
          !running ||
          ['review', 'failed', 'unknown', 'complete'].includes(state.phase)
        ) {
          listeners.delete(onChange);
          resolve();
        }
      };
      listeners.add(onChange);
    });
  const update = (progress: EoaCallsProgress) => {
    const rows = [...state.progress];
    rows[progress.index] = Object.freeze({ ...progress });
    const hashes =
      progress.status === 'success' && progress.hash
        ? [...new Set([...state.hashes, progress.hash])]
        : state.hashes;
    publish({
      index: progress.index,
      progress: Object.freeze(rows),
      hashes: Object.freeze(hashes),
    });
  };
  async function start() {
    check();
    if (running || state.phase === 'unknown' || state.phase === 'complete')
      throw new Error('REVIEW_REQUIRED');
    running = true;
    publish({ phase: 'preparing', prepared: null });
    const waiting = ready();
    let initial: NativePreparedConnectionTransaction | undefined;
    let initialRequest: Readonly<Record<string, unknown>> | undefined;
    const firstIndex = state.progress.findIndex(
      (item) => item?.status !== 'success'
    );
    const index = firstIndex < 0 ? state.hashes.length : firstIndex;
    const task = async () => {
      await sequence.retryCompletion();
      check();
      return sequence.run({
        assertCurrent: check,
        async nonce() {
          const first = input.calls.calls[index];
          if (!first) throw new Error('No remaining call');
          initialRequest = Object.freeze({
            ...first,
            from: input.calls.from,
            chainId: input.calls.chainId,
          });
          initial = await input.prepare(initialRequest);
          check();
          return Number(BigInt(initial.transaction.nonce));
        },
        resolveAddress: async () => undefined,
        async prepare(transaction, callIndex) {
          check();
          publish({ phase: 'preparing', index: callIndex, prepared: null });
          reviewRequest = Object.freeze({
            ...(initial && callIndex === index ? initialRequest : transaction),
          });
          const prepared =
            initial && callIndex === index
              ? initial
              : await input.prepare(transaction);
          initial = undefined;
          check();
          const remaining = Math.min(
            input.expiresAt - Date.now(),
            prepared.expiresAtMonotonicMilliseconds - performance.now()
          );
          if (remaining <= 0) throw new Error('REVIEW_EXPIRED');
          const consent =
            Promise.withResolvers<NativePreparedConnectionTransaction>();
          decision = consent;
          expiry = setTimeout(
            () => consent.reject(new Error('REVIEW_EXPIRED')),
            remaining
          );
          publish({ phase: 'review', index: callIndex, prepared });
          try {
            return await consent.promise;
          } finally {
            clearTimeout(expiry);
            if (decision === consent) decision = undefined;
          }
        },
        async begin() {
          check();
          const submissionId = input.registry.generateWalletBundleId();
          await write({
            ...descriptor,
            reservationId: input.reservationId,
            previousSubmissionId,
            submissionId,
            submissionStarted: true,
            txHashes: [],
          });
          previousSubmissionId = submissionId;
          return submissionId;
        },
        async send(review, submissionId) {
          let dispatchHash: string | undefined;
          try {
            return await review.submit(check, (hash) => {
              dispatchHash = hash;
              input.onBroadcast(hash);
              publish({ phase: 'submitting' });
            }, { kind: 'eoa-calls', attempt: {
              origin: input.origin, bundleId: input.bundleId, reservationId: input.reservationId,
              submissionId, failed: state.index !== input.calls.calls.length - 1,
            } });
          } catch (cause) {
            if (dispatchHash) {
              await write({
                ...descriptor,
                reservationId: input.reservationId,
                submissionId,
                txHashes: [dispatchHash],
              });
            }
            throw Object.assign(new Error('CALL_SUBMISSION_FAILED'), {
              cause,
              transactionNotBroadcast: dispatchHash === undefined,
              ...(dispatchHash ? { signedTransactionHash: dispatchHash } : {}),
            });
          }
        },
        async persistHash(hash) {
          await write({
            ...descriptor,
            reservationId: input.reservationId,
            submissionId: previousSubmissionId,
            txHashes: [hash],
          });
        },
        persistStopped: (value) =>
          input.persistStopped(previousSubmissionId!, value),
        async persistCompletion(value) {
          await write({
            ...descriptor,
            reservationId: input.reservationId,
            submissionId: previousSubmissionId,
            submissionCompleted: true,
            txHashes: [...value.hashes],
            failed: value.failed,
          });
        },
        async recordNotBroadcast() {
          await write({
            ...descriptor,
            reservationId: input.reservationId,
            submissionId: previousSubmissionId,
            submissionNotBroadcast: true,
            txHashes: [],
          });
          return true;
        },
        update,
      });
    };
    void task()
      .then(async (outcome) => {
        if (outcome.status === 'retired' && outcome.hashes.length) {
          await write({
            ...descriptor,
            reservationId: input.reservationId,
            submissionId: previousSubmissionId,
            submissionCompleted: true,
            txHashes: [...outcome.hashes],
            failed: true,
          });
        }
        running = false;
        publish({
          phase:
            outcome.status === 'unknown'
              ? 'unknown'
              : outcome.failed
              ? 'failed'
              : 'complete',
        });
      })
      .catch(() => {
        running = false;
        publish({ phase: 'failed' });
      });
    return waiting;
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    async requote(revision: number, fields: EvmDappFeeChoiceFields) {
      check();
      const consent = decision;
      if (
        state.phase !== 'review' ||
        state.revision !== revision ||
        !state.prepared ||
        !consent ||
        !reviewRequest ||
        state.prepared.expiresAtMonotonicMilliseconds <= performance.now()
      )
        throw new Error('REVIEW_REQUIRED');
      const previous = state.prepared;
      const transaction: Record<string, unknown> = {
        ...reviewRequest,
        ...fields,
      };
      delete transaction.gas;
      publish({ phase: 'preparing', prepared: null });
      try {
        const prepared = await input.prepare(transaction);
        check();
        if (
          decision !== consent ||
          prepared.transaction.nonce !== previous.transaction.nonce
        )
          throw new Error('REVIEW_REQUIRED');
        const remaining = Math.min(
          input.expiresAt - Date.now(),
          prepared.expiresAtMonotonicMilliseconds - performance.now()
        );
        if (remaining <= 0) throw new Error('REVIEW_EXPIRED');
        clearTimeout(expiry);
        expiry = setTimeout(
          () => consent.reject(new Error('REVIEW_EXPIRED')),
          remaining
        );
        publish({ phase: 'review', prepared });
      } catch (error) {
        consent.reject(error);
        throw error;
      }
    },
    async approve(revision: number) {
      check();
      if (
        state.phase !== 'review' ||
        state.revision !== revision ||
        !state.prepared ||
        !decision ||
        state.prepared.expiresAtMonotonicMilliseconds <= performance.now()
      )
        throw new Error('REVIEW_REQUIRED');
      const waiting = ready();
      const prepared = state.prepared;
      clearTimeout(expiry);
      publish({ phase: 'submitting' });
      decision.resolve(prepared);
      await waiting;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(expiry);
      decision?.reject(new Error('CANCELLED'));
      for (const listener of listeners) listener();
      listeners.clear();
    },
  });
}
export type NativeEoaCalls = ReturnType<typeof createNativeEoaCalls>;
