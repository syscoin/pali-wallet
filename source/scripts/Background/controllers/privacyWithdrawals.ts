import { getAddress, Interface, parseEther } from 'ethers';

import { identifyClassicNote } from 'utils/privacy/note';
import { getPrivacyPool } from 'utils/privacy/registry';
import {
  quotePrivacyRelayerFee,
  validatePrivacyRelayerEndpoint,
} from 'utils/privacy/relayers';
import type {
  IPrivacyRelayerDirectory,
  IPrivacyRelayerSelection,
} from 'utils/privacy/relayers';
import { readPrivacyRelayerJob } from 'utils/privacy/relayJobs';
import type { IPrivacyDepositFees } from 'utils/privacy/transactionTypes';
import type { IPrivacySnapshotAccess } from 'utils/privacy/trustedSnapshot';
import type {
  IPrivacyWithdrawalAttempt,
  IPrivacyWithdrawalSession,
  IPrivacyWithdrawalAcknowledgement,
} from 'utils/privacy/withdrawalTransactionTypes';
import type {
  IPrivacyWithdrawalsHost,
  IPrivacyWithdrawalsController,
  IPrivacyWithdrawalReview,
  IPrivacyWithdrawalSubmission,
  IPrivacyWithdrawalStatus,
} from 'utils/privacy/withdrawTypes';

export const PRIVACY_WITHDRAWAL_GAS = '650000';
export const PRIVACY_WITHDRAWAL_INTENT_TTL_MS = 60000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORD = /^0x[0-9a-f]{64}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const PROOF = /^0x[0-9a-fA-F]{512}$/;
const MAX_UINT = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_NONCE = (BigInt(1) << BigInt(64)) - BigInt(1);
const PUBLIC_ERRORS = new Set([
  'privacy_note_invalid',
  'privacy_note_not_found',
  'privacy_note_spent',
  'privacy_verification_pending',
  'privacy_vault_session_changed',
  'privacy_vault_unavailable',
  'privacy_proof_cancelled',
  'privacy_proof_failed',
  'privacy_proof_busy',
  'privacy_proof_unavailable',
  'privacy_proof_artifact_invalid',
  'privacy_proof_verification_failed',
  'privacy_proof_invalid_input',
  'privacy_relayer_data_invalid',
  'privacy_relayer_stale',
  'privacy_relayer_changed',
  'privacy_relayer_unavailable',
  'privacy_relayer_cancelled',
  'privacy_relayer_timeout',
  'privacy_relayer_directory_pending',
  'privacy_relayer_fee_too_high',
  'privacy_relayer_job_invalid',
  'privacy_relayer_job_unavailable',
  'privacy_withdrawal_cancelled',
  'privacy_withdrawal_context_changed',
  'privacy_withdrawal_note_invalid',
  'privacy_withdrawal_note_busy',
  'privacy_withdrawal_fee_invalid',
  'privacy_withdrawal_clock_invalid',
  'privacy_withdrawal_intent_expired',
  'privacy_withdrawal_snapshot_invalid',
  'privacy_withdrawal_invalid',
  'privacy_withdrawal_attempt_exists',
  'privacy_withdrawal_attempt_invalid',
  'privacy_withdrawal_quote_changed',
  'privacy_withdrawal_insufficient_funds',
]);
const ABI = new Interface([
  'function withdraw(bytes proof,bytes32 root,bytes32 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund) payable',
]);
interface IIntent {
  abort: AbortController;
  attempt?: IPrivacyWithdrawalAttempt;
  expiresAt?: number;
  lease?: IPrivacySnapshotAccess;
  selection?: Readonly<IPrivacyRelayerSelection>;
  session: IPrivacyWithdrawalSession;
  timer?: ReturnType<typeof setTimeout>;
}
const fail = (code: string) =>
  Object.assign(new Error(code), { transactionNotBroadcast: true });
const hex = (value: bigint) => `0x${value.toString(16)}`;
function quantity(value: unknown, positive = false, maximum = MAX_UINT) {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-f][0-9a-f]*))$/.test(value)
  )
    throw fail('privacy_withdrawal_fee_invalid');
  const amount = BigInt(value);
  if (amount > maximum || (positive && !amount))
    throw fail('privacy_withdrawal_fee_invalid');
  return amount;
}
function fees(value: IPrivacyDepositFees) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some(
      (key) =>
        ![
          'gasLimit',
          'nonce',
          'gasPrice',
          'maxFeePerGas',
          'maxPriorityFeePerGas',
        ].includes(key)
    ) ||
    quantity(value.gasLimit) !== BigInt(PRIVACY_WITHDRAWAL_GAS)
  )
    throw fail('privacy_withdrawal_fee_invalid');
  const gas = BigInt(PRIVACY_WITHDRAWAL_GAS),
    nonce = quantity(value.nonce, false, MAX_NONCE);
  if (value.gasPrice !== undefined) {
    if (
      value.maxFeePerGas !== undefined ||
      value.maxPriorityFeePerGas !== undefined
    )
      throw fail('privacy_withdrawal_fee_invalid');
    const price = quantity(value.gasPrice, true);
    return {
      fields: { gasLimit: hex(gas), nonce: hex(nonce), gasPrice: hex(price) },
      maximum: gas * price,
    };
  }
  const maximum = quantity(value.maxFeePerGas, true),
    priority = quantity(value.maxPriorityFeePerGas);
  if (priority > maximum) throw fail('privacy_withdrawal_fee_invalid');
  return {
    fields: {
      gasLimit: hex(gas),
      nonce: hex(nonce),
      maxFeePerGas: hex(maximum),
      maxPriorityFeePerGas: hex(priority),
    },
    maximum: gas * maximum,
  };
}
function capture(host: IPrivacyWithdrawalsHost): IPrivacyWithdrawalSession {
  const session = host.captureSession(),
    context = session.context;
  session.assertCurrent();
  if (
    !context ||
    context.chainId !== 1 ||
    !Number.isSafeInteger(context.slip44) ||
    context.slip44 < 0 ||
    !Number.isSafeInteger(context.sessionGeneration) ||
    context.sessionGeneration! < 0 ||
    !context.account ||
    !Number.isSafeInteger(context.account.id) ||
    context.account.id < 0 ||
    typeof context.account.type !== 'string' ||
    typeof context.rpcUrl !== 'string' ||
    !context.rpcUrl ||
    context.rpcUrl.length > 2048
  )
    throw fail('privacy_withdrawal_context_changed');
  let address: string;
  try {
    address = getAddress(context.account.address);
  } catch {
    throw fail('privacy_withdrawal_context_changed');
  }
  return Object.freeze({
    assertCurrent: session.assertCurrent,
    context: Object.freeze({
      chainId: context.chainId,
      rpcUrl: context.rpcUrl,
      slip44: context.slip44,
      sessionGeneration: context.sessionGeneration,
      account: Object.freeze({
        id: context.account.id,
        type: context.account.type,
        address,
      }),
    }),
  });
}

/** Background intent owner. A returned review never contains a note, proof or nullifier. */
export function createPrivacyWithdrawalsController(
  host: IPrivacyWithdrawalsHost,
  options: {
    fetcher?: typeof fetch;
    now?: () => number;
    randomId?: () => string;
  } = {}
): IPrivacyWithdrawalsController {
  const now = options.now || Date.now,
    randomId = options.randomId || (() => crypto.randomUUID());
  const intents = new Map<string, IIntent>(),
    submitting = new Set<string>();
  let closed = false,
    preparing: IIntent | undefined;
  const remove = (id: string) => {
    const value = intents.get(id);
    if (value?.timer) clearTimeout(value.timer);
    intents.delete(id);
  };
  const current = (intent: IIntent) => {
    if (closed || intent.abort.signal.aborted)
      throw fail('privacy_withdrawal_cancelled');
    try {
      if (intent.session.assertCurrent() !== undefined) throw new Error();
    } catch {
      throw fail('privacy_withdrawal_context_changed');
    }
    if (intent.lease) {
      const result: unknown = intent.lease.assertSnapshotCurrent(
        intent.lease.snapshot
      );
      if (result !== undefined) {
        if (result instanceof Promise) void result.catch(() => undefined);
        throw fail('privacy_verification_pending');
      }
    }
    if (intent.selection) {
      const result: unknown = host.relayers.assertSelectionCurrent(
        intent.selection
      );
      if (result !== undefined) {
        if (result instanceof Promise) void result.catch(() => undefined);
        throw fail('privacy_relayer_stale');
      }
    }
  };
  const sanitize = (error: unknown) =>
    fail(
      error instanceof Error && PUBLIC_ERRORS.has(error.message)
        ? error.message
        : 'privacy_withdrawal_failed'
    );
  let directory: Readonly<IPrivacyRelayerDirectory> | undefined;
  const cancelPreparation = () => {
    preparing?.abort.abort();
  };
  const relay = async (
    attempt: Extract<IPrivacyWithdrawalAttempt, { mode: 'relayed' }>
  ) => {
    // Exact Classic relayer POST schema from tornadocash/tornado-relayer
    // @2247730603f2c249f90da0b07058325619435387, src/modules/validator.js.
    // No retry: once fetch is entered, failure cannot prove non-submission.
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error('privacy_withdrawal_submission_unknown'));
      }, 15000);
    });
    const run = async () => {
      const response = await (options.fetcher || fetch)(
        `${validatePrivacyRelayerEndpoint(
          attempt.endpoint
        )}/v1/tornadoWithdraw`,
        {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: abort.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proof: attempt.proof,
            contract: getPrivacyPool(attempt.poolId).address,
            args: [
              attempt.root,
              attempt.nullifierHash,
              attempt.recipient,
              attempt.relayer,
              `0x${BigInt(attempt.fee).toString(16).padStart(64, '0')}`,
              `0x${'0'.repeat(64)}`,
            ],
          }),
        }
      );
      if (
        !response.ok ||
        response.status !== 200 ||
        response.redirected ||
        !response.body ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get('content-type') || ''
        )
      )
        throw new Error('privacy_withdrawal_submission_unknown');
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 4096))
        throw new Error('privacy_withdrawal_submission_unknown');
      const reader = response.body.getReader(),
        decoder = new TextDecoder('utf-8', { fatal: true });
      let size = 0,
        text = '';
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 4096) throw new Error();
          text += decoder.decode(next.value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const value = JSON.parse(text + decoder.decode());
      if (
        !value ||
        typeof value.id !== 'string' ||
        !UUID.test(value.id) ||
        Object.keys(value).some((key) => key !== 'id')
      )
        throw new Error('privacy_withdrawal_submission_unknown');
      return { jobId: value.id };
    };
    try {
      return await Promise.race([run(), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  };
  return {
    cancelPreparation,
    close: () => {
      closed = true;
      cancelPreparation();
      for (const id of intents.keys()) remove(id);
    },
    discardWithdrawal: async (id) => {
      intents.get(id)?.abort.abort();
      remove(id);
    },
    getRelayers: async () => {
      if (closed) throw fail('privacy_withdrawal_cancelled');
      const next = await host.relayers.getDirectory();
      if (closed) throw fail('privacy_withdrawal_cancelled');
      directory = next;
      return next.relayers.map((entry) =>
        Object.freeze({
          id: entry.ensHash,
          name: entry.ensName,
          health: entry.health,
          feePercent: entry.advertisedServiceFeePercent,
          supportedPools: entry.supportedPools || [],
        })
      );
    },
    statusByNote: async (noteId) => {
      try {
        if (typeof noteId !== 'string' || !UUID.test(noteId))
          throw fail('privacy_withdrawal_request_invalid');
        const session = capture(host);
        const assertCurrent = () => {
          if (closed) throw fail('privacy_withdrawal_cancelled');
          const value: unknown = session.assertCurrent();
          if (value !== undefined) {
            if (value instanceof Promise) void value.catch(() => undefined);
            throw fail('privacy_withdrawal_context_changed');
          }
        };
        assertCurrent();
        const stored = await host.getWithdrawalAttempt(noteId, session);
        assertCurrent();
        if (!stored) return { noteId, phase: 'none' };
        const record = Object.freeze({ ...stored });
        if (
          record.noteId !== noteId ||
          !['direct', 'relayed'].includes(record.mode) ||
          !['unknown', 'submitted'].includes(record.phase) ||
          !WORD.test(record.attemptHash) ||
          (record.jobId !== undefined && !UUID.test(record.jobId)) ||
          (record.transactionHash !== undefined &&
            !HASH.test(record.transactionHash))
        )
          throw fail('privacy_relayer_job_invalid');
        const result: IPrivacyWithdrawalStatus = {
          noteId,
          mode: record.mode,
          phase: record.phase,
          ...(record.jobId ? { jobId: record.jobId } : {}),
          ...(record.transactionHash
            ? { transactionHash: record.transactionHash }
            : {}),
        };
        if (record.mode === 'direct' || !record.jobId) return result;
        if (!record.endpoint || !record.ensHash || !WORD.test(record.ensHash))
          throw fail('privacy_relayer_job_invalid');
        const observation = await readPrivacyRelayerJob(
          {
            endpoint: record.endpoint,
            jobId: record.jobId,
            poolId: record.poolId,
            inputHash: record.inputHash,
            proofHash: record.proofHash,
          },
          { assertCurrent, fetcher: options.fetcher }
        );
        assertCurrent();
        if (
          record.transactionHash &&
          observation.transactionHash &&
          record.transactionHash.toLowerCase() !== observation.transactionHash
        )
          throw fail('privacy_relayer_job_invalid');
        if (observation.transactionHash && !record.transactionHash) {
          await host.recordJobStatus(
            noteId,
            record.attemptHash,
            {
              jobId: record.jobId,
              transactionHash: observation.transactionHash,
            },
            session
          );
          assertCurrent();
        }
        return { ...result, ...observation };
      } catch (error) {
        throw sanitize(error);
      }
    },
    prepareWithdrawal: async (request) => {
      if (preparing) throw fail('privacy_proof_busy');
      if (
        !request ||
        typeof request !== 'object' ||
        Array.isArray(request) ||
        Object.keys(request).some(
          (key) => !['noteId', 'recipient', 'mode', 'relayerId'].includes(key)
        ) ||
        typeof request.noteId !== 'string' ||
        !UUID.test(request.noteId) ||
        !['direct', 'relayed'].includes(request.mode) ||
        (request.mode === 'direct' && request.relayerId !== undefined) ||
        (request.mode === 'relayed' &&
          (typeof request.relayerId !== 'string' ||
            !WORD.test(request.relayerId)))
      )
        throw fail('privacy_withdrawal_request_invalid');
      request = Object.freeze({ ...request });
      let recipient: string;
      try {
        recipient = getAddress(request.recipient);
        if (BigInt(recipient) === BigInt(0)) throw new Error();
      } catch {
        throw fail('privacy_withdrawal_request_invalid');
      }
      let session: IPrivacyWithdrawalSession;
      try {
        session = capture(host);
      } catch {
        throw fail('privacy_withdrawal_context_changed');
      }
      const intent: IIntent = { session, abort: new AbortController() };
      const id = randomId();
      if (!UUID.test(id) || intents.has(id) || intents.size >= 8)
        throw fail('privacy_withdrawal_intent_invalid');
      intents.set(id, intent);
      preparing = intent;
      try {
        current(intent);
        let used = false;
        const review = await host.withNote(
          request.noteId,
          intent.session,
          async (note, poolId) => {
            if (used) throw fail('privacy_withdrawal_note_invalid');
            used = true;
            current(intent);
            const identity = identifyClassicNote(note),
              pool = getPrivacyPool(poolId);
            if (identity.poolId !== poolId || submitting.has(request.noteId))
              throw fail('privacy_withdrawal_note_busy');
            const access = await host.getSnapshot(poolId);
            intent.lease = Object.freeze({
              snapshot: access.snapshot,
              assertSnapshotCurrent: access.assertSnapshotCurrent,
            });
            current(intent);
            let fee = '0',
              relayer = `0x${'0'.repeat(40)}`,
              maximum = BigInt(0),
              service = '0';
            let directFees: ReturnType<typeof fees> | undefined;
            if (request.mode === 'direct') {
              directFees = fees(await host.quoteDirectFees(intent.session));
              current(intent);
              maximum = directFees.maximum;
            } else {
              if (!directory) throw fail('privacy_relayer_directory_pending');
              intent.selection = await host.relayers.checkRelayer(
                directory,
                request.relayerId!,
                poolId,
                intent.abort.signal
              );
              current(intent);
              const price = await host.quoteRelayerGasPrice(intent.session);
              current(intent);
              const quote = quotePrivacyRelayerFee(
                poolId,
                intent.selection.advertisedServiceFeePercent,
                PRIVACY_WITHDRAWAL_GAS,
                quantity(price, true).toString()
              );
              fee = quote.feeWei;
              service = quote.serviceFeeWei;
              maximum = BigInt(quote.networkFeeWei);
              relayer = intent.selection.rewardAccount;
            }
            const prove =
              host.prove ||
              (
                await import(
                  /* webpackChunkName: "privacy-withdrawal" */ 'utils/privacy/withdrawal'
                )
              ).provePrivacyWithdrawal;
            current(intent);
            const proof = await prove(
              {
                note,
                snapshot: intent.lease.snapshot,
                recipient,
                relayer,
                fee,
                refund: '0',
              },
              {
                assertCurrent: () => current(intent),
                assertSnapshotCurrent: intent.lease.assertSnapshotCurrent,
                signal: intent.abort.signal,
                onProgress: host.onProgress,
              }
            );
            current(intent);
            const expected = [
              intent.lease.snapshot.root,
              identity.nullifierHash,
              recipient,
              relayer,
              fee,
              '0',
            ].map((value) => BigInt(value).toString());
            if (
              !proof ||
              !PROOF.test(proof.proof) ||
              !Array.isArray(proof.publicSignals) ||
              proof.publicSignals.length !== 6 ||
              proof.publicSignals.some((value, i) => value !== expected[i])
            )
              throw fail('privacy_proof_verification_failed');
            const createdAt = now(),
              expiresAt = createdAt + PRIVACY_WITHDRAWAL_INTENT_TTL_MS;
            if (
              !Number.isSafeInteger(createdAt) ||
              createdAt < 0 ||
              !Number.isSafeInteger(expiresAt)
            )
              throw fail('privacy_withdrawal_clock_invalid');
            const base = {
              intentId: id,
              noteId: request.noteId,
              poolId,
              createdAt,
              expiresAt,
              context: intent.session.context,
              recipient,
              fee,
              refund: '0' as const,
              relayer,
              root: intent.lease.snapshot.root,
              nullifierHash: identity.nullifierHash,
              proof: proof.proof,
            };
            intent.attempt =
              request.mode === 'direct'
                ? Object.freeze({
                    ...base,
                    mode: 'direct' as const,
                    transaction: Object.freeze({
                      chainId: 1 as const,
                      from: intent.session.context.account.address,
                      to: pool.address,
                      value: '0x0',
                      data: ABI.encodeFunctionData('withdraw', [
                        proof.proof,
                        base.root,
                        base.nullifierHash,
                        recipient,
                        relayer,
                        fee,
                        '0',
                      ]),
                      ...directFees!.fields,
                    }),
                  })
                : Object.freeze({
                    ...base,
                    mode: 'relayed' as const,
                    endpoint: intent.selection!.endpoint,
                    ensHash: intent.selection!.ensHash,
                    rewardAccount: relayer,
                  });
            intent.expiresAt = expiresAt;
            intent.timer = setTimeout(
              () => remove(id),
              PRIVACY_WITHDRAWAL_INTENT_TTL_MS
            );
            const result: IPrivacyWithdrawalReview = {
              intentId: id,
              noteId: request.noteId,
              poolId,
              amount: pool.amount,
              poolAddress: pool.address,
              mode: request.mode,
              recipient,
              account: { ...intent.session.context.account },
              chainId: 1,
              expiresAt,
              feeWei: fee,
              receiveWei: (parseEther(pool.amount) - BigInt(fee)).toString(),
              gasLimit: PRIVACY_WITHDRAWAL_GAS,
              maxNetworkFeeWei: maximum.toString(),
              serviceFeeWei: service,
            };
            if (intent.selection) {
              result.relayerEndpoint = intent.selection.endpoint;
              result.relayerId = intent.selection.ensHash;
              result.relayerName = intent.selection.directory.relayers.find(
                (entry) => entry.ensHash === intent.selection!.ensHash
              )!.ensName;
            }
            return result;
          }
        );
        current(intent);
        if (!intent.attempt || intents.get(id) !== intent)
          throw fail('privacy_withdrawal_cancelled');
        return review;
      } catch (error) {
        remove(id);
        throw sanitize(error);
      } finally {
        if (preparing === intent) preparing = undefined;
      }
    },
    submitWithdrawal: async (id) => {
      const intent = intents.get(id);
      if (!intent?.attempt || now() >= intent.expiresAt!) {
        remove(id);
        throw fail('privacy_withdrawal_intent_expired');
      }
      current(intent);
      const attempt = intent.attempt;
      if (submitting.has(attempt.noteId))
        throw fail('privacy_withdrawal_note_busy');
      submitting.add(attempt.noteId);
      for (const [key, entry] of intents)
        if (key === id || entry.attempt?.noteId === attempt.noteId) remove(key);
      let reserved = false,
        entered = false,
        saved = false,
        conflict = false,
        pending: Promise<void> | undefined,
        acknowledgement: IPrivacyWithdrawalAcknowledgement | undefined;
      const record = async (ack: IPrivacyWithdrawalAcknowledgement) => {
        if (
          (!ack.jobId && !ack.transactionHash) ||
          (ack.jobId && !UUID.test(ack.jobId)) ||
          (ack.transactionHash && !HASH.test(ack.transactionHash))
        )
          throw new Error('privacy_withdrawal_ack_invalid');
        if (
          acknowledgement &&
          (acknowledgement.jobId !== ack.jobId ||
            acknowledgement.transactionHash !== ack.transactionHash)
        ) {
          conflict = true;
          throw new Error('privacy_withdrawal_ack_conflict');
        }
        acknowledgement = { ...ack };
        if (!pending)
          pending = host.recordSubmission(attempt, acknowledgement).then(() => {
            saved = true;
          });
        await pending;
      };
      try {
        if (intent.selection) {
          await host.relayers.checkRelayer(
            intent.selection.directory,
            intent.selection.ensHash,
            attempt.poolId,
            intent.abort.signal
          );
          current(intent);
        }
        await host.beforeSubmission(attempt);
        reserved = true;
        current(intent);
        if (now() >= intent.expiresAt!)
          throw fail('privacy_withdrawal_intent_expired');
        entered = true;
        if (attempt.mode === 'direct') {
          const result = await host.sendTransaction(
            attempt.transaction,
            intent.session,
            (ack) => record({ transactionHash: ack.hash.toLowerCase() })
          );
          await record({ transactionHash: result.hash.toLowerCase() });
        } else await record(await relay(attempt));
        return {
          intentId: id,
          noteId: attempt.noteId,
          phase: 'submitted',
          ...acknowledgement,
        };
      } catch (error) {
        const knownHash = (error as { transactionHash?: unknown })
          ?.transactionHash;
        if (
          !acknowledgement &&
          typeof knownHash === 'string' &&
          HASH.test(knownHash)
        ) {
          try {
            await record({ transactionHash: knownHash.toLowerCase() });
          } catch {
            /* Preserve the durable unknown reservation if saving fails. */
          }
        }
        if (saved && !conflict)
          return {
            intentId: id,
            noteId: attempt.noteId,
            phase: 'submitted',
            ...acknowledgement,
          };
        if (
          !entered ||
          ((error as any)?.transactionNotBroadcast === true && !acknowledgement)
        ) {
          if (reserved)
            await host.recordNotBroadcast?.(attempt).catch(() => undefined);
          throw sanitize(error);
        }
        const result: IPrivacyWithdrawalSubmission = {
          intentId: id,
          noteId: attempt.noteId,
          phase: 'unknown',
          ...acknowledgement,
        };
        return result;
      } finally {
        submitting.delete(attempt.noteId);
      }
    },
  };
}
