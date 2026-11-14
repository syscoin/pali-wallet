import { AbiCoder } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';

import {
  decodeAssetTransfer,
  type AssetTransferCall,
} from '../shared/assetTransfer.ts';
import {
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  type SmartAccountExecution,
} from '../utils/smartAccount/account.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../utils/smartAccount/contracts.ts';

import {
  EvmSignedRecords,
  type EvmRetainedSignedRecord,
  type EvmRetainedSmartAccountRecord,
  type EvmSignedRecordSession,
} from './evmSignedRecords.ts';
import {
  EvmReplayError,
  EvmSignedReplay,
  projectSavedEvmTransaction,
  type EvmReplayReview,
  type EvmReplayPreparation,
  type EvmReplaySession,
  type EvmSavedTransaction,
} from './evmSignedReplay.ts';
import {
  decodeRetainedSmartAccountOperations,
  decodeRetainedSmartAccountTransfer,
  observeSmartAccountActivity,
  type RetainedSmartAccountTransfer,
} from './smartAccountActivity.ts';
import type { EvmObservationMethod } from '../shared/evmTransactionObservation.ts';

export type SmartAccountReplayIntent = Readonly<{
  account: string;
  callData: string;
  cancellation?: true;
  executions?: readonly Readonly<
    SmartAccountExecution & { assetTransfer?: AssetTransferCall }
  >[];
  operationCount: number;
  operationHash: string;
  operationNonce: string;
  operations: readonly Pick<
    SmartAccountReplayIntent,
    'operationHash' | 'operationNonce'
  >[];
  replayable: boolean;
  transfer?: Pick<
    RetainedSmartAccountTransfer,
    | 'recipient'
    | 'amountUnits'
    | 'token'
    | 'collectibleTransfer'
    | 'contractInteraction'
  >;
}>;
export type SmartAccountSavedTransaction = EvmSavedTransaction &
  Readonly<{
    smartAccount: SmartAccountReplayIntent;
  }>;
export type SmartAccountReplayPreparation =
  | Readonly<{
      review: EvmReplayReview & { smartAccount: SmartAccountReplayIntent };
      status: 'review';
    }>
  | Readonly<{
      hash: string;
      status: 'confirmed' | 'reverted' | 'nonce-consumed';
      transaction: SmartAccountSavedTransaction;
    }>
  | Readonly<{
      reason: 'multiple-user-operations';
      status: 'inspect-only';
      transaction: SmartAccountSavedTransaction;
    }>;

export type SmartAccountReplayOwner = Readonly<{
  account: Readonly<{ address: string; id: number }>;
  assertCurrent(): void;
  /** Capture the recorded local signer, never a replacement/default payer. */
  capturePayer(entry: EvmRetainedSignedRecord): EvmReplaySession;
  chainId: string;
  read(
    method: EvmObservationMethod,
    params: readonly unknown[],
    assertCurrent: () => void
  ): Promise<unknown>;
  recordSession: EvmSignedRecordSession;
}>;

function executions(
  callData: string
): readonly Readonly<SmartAccountExecution>[] | undefined {
  try {
    const [mode, payload] = paliSmartAccountInterface.decodeFunctionData(
      'execute',
      callData
    );
    if (
      paliSmartAccountInterface
        .encodeFunctionData('execute', [mode, payload])
        .toLowerCase() !== callData.toLowerCase()
    )
      return;
    if (mode === ERC7579_MODE_SINGLE_DEFAULT && payload.length >= 106)
      return Object.freeze([
        Object.freeze({
          target: getAddress('0x' + payload.slice(2, 42)),
          value: BigInt('0x' + payload.slice(42, 106)).toString(),
          data: '0x' + payload.slice(106),
        }),
      ]);
    if (mode === ERC7579_MODE_BATCH_DEFAULT) {
      const abi = AbiCoder.defaultAbiCoder(),
        types = ['tuple(address target,uint256 value,bytes callData)[]'];
      const decoded = abi.decode(types, payload);
      if (
        !decoded[0].length ||
        decoded[0].length > 50 ||
        abi.encode(types, decoded).toLowerCase() !== payload.toLowerCase()
      )
        return;
      return Object.freeze(
        decoded[0].map(
          (call: { callData: string; target: string; value: bigint }) =>
            Object.freeze({
              target: getAddress(call.target),
              value: call.value.toString(),
              data: call.callData,
            })
        )
      );
    }
  } catch {
    /* Unknown account methods stay inspectable as contract calls. */
  }
}

export function projectSmartAccountSavedTransaction(
  record: EvmRetainedSmartAccountRecord,
  address: string
): SmartAccountSavedTransaction {
  const account = getAddress(address),
    selected = record.operations.find(
      (operation) => operation.account === account
    );
  if (!selected) throw new EvmReplayError('NOT_FOUND');
  const decoded = record.cancellation
    ? undefined
    : paliEntryPointInterface.decodeFunctionData(
        'handleOps',
        Transaction.from(record.entry.rawTransaction).data
      )[0];
  const index = record.operations.indexOf(selected),
    callData = decoded ? String(decoded[index].callData) : '0x';
  const calls = executions(callData)?.map((call) => {
    const assetTransfer = decodeAssetTransfer(call.data, call.target);
    return Object.freeze({
      ...call,
      ...(assetTransfer ? { assetTransfer } : {}),
    });
  });
  // Membership was proved above from handleOps bytes. Supply only that proven
  // hint to the existing transfer projection; optional asset metadata is unchanged.
  const transfer = record.cancellation
    ? null
    : decodeRetainedSmartAccountTransfer(
        {
          ...record.entry,
          metadata: {
            ...record.entry.metadata,
            smartAccountExecution: true,
            smartAccountExecutionFrom: account,
          },
        },
        account
      );
  const smartAccount: SmartAccountReplayIntent = Object.freeze({
    account,
    ...(record.cancellation ? { cancellation: true as const } : {}),
    operationHash: selected.operationHash,
    operationNonce: selected.operationNonce,
    operationCount: record.operations.length,
    operations: Object.freeze(
      record.operations
        .filter((operation) => operation.account === account)
        .map((operation) =>
          Object.freeze({
            operationHash: operation.operationHash,
            operationNonce: operation.operationNonce,
          })
        )
    ),
    replayable: record.operations.length === 1,
    callData,
    ...(calls ? { executions: Object.freeze(calls) } : {}),
    ...(transfer
      ? {
          transfer: Object.freeze({
            recipient: transfer.recipient,
            amountUnits: transfer.amountUnits,
            ...(transfer.token ? { token: transfer.token } : {}),
            ...(transfer.collectibleTransfer
              ? { collectibleTransfer: transfer.collectibleTransfer }
              : {}),
            ...(transfer.contractInteraction
              ? { contractInteraction: true as const }
              : {}),
          }),
        }
      : {}),
  });
  return Object.freeze({
    ...projectSavedEvmTransaction(record.entry),
    smartAccount,
  });
}

/** Selected Smart Account ownership around the existing exact-byte EOA replay engine. */
export function createSmartAccountSignedReplay(
  records: EvmSignedRecords,
  capture: () => SmartAccountReplayOwner,
  now?: () => number,
  randomBytes?: (length: number) => Uint8Array
) {
  let generation = 0,
    engine: EvmSignedReplay | undefined;
  let activeReview:
    | {
        allow(
          entry: EvmRetainedSignedRecord,
          intent?: SmartAccountReplayIntent
        ): void;
        check(): void;
        expires: number;
        hashes: Set<string>;
        review: EvmReplayReview;
        session: EvmReplaySession;
      }
    | undefined;
  const time = now ?? (() => performance.now());
  const cancel = (id?: string): boolean => {
    if (id !== undefined && !engine?.cancel(id)) return false;
    if (id === undefined) engine?.cancel();
    generation++;
    engine = undefined;
    activeReview = undefined;
    return true;
  };
  const owner = () => {
    const captured = capture(),
      address = getAddress(captured.account.address),
      chainId = captured.chainId;
    captured.assertCurrent();
    if (
      !/^[1-9][0-9]*$/.test(chainId) ||
      !Number.isSafeInteger(Number(chainId)) ||
      !Number.isSafeInteger(captured.account.id) ||
      captured.account.id < 0
    )
      throw new EvmReplayError('CONTEXT_CHANGED');
    return { captured, address, chainId };
  };
  const pending = (id: string) => {
    const active = activeReview;
    if (!active || active.review.id !== id || !engine)
      throw new EvmReplayError('EXPIRED');
    active.check();
    const current = time();
    if (!Number.isFinite(current) || current < 0 || current >= active.expires)
      throw new EvmReplayError('EXPIRED');
    return { active, replay: engine };
  };
  const track = (
    result: EvmReplayPreparation,
    ownership: Omit<
      NonNullable<typeof activeReview>,
      'review' | 'expires' | 'hashes'
    >
  ) => {
    activeReview =
      result.status === 'review'
        ? {
            ...ownership,
            review: result.review,
            expires: time() + result.review.validForMs,
            hashes: new Set(
              result.review.predecessors.map((entry) => entry.hash)
            ),
          }
        : undefined;
  };
  return Object.freeze({
    cancel,
    async get(hash: string): Promise<SmartAccountSavedTransaction | null> {
      const serial = generation,
        { captured, address, chainId } = owner();
      const record = await records.readSmartAccountReplayExact(
        captured.recordSession,
        chainId,
        address,
        hash
      );
      captured.assertCurrent();
      if (serial !== generation) throw new EvmReplayError('CONTEXT_CHANGED');
      return record
        ? projectSmartAccountSavedTransaction(record, address)
        : null;
    },
    async list(
      options: Readonly<{ beforeHash?: string; maximum?: number }> = {}
    ) {
      const serial = generation,
        { captured, address, chainId } = owner();
      const page = await records.readSmartAccountReplayPage(
        captured.recordSession,
        chainId,
        address,
        { ...options, maximum: options.maximum ?? 30 }
      );
      captured.assertCurrent();
      if (serial !== generation) throw new EvmReplayError('CONTEXT_CHANGED');
      return Object.freeze({
        nextCursor: page.nextCursor,
        transactions: Object.freeze(
          page.entries.map((record) =>
            projectSmartAccountSavedTransaction(record, address)
          )
        ),
      });
    },
    async prepare(hash: string): Promise<SmartAccountReplayPreparation> {
      cancel();
      const serial = generation,
        { captured, address, chainId } = owner();
      const check = () => {
        if (serial !== generation) throw new EvmReplayError('CONTEXT_CHANGED');
        captured.assertCurrent();
        captured.recordSession.assertCurrent();
      };
      const record = await records.readSmartAccountReplayExact(
        { ...captured.recordSession, assertCurrent: check },
        chainId,
        address,
        hash
      );
      check();
      if (!record) throw new EvmReplayError('NOT_FOUND');
      const transaction = projectSmartAccountSavedTransaction(record, address),
        intent = transaction.smartAccount;
      if (!intent.replayable)
        return Object.freeze({
          status: 'inspect-only',
          reason: 'multiple-user-operations',
          transaction,
        });
      const payer = captured.capturePayer(record.entry);
      const checkPayer = () => {
        check();
        payer.assertCurrent();
        if (
          payer.context.account.id !== record.entry.signer.id ||
          payer.context.account.type !== record.entry.signer.type ||
          getAddress(payer.context.account.address) !==
            getAddress(record.entry.from) ||
          String(payer.context.network.chainId) !== chainId
        )
          throw new EvmReplayError('CONTEXT_CHANGED');
      };
      checkPayer();
      const allowed = new Map([
        [record.entry.hash, record.entry.rawTransaction],
      ]);
      const intents = new Map([[record.entry.hash, intent]]);
      const session: EvmReplaySession = Object.freeze({
        ...payer,
        assertCurrent: checkPayer,
        recordSession: { ...payer.recordSession, assertCurrent: checkPayer },
        observe: async (expected) => {
          checkPayer();
          if (
            expected.chainId !== chainId ||
            getAddress(expected.from) !== getAddress(record.entry.from)
          )
            throw new EvmReplayError('CONTEXT_CHANGED');
          const observedIntent = intents.get(expected.hash);
          if (!observedIntent) return payer.observe(expected);
          return observeSmartAccountActivity(
            {
              account: observedIntent.account,
              chainId,
              hash: expected.hash,
              payer: getAddress(record.entry.from),
              nonce: Number(expected.nonce),
              operationHash: observedIntent.operationHash,
              operationNonce: observedIntent.operationNonce,
              ...(observedIntent.cancellation
                ? { cancellation: true as const }
                : {}),
            },
            (method, params) => captured.read(method, params, checkPayer),
            checkPayer
          );
        },
        authorizeReplay: async (entry) => {
          checkPayer();
          if (allowed.get(entry.hash) !== entry.rawTransaction)
            throw new EvmReplayError('CONTEXT_CHANGED');
          return payer.authorizeReplay(entry);
        },
      });
      const replay = new EvmSignedReplay(
        records,
        () => session,
        now,
        randomBytes
      );
      engine = replay;
      const result = await replay.prepare(record.entry.hash);
      checkPayer();
      track(result, {
        check: checkPayer,
        session,
        allow: (entry, admittedIntent) => {
          allowed.set(entry.hash, entry.rawTransaction);
          if (admittedIntent) intents.set(entry.hash, admittedIntent);
        },
      });
      return result.status === 'review'
        ? Object.freeze({
            ...result,
            review: Object.freeze({ ...result.review, smartAccount: intent }),
          })
        : Object.freeze({
            ...result,
            transaction: Object.freeze({
              ...result.transaction,
              smartAccount: intent,
            }),
          });
    },
    async listPredecessors(
      parentReviewId: string,
      options: Readonly<{ beforeHash?: string; maximum?: number }> = {}
    ) {
      const { active, replay } = pending(parentReviewId);
      if (active.review.missingNonce === undefined)
        return Object.freeze({
          nextCursor: null,
          transactions: Object.freeze([]),
        });
      const page = await replay.list({
        ...options,
        nonce: Number(active.review.missingNonce),
      });
      if (pending(parentReviewId).active !== active)
        throw new EvmReplayError('CONTEXT_CHANGED');
      for (const entry of page.transactions) {
        if (
          entry.chainId !== active.review.chainId ||
          entry.from !== active.review.from ||
          entry.nonce >= Number(active.review.nonce)
        )
          throw new EvmReplayError('CONTEXT_CHANGED');
        active.hashes.add(entry.hash);
      }
      return page;
    },
    async preparePredecessor(
      parentReviewId: string,
      hash: string
    ): Promise<EvmReplayPreparation | SmartAccountReplayPreparation> {
      const { active, replay } = pending(parentReviewId);
      if (!active.hashes.has(hash)) throw new EvmReplayError('NOT_FOUND');
      // Consume the parent before reading; a second click cannot repurpose its consent.
      activeReview = undefined;
      replay.cancel(parentReviewId);
      const entry = await records.readExact(
        active.session.recordSession,
        active.review.chainId,
        active.review.from,
        hash
      );
      active.check();
      if (time() >= active.expires) throw new EvmReplayError('EXPIRED');
      if (!entry || entry.nonce >= Number(active.review.nonce))
        throw new EvmReplayError('NOT_FOUND');
      const operations = decodeRetainedSmartAccountOperations(entry);
      const envelope = Transaction.from(entry.rawTransaction);
      if (
        operations.length === 0 &&
        envelope.to === getPaliEntryPointAddress(Number(entry.chainId)) &&
        envelope.data.slice(0, 10).toLowerCase() ===
          paliEntryPointInterface.getFunction('handleOps')!.selector
      )
        throw new EvmReplayError('INVALID_RESPONSE');
      const transaction = operations.length
        ? projectSmartAccountSavedTransaction(
            { entry, operations },
            operations[0]!.account
          )
        : undefined;
      if (transaction && !transaction.smartAccount.replayable)
        return Object.freeze({
          status: 'inspect-only',
          reason: 'multiple-user-operations',
          transaction,
        });
      active.allow(entry, transaction?.smartAccount);
      const result = await replay.prepare(entry.hash);
      active.check();
      track(result, active);
      if (!transaction) return result;
      return result.status === 'review'
        ? Object.freeze({
            ...result,
            review: Object.freeze({
              ...result.review,
              smartAccount: transaction.smartAccount,
            }),
          })
        : Object.freeze({
            ...result,
            transaction: Object.freeze({
              ...result.transaction,
              smartAccount: transaction.smartAccount,
            }),
          });
    },
    confirm(id: string) {
      if (!engine) throw new EvmReplayError('EXPIRED');
      if (activeReview?.review.id === id) activeReview = undefined;
      return engine.confirm(id);
    },
  });
}
