import { Transaction } from 'ethers/transaction';

import {
  assertEvmCancellationPayerReady,
  assertRetainedEvmCancellationReady,
  isEvmProtectedEmptySelfCall,
} from '../../../shared/evmCancellationPayer.ts';
import {
  assertEvmSpeedUpExecutable,
  EvmFeeBalanceError,
} from '../../../shared/evmFeeApproval.ts';
import { observeEvmTransaction } from '../../../shared/evmTransactionObservation.ts';
import {
  EvmReplayError,
  EvmSignedReplay,
  type EvmReplaySession,
} from '../../../wallet/evmSignedReplay.ts';

import type { EvmSignedRecords } from '../../../wallet/evmSignedRecords.ts';
import type {
  CustomJsonRpcProvider,
  EvmRetainedCancellationOrigin,
  KeyringManager,
} from '@sidhujag/sysweb3-keyring';

type Captured = Omit<EvmReplaySession, 'observe' | 'dispatch'> &
  Readonly<{
    provider: Pick<CustomJsonRpcProvider, 'send' | '_send'>;
  }>;

export async function readLiveEvmChainId(
  provider: Pick<CustomJsonRpcProvider, '_send'>,
  assertCurrent: () => void
): Promise<string> {
  assertCurrent();
  // The provider's ordinary send method caches eth_chainId.
  const id = 0;
  const replies = await provider._send({
    jsonrpc: '2.0',
    id,
    method: 'eth_chainId',
    params: [],
  });
  assertCurrent();
  const response: unknown =
    Array.isArray(replies) && replies.length === 1 ? replies[0] : null;
  if (
    !response ||
    typeof response !== 'object' ||
    !('jsonrpc' in response) ||
    response.jsonrpc !== '2.0' ||
    !('id' in response) ||
    response.id !== id ||
    'error' in response ||
    !('result' in response) ||
    typeof response.result !== 'string' ||
    !/^0x[1-9a-f][0-9a-f]{0,63}$/i.test(response.result)
  )
    throw new EvmReplayError('CONTEXT_CHANGED');
  return response.result;
}

export async function assertLiveEvmReplacementChain(
  provider: Pick<CustomJsonRpcProvider, '_send'>,
  chainId: string | number,
  assertCurrent: () => void
): Promise<void> {
  const observed = await readLiveEvmChainId(provider, assertCurrent);
  assertCurrent();
  if (BigInt(observed) !== BigInt(chainId))
    throw new EvmReplayError('CONTEXT_CHANGED');
}

export async function assertExtensionRetainedCancellationReady(
  provider: Captured['provider'],
  rawTransaction: string,
  assertCurrent: () => void
): Promise<void> {
  assertCurrent();
  const tx = Transaction.from(rawTransaction);
  if (!tx.isSigned() || tx.serialized !== rawTransaction)
    throw new EvmReplayError('INVALID_RESPONSE');
  await assertRetainedEvmCancellationReady(
    {
      chainId: tx.chainId.toString(),
      from: tx.from,
      hash: tx.hash,
      nonce: String(tx.nonce),
      to: tx.to,
    },
    (method, params) =>
      method === 'eth_chainId'
        ? readLiveEvmChainId(provider, assertCurrent)
        : provider.send(method, [...params]),
    assertCurrent
  );
  assertCurrent();
}

export async function assertExtensionRetainedCancellationFunds(
  provider: Pick<CustomJsonRpcProvider, 'send'>,
  payer: string,
  maximumFee: bigint,
  assertCurrent: () => void
): Promise<void> {
  assertCurrent();
  // Pending balance may already include the debit this cancellation replaces.
  const balance: unknown = await provider.send('eth_getBalance', [
    payer,
    'latest',
  ]);
  assertCurrent();
  if (
    typeof balance !== 'string' ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(balance)
  )
    throw new EvmReplayError('INVALID_RESPONSE');
  if (BigInt(balance) < maximumFee) throw new EvmFeeBalanceError();
}

/** The extension contributes its existing captured provider, never a new RPC client. */
export function createExtensionEvmReplay(
  records: EvmSignedRecords,
  capture: () => Captured
): EvmSignedReplay {
  return new EvmSignedReplay(records, () => {
    const captured = capture();
    captured.assertCurrent();
    const send = captured.provider.send.bind(captured.provider);
    return Object.freeze({
      context: captured.context,
      recordSession: captured.recordSession,
      assertCurrent: captured.assertCurrent,
      observe: (expected) =>
        observeEvmTransaction(
          expected,
          (method, params) =>
            method === 'eth_chainId'
              ? readLiveEvmChainId(captured.provider, captured.assertCurrent)
              : send(method, [...params]),
          captured.assertCurrent
        ),
      dispatch: (raw, admit, context) => {
        const broadcast = () => send('eth_sendRawTransaction', [raw]);
        const requiresPayerCheck =
          context.operation === 'cancel' || context.requiresPayerCheck;
        const speedUp =
          context.operation === 'speed-up' && !requiresPayerCheck
            ? Transaction.from(raw)
            : undefined;
        if (requiresPayerCheck) {
          const tx = Transaction.from(raw);
          if (
            tx.from?.toLowerCase() !== context.from.toLowerCase() ||
            !isEvmProtectedEmptySelfCall(tx, context.operation)
          )
            throw new EvmReplayError('INVALID_RESPONSE');
        }
        return admit(broadcast, async () => {
          await assertLiveEvmReplacementChain(
            captured.provider,
            context.chainId,
            captured.assertCurrent
          );
          if (speedUp) {
            const [nonce, block] = await Promise.all([
              send('eth_getTransactionCount', [context.from, 'latest']),
              send('eth_getBlockByNumber', ['latest', false]),
            ]);
            captured.assertCurrent();
            assertEvmSpeedUpExecutable(speedUp, nonce, block);
            await assertLiveEvmReplacementChain(
              captured.provider,
              context.chainId,
              captured.assertCurrent
            );
          }
          if (!requiresPayerCheck) return;
          await assertEvmCancellationPayerReady(
            context.from,
            context.nonce,
            (method, address, tag) => send(method, [address, tag]),
            captured.assertCurrent
          );
        });
      },
    });
  });
}

const RETAINED_CANCEL_REVIEW_MS = 90_000;
export type RetainedEvmCancellationReview = Readonly<{
  chainId: number;
  from: string;
  hash: string;
  id: string;
  maximumFee: string;
  nonce: number;
  validForMs: number;
}>;
type RetainedCancellationOutcome = Readonly<
  | { hash: string; status: 'submitted' | 'unknown' }
  | { status: 'not-dispatched' }
>;
type RetainedCancellationOwner = Pick<Captured, 'provider' | 'recordSession'> &
  Readonly<{
    account: Captured['context']['account'];
    cancelTransaction: KeyringManager['ethereumTransaction']['cancelSentTransaction'];
    chainId: number;
    records: EvmSignedRecords;
  }>;

/** Review authorization is private to the captured wallet and consumed before any signing. */
export function createExtensionRetainedCancellation(
  capture: () => RetainedCancellationOwner
) {
  let selected:
    | {
        confirm?: () => Promise<RetainedCancellationOutcome>;
        id: string;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let active:
    | { assertCurrent: () => void; origin: EvmRetainedCancellationOrigin }
    | undefined;
  const captureApproval = (origin: EvmRetainedCancellationOrigin) => {
    const approval = active;
    if (
      !approval ||
      approval.origin.rawTransaction !== origin.rawTransaction ||
      approval.origin.tipHash !== origin.tipHash ||
      approval.origin.nonce !== origin.nonce
    )
      throw new EvmReplayError('CONTEXT_CHANGED');
    const assertCurrent = () => {
      if (active !== approval) throw new EvmReplayError('CONTEXT_CHANGED');
      approval.assertCurrent();
    };
    assertCurrent();
    return assertCurrent;
  };
  const cancel = (id?: string) => {
    if (!selected || (id !== undefined && selected.id !== id)) return;
    clearTimeout(selected.timer);
    selected = undefined;
  };
  const prepare = async (
    hash: string
  ): Promise<RetainedEvmCancellationReview> => {
    if (active || typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
      throw new EvmReplayError('CONTEXT_CHANGED');
    const originalHash = hash.toLowerCase();
    const {
      account: { address: from, id: accountId, type },
      provider,
      records,
      recordSession,
      chainId,
      cancelTransaction,
    } = capture();
    const { assertCurrent, keyring } = recordSession;
    cancel();
    const id = crypto.randomUUID();
    const deadline = performance.now() + RETAINED_CANCEL_REVIEW_MS;
    const pending = {
      id,
      timer: setTimeout(() => cancel(id), RETAINED_CANCEL_REVIEW_MS),
      confirm: undefined as
        | (() => Promise<RetainedCancellationOutcome>)
        | undefined,
    };
    selected = pending;
    const assertLive = () => {
      assertCurrent();
      if (performance.now() >= deadline)
        throw new EvmReplayError('CONTEXT_CHANGED');
    };
    const assertPreparing = () => {
      assertLive();
      if (selected !== pending) throw new EvmReplayError('CONTEXT_CHANGED');
    };
    try {
      const readOriginal = (assertOwner: () => void) =>
        records.readReplacement(
          { keyring, assertCurrent: assertOwner },
          String(chainId),
          from,
          originalHash,
          'cancel'
        );
      const retained = await readOriginal(assertPreparing);
      assertPreparing();
      if (
        !retained?.binding?.expectedTipHash ||
        retained.original.signer.type !== type ||
        retained.original.signer.id !== accountId
      )
        throw new EvmReplayError('CONTEXT_CHANGED');
      const origin: EvmRetainedCancellationOrigin = Object.freeze({
        kind: 'retained',
        rawTransaction: retained.original.rawTransaction,
        nonce: retained.original.nonce,
        tipHash: retained.binding.expectedTipHash,
        feeFloor: retained.rates,
      });
      await assertExtensionRetainedCancellationReady(
        provider,
        origin.rawTransaction,
        assertPreparing
      );
      const quote = await cancelTransaction(
        originalHash,
        undefined,
        undefined,
        {
          origin,
          assertCurrentContext: assertPreparing,
          previewOnly: true,
        }
      );
      assertPreparing();
      const { maximumFee } = quote;
      if (
        quote.error ||
        quote.isCanceled ||
        typeof maximumFee !== 'string' ||
        !/^(0|[1-9][0-9]{0,77})$/.test(maximumFee)
      )
        throw new EvmReplayError('CONTEXT_CHANGED');
      const reviewedMaximumFee = BigInt(maximumFee);
      await assertExtensionRetainedCancellationFunds(
        provider,
        from,
        reviewedMaximumFee,
        assertPreparing
      );
      const submit = async (): Promise<RetainedCancellationOutcome> => {
        const fresh = await readOriginal(assertLive);
        assertLive();
        if (
          !fresh?.binding ||
          fresh.binding.expectedTipHash !== origin.tipHash ||
          fresh.original.rawTransaction !== origin.rawTransaction
        )
          throw new EvmReplayError('CONTEXT_CHANGED');
        await assertExtensionRetainedCancellationFunds(
          provider,
          from,
          reviewedMaximumFee,
          assertLive
        );
        await assertExtensionRetainedCancellationReady(
          provider,
          origin.rawTransaction,
          assertLive
        );
        const result = await cancelTransaction(
          originalHash,
          undefined,
          undefined,
          {
            origin,
            assertCurrentContext: assertLive,
            previewOnly: false,
            approvedMaximumFee: maximumFee,
          }
        );
        // Wire admission already holds the deadline and journal checks. A late
        // acknowledgement remains meaningful even after the review expires.
        const submitted = result.isCanceled && result.transaction?.hash;
        if (
          typeof submitted === 'string' &&
          /^0x[0-9a-f]{64}$/i.test(submitted)
        )
          return { status: 'submitted', hash: submitted.toLowerCase() };
        const uncertain = result.signedTransactionHash;
        if (
          result.transactionNotBroadcast === false &&
          typeof uncertain === 'string' &&
          /^0x[0-9a-f]{64}$/i.test(uncertain)
        )
          return { status: 'unknown', hash: uncertain.toLowerCase() };
        if (result.transactionNotBroadcast === true)
          return { status: 'not-dispatched' };
        throw new EvmReplayError('CONTEXT_CHANGED');
      };
      pending.confirm = async () => {
        assertLive();
        if (active) throw new EvmReplayError('CONTEXT_CHANGED');
        const approval = { origin, assertCurrent: assertLive };
        active = approval;
        try {
          return await submit();
        } finally {
          if (active === approval) active = undefined;
        }
      };
      return {
        id,
        hash: originalHash,
        chainId,
        from,
        nonce: origin.nonce,
        maximumFee,
        validForMs: Math.max(0, Math.floor(deadline - performance.now())),
      };
    } catch (error) {
      cancel(id);
      throw error;
    }
  };
  const confirm = async (id: string): Promise<RetainedCancellationOutcome> => {
    const pending = selected;
    if (!pending?.confirm || pending.id !== id)
      throw new EvmReplayError('CONTEXT_CHANGED');
    cancel(id);
    return pending.confirm();
  };
  return Object.freeze({ cancel, captureApproval, confirm, prepare });
}
