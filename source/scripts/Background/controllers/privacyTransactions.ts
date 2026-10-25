import { Interface, parseEther } from 'ethers';

import { getPrivacyPool } from 'utils/privacy/registry';
import type {
  IPrivacyDepositAttempt,
  IPrivacyDepositCall,
  IPrivacyDepositFees,
  IPrivacyDepositReview,
  IPrivacyDepositSession,
  IPrivacyDepositSubmission,
  IPrivacyTransactionsController,
  IPrivacyTransactionsHost,
} from 'utils/privacy/transactionTypes';

const ABI = new Interface(['function deposit(bytes32 commitment) payable']);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_NONCE = (BigInt(1) << BigInt(64)) - BigInt(1);
export const PRIVACY_DEPOSIT_INTENT_TTL_MS = 60000;
export const PRIVACY_DEPOSIT_MAX_INTENTS = 64;

interface IIntent {
  attempt?: IPrivacyDepositAttempt;
  createdAt: number;
  expiresAt: number;
  session: IPrivacyDepositSession;
}

function failure(code: string) {
  return Object.assign(new Error(code), { transactionNotBroadcast: true });
}
function quantity(value: unknown, positive = false, max = MAX_UINT256): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-f][0-9a-f]*))$/.test(value)
  ) {
    throw failure('privacy_deposit_fee_invalid');
  }
  const n = BigInt(value);
  if (n > max || (positive && n === BigInt(0)))
    throw failure('privacy_deposit_fee_invalid');
  return n;
}
const hex = (n: bigint) => `0x${n.toString(16)}`;
function projectFees(value: IPrivacyDepositFees) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'gasLimit',
          'nonce',
          'gasPrice',
          'maxFeePerGas',
          'maxPriorityFeePerGas',
        ].includes(key)
    )
  ) {
    throw failure('privacy_deposit_fee_invalid');
  }
  const gasLimit = quantity(value.gasLimit, true);
  const nonce = quantity(value.nonce, false, MAX_NONCE);
  if (value.gasPrice !== undefined) {
    if (
      value.maxFeePerGas !== undefined ||
      value.maxPriorityFeePerGas !== undefined
    )
      throw failure('privacy_deposit_fee_invalid');
    const gasPrice = quantity(value.gasPrice, true);
    return {
      transaction: {
        gasLimit: hex(gasLimit),
        nonce: hex(nonce),
        gasPrice: hex(gasPrice),
      },
      review: {
        feeMode: 'legacy' as const,
        gasLimit: String(gasLimit),
        nonce: String(nonce),
        gasPrice: String(gasPrice),
      },
      maximum: gasLimit * gasPrice,
    };
  }
  const maximum = quantity(value.maxFeePerGas, true);
  const priority = quantity(value.maxPriorityFeePerGas);
  if (priority > maximum) throw failure('privacy_deposit_fee_invalid');
  return {
    transaction: {
      gasLimit: hex(gasLimit),
      nonce: hex(nonce),
      maxFeePerGas: hex(maximum),
      maxPriorityFeePerGas: hex(priority),
    },
    review: {
      feeMode: 'eip1559' as const,
      gasLimit: String(gasLimit),
      nonce: String(nonce),
      maxFeePerGas: String(maximum),
      maxPriorityFeePerGas: String(priority),
    },
    maximum: gasLimit * maximum,
  };
}

/** Local intent state never substitutes for the host's durable per-note reservation. */
export function createPrivacyTransactionsController(
  host: IPrivacyTransactionsHost,
  {
    now = Date.now,
    randomId = () => crypto.randomUUID(),
  }: { now?: () => number; randomId?: () => string } = {}
): IPrivacyTransactionsController {
  const intents = new Map<string, IIntent>();
  const submittingNotes = new Set<string>();
  let closed = false;
  const assertCurrent = (session: IPrivacyDepositSession) => {
    if (closed) throw failure('privacy_deposit_closed');
    try {
      session.assertCurrent();
    } catch {
      throw failure('privacy_deposit_context_changed');
    }
  };
  const prune = () => {
    for (const [id, intent] of intents)
      if (intent.attempt && now() >= intent.expiresAt) intents.delete(id);
  };
  const capture = (): IPrivacyDepositSession => {
    let source: IPrivacyDepositSession;
    try {
      source = host.captureContext();
    } catch {
      throw failure('privacy_deposit_context_changed');
    }
    assertCurrent(source);
    const context = source.context;
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
      typeof context.account.address !== 'string' ||
      !ADDRESS.test(context.account.address) ||
      typeof context.rpcUrl !== 'string' ||
      !context.rpcUrl ||
      context.rpcUrl.length > 2048
    )
      throw failure('privacy_deposit_context_invalid');
    return Object.freeze({
      assertCurrent: source.assertCurrent,
      context: Object.freeze({
        chainId: context.chainId,
        rpcUrl: context.rpcUrl,
        slip44: context.slip44,
        sessionGeneration: context.sessionGeneration,
        account: Object.freeze({
          id: context.account.id,
          type: context.account.type,
          address: context.account.address,
        }),
      }),
    });
  };

  return {
    close: () => {
      closed = true;
      intents.clear();
    },
    discardDeposit: async (id) => {
      intents.delete(id);
    },
    prepareDeposit: async (request) => {
      prune();
      if (
        !request ||
        typeof request !== 'object' ||
        Array.isArray(request) ||
        Object.keys(request).some(
          (key) => !['poolId', 'noteId'].includes(key)
        ) ||
        (request.noteId !== undefined &&
          (typeof request.noteId !== 'string' || !UUID.test(request.noteId)))
      )
        throw failure('privacy_deposit_request_invalid');
      let pool;
      try {
        pool = getPrivacyPool(request.poolId);
      } catch {
        throw failure('privacy_deposit_pool_invalid');
      }
      if (intents.size >= PRIVACY_DEPOSIT_MAX_INTENTS)
        throw failure('privacy_deposit_intent_limit');
      const session = capture();
      const createdAt = now();
      if (
        !Number.isSafeInteger(createdAt) ||
        createdAt < 0 ||
        !Number.isSafeInteger(createdAt + PRIVACY_DEPOSIT_INTENT_TTL_MS)
      )
        throw failure('privacy_deposit_clock_invalid');
      const id = randomId();
      if (typeof id !== 'string' || !UUID.test(id) || intents.has(id))
        throw failure('privacy_deposit_intent_invalid');
      const intent: IIntent = {
        session,
        createdAt,
        expiresAt: createdAt + PRIVACY_DEPOSIT_INTENT_TTL_MS,
      };
      intents.set(id, intent); // Reserve capacity before any asynchronous host work.
      try {
        const note = await host.prepareNote(pool.id, request.noteId, session);
        assertCurrent(session);
        if (
          !note ||
          typeof note.id !== 'string' ||
          !UUID.test(note.id) ||
          note.poolId !== pool.id ||
          (request.noteId !== undefined && note.id !== request.noteId)
        )
          throw failure('privacy_deposit_note_invalid');
        if (submittingNotes.has(note.id))
          throw failure('privacy_deposit_note_busy');
        const value = parseEther(pool.amount);
        let call: Readonly<IPrivacyDepositCall> | undefined;
        await host.withCommitment(note.id, session, (commitment) => {
          if (call || typeof commitment !== 'string' || !HASH.test(commitment))
            throw failure('privacy_deposit_note_invalid');
          call = Object.freeze({
            chainId: 1,
            from: session.context.account.address,
            to: pool.address,
            value: hex(value),
            data: ABI.encodeFunctionData('deposit', [commitment]),
          });
        });
        assertCurrent(session);
        if (!call) throw failure('privacy_deposit_note_invalid');
        const fees = projectFees(await host.prepareFees(call, session));
        assertCurrent(session);
        if (now() >= intent.expiresAt || intents.get(id) !== intent)
          throw failure('privacy_deposit_intent_expired');
        const transaction = Object.freeze({ ...call, ...fees.transaction });
        intent.attempt = Object.freeze({
          intentId: id,
          noteId: note.id,
          poolId: pool.id,
          createdAt,
          expiresAt: intent.expiresAt,
          context: session.context,
          transaction,
        });
        const review: IPrivacyDepositReview = {
          intentId: id,
          noteId: note.id,
          poolId: pool.id,
          amount: pool.amount,
          poolAddress: pool.address,
          account: { ...session.context.account },
          chainId: 1,
          createdAt,
          expiresAt: intent.expiresAt,
          valueWei: String(value),
          ...fees.review,
          maxNetworkFeeWei: String(fees.maximum),
          maxTotalWei: String(value + fees.maximum),
        };
        return review;
      } catch (error) {
        intents.delete(id);
        if (
          error instanceof Error &&
          [
            'privacy_deposit_context_changed',
            'privacy_deposit_closed',
            'privacy_deposit_note_invalid',
            'privacy_deposit_note_busy',
            'privacy_deposit_fee_invalid',
            'privacy_deposit_intent_expired',
          ].includes(error.message)
        )
          throw failure(error.message);
        throw failure('privacy_deposit_prepare_failed');
      }
    },
    submitDeposit: async (id) => {
      const intent = intents.get(id);
      if (!intent?.attempt || now() >= intent.expiresAt) {
        intents.delete(id);
        throw failure('privacy_deposit_intent_expired');
      }
      assertCurrent(intent.session);
      const attempt = intent.attempt;
      if (submittingNotes.has(attempt.noteId))
        throw failure('privacy_deposit_note_busy');
      submittingNotes.add(attempt.noteId);
      for (const [key, other] of intents)
        if (key === id || other.attempt?.noteId === attempt.noteId)
          intents.delete(key);
      let senderEntered = false;
      let reservationAcknowledged = false;
      let acknowledged: string | undefined;
      let saved = false;
      let acknowledgementConflict = false;
      let acknowledgement: Promise<void> | undefined;
      const onBroadcast = (response: { hash: string }): Promise<void> => {
        if (
          !response ||
          typeof response.hash !== 'string' ||
          !HASH.test(response.hash)
        )
          return Promise.reject(new Error('privacy_deposit_ack_invalid'));
        const hash = response.hash.toLowerCase();
        if (acknowledged && hash !== acknowledged) {
          acknowledgementConflict = true;
          return Promise.reject(new Error('privacy_deposit_ack_conflict'));
        }
        acknowledged = hash;
        if (!acknowledgement)
          acknowledgement = host.recordBroadcast(attempt, hash).then(() => {
            saved = true;
          });
        return acknowledgement;
      };
      try {
        await host.beforeSubmission(attempt);
        reservationAcknowledged = true;
        assertCurrent(intent.session);
        senderEntered = true;
        const response = await host.sendTransaction(
          attempt.transaction,
          intent.session,
          onBroadcast
        );
        await onBroadcast(response);
        return {
          intentId: id,
          noteId: attempt.noteId,
          phase: 'submitted',
          transactionHash: acknowledged,
        };
      } catch (error) {
        const e = error as {
          transactionHash?: unknown;
          transactionNotBroadcast?: unknown;
        };
        if (
          !acknowledged &&
          typeof e?.transactionHash === 'string' &&
          HASH.test(e.transactionHash)
        ) {
          try {
            await onBroadcast({ hash: e.transactionHash });
          } catch {
            /* Keep the durable unknown marker. */
          }
        }
        if (saved && !acknowledgementConflict)
          return {
            intentId: id,
            noteId: attempt.noteId,
            phase: 'submitted',
            transactionHash: acknowledged,
          };
        if (
          !senderEntered ||
          (e?.transactionNotBroadcast === true && !acknowledged)
        ) {
          try {
            if (reservationAcknowledged)
              await host.recordNotBroadcast?.(attempt);
          } catch {
            /* Never reinterpret a persistence error as a broadcast. */
          }
          throw failure(
            senderEntered
              ? 'privacy_deposit_not_broadcast'
              : 'privacy_deposit_submission_blocked'
          );
        }
        const result: IPrivacyDepositSubmission = {
          intentId: id,
          noteId: attempt.noteId,
          phase: 'unknown',
        };
        if (acknowledged) result.transactionHash = acknowledged;
        return result;
      } finally {
        submittingNotes.delete(attempt.noteId);
      }
    },
  };
}
