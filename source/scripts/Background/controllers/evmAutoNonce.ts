import { parseEvmFeeQuantity } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';

import { EvmAssetStateError } from '../../../shared/evmAssetState';
import { availableEvmNativeBalance } from '../../../shared/evmAutoNonce';
import { EVM_SIGNED_RECORD_NONCE_CONFLICT } from '../../../wallet/evmSignedRecords';
import {
  EVM_ASSET_REVIEW_MESSAGE,
  EVM_ASSET_REVIEW_REQUIRED,
  EVM_LEGACY_PENDING,
  EVM_LEGACY_VERIFICATION_UNAVAILABLE,
} from 'utils/evmTransactionContext';

import {
  assertWorkerAssetBasis,
  claimWorkerAssetBasis,
  type WorkerAssetBasis,
} from './evmAssetState';
import type {
  EvmNativeReservations,
  EvmAutoNonceAcceptance,
  EvmAutoNonceSnapshot,
} from '../../../shared/evmAutoNonce';
import type { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

export type ExtensionReviewedNonce = Readonly<{
  nonce: number;
  source: 'automatic' | 'manual';
}>;

type NonceScope = Readonly<{
  chainId: string;
  endpoint: string;
  from: string;
}>;

type NonceProvider = Pick<
  CustomJsonRpcProvider,
  'send' | 'signal' | 'verifyConfiguredChainId'
>;

const unavailable = (reason?: 'retained' | 'asset-state') =>
  Object.assign(
    new Error(
      reason === 'asset-state'
        ? EVM_ASSET_REVIEW_MESSAGE
        : reason === 'retained'
        ? 'A saved transaction needs attention. Check Activity before sending again.'
        : 'The account nonce changed. Review this transfer again.'
    ),
    {
      transactionNotBroadcast: true,
      ...(reason === 'retained' && { code: EVM_SIGNED_RECORD_NONCE_CONFLICT }),
      ...(reason === 'asset-state' && { code: EVM_ASSET_REVIEW_REQUIRED }),
    }
  );

export function reviewedExtensionNonce(
  nonce: unknown,
  source: ExtensionReviewedNonce['source']
): ExtensionReviewedNonce {
  const value = parseEvmFeeQuantity(nonce, 'reviewed transaction nonce');
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
  return Object.freeze({ nonce: Number(value), source });
}

/**
 * Legacy public history is only a hint. Refuse reuse when this exact candidate
 * is independently observed pending on the captured endpoint; never advance
 * the nonce or treat a history row as signed-journal ownership.
 */
export async function assertNoObservedLegacyPending({
  provider,
  scope,
  nonce,
  hashes,
  assertCurrent,
}: Readonly<{
  assertCurrent(): void;
  hashes: readonly string[];
  nonce: number;
  provider: NonceProvider;
  scope: NonceScope;
}>): Promise<void> {
  const candidates = [...new Set(hashes.map((hash) => hash.toLowerCase()))];
  const cannotVerify = () =>
    Object.assign(
      new Error(
        'Unable to check previous transactions. Refresh Activity and try again.'
      ),
      {
        transactionNotBroadcast: true,
        code: EVM_LEGACY_VERIFICATION_UNAVAILABLE,
      }
    );
  if (candidates.length > 16) throw cannotVerify();
  if (!candidates.length) return;
  const check = () => {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
  };
  const quantity = (value: unknown): bigint | undefined => {
    if (
      typeof value !== 'string' ||
      !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)
    )
      return;
    return BigInt(value);
  };
  for (const hash of candidates) {
    check();
    let value: unknown;
    try {
      value = await provider.send('eth_getTransactionByHash', [hash]);
    } catch {
      check();
      throw cannotVerify();
    }
    check();
    if (value === null) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw cannotVerify();
    const tx = value as Record<string, unknown>;
    const txNonce = quantity(tx.nonce);
    const txChainId =
      tx.chainId === undefined ? undefined : quantity(tx.chainId);
    const unprotected =
      txChainId === BigInt(0) &&
      (tx.type === undefined || tx.type === '0x0' || tx.type === 0);
    const pending =
      tx.blockHash === null &&
      tx.blockNumber === null &&
      tx.transactionIndex === null;
    const mined =
      typeof tx.blockHash === 'string' &&
      /^0x[0-9a-f]{64}$/i.test(tx.blockHash) &&
      quantity(tx.blockNumber) !== undefined &&
      quantity(tx.transactionIndex) !== undefined;
    if (
      typeof tx.hash !== 'string' ||
      !/^0x[0-9a-f]{64}$/i.test(tx.hash) ||
      typeof tx.from !== 'string' ||
      !/^0x[0-9a-f]{40}$/i.test(tx.from) ||
      txNonce === undefined ||
      txNonce > BigInt(Number.MAX_SAFE_INTEGER) ||
      (tx.chainId !== undefined && txChainId === undefined) ||
      (txChainId === BigInt(0) && !unprotected) ||
      (!pending && !mined)
    )
      throw cannotVerify();
    if (
      tx.hash.toLowerCase() === hash &&
      tx.from.toLowerCase() === scope.from.toLowerCase() &&
      txNonce === BigInt(nonce) &&
      (txChainId === undefined ||
        unprotected ||
        txChainId === BigInt(scope.chainId)) &&
      pending
    ) {
      await provider.verifyConfiguredChainId();
      check();
      throw Object.assign(
        new Error(
          'A previous transaction is still pending. Check Activity before trying again.'
        ),
        { transactionNotBroadcast: true, code: EVM_LEGACY_PENDING }
      );
    }
  }
  check();
  await provider.verifyConfiguredChainId();
  check();
}

/** Read fresh counts directly from the same owned RPC route used for submission. */
export async function planExtensionEvmNonce({
  provider,
  scope,
  snapshot,
  acceptance,
  assertCurrent,
  reviewed,
  minimumBalance,
  assetBasis,
  beforeAssetFinal,
}: Readonly<{
  acceptance: EvmAutoNonceAcceptance;
  assertCurrent(): void;
  assetBasis?: WorkerAssetBasis;
  // Legacy observation runs before the mandatory final basis check.
  beforeAssetFinal?: (nonce: number) => Promise<void>;
  minimumBalance?: bigint;
  provider: NonceProvider;
  reviewed?: ExtensionReviewedNonce;
  scope: NonceScope;
  snapshot: EvmAutoNonceSnapshot;
}>) {
  const check = () => {
    assertCurrent();
    if (provider.signal.aborted) throw provider.signal.reason;
  };
  const read = async (method: string, params: unknown[]) => {
    check();
    const result: unknown = await provider.send(method, params);
    check();
    return result;
  };
  const verifyChain = async () => {
    check();
    await provider.verifyConfiguredChainId();
    check();
  };
  let assetState: WorkerAssetBasis | undefined;
  if (assetBasis) {
    if (!beforeAssetFinal) throw unavailable();
    assetState = claimWorkerAssetBasis(
      provider,
      scope.from,
      scope.chainId,
      scope.endpoint,
      assertCurrent,
      assetBasis
    );
  } else {
    if (beforeAssetFinal) throw unavailable();
    await verifyChain();
  }
  const block = (assetState ??
    (await read('eth_getBlockByNumber', ['latest', false]))) as {
    hash: unknown;
    number: unknown;
  } | null;
  if (
    !block ||
    typeof block !== 'object' ||
    typeof block.hash !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(block.hash)
  )
    throw unavailable();
  const canonicalBlock = Object.freeze({
    number: `0x${parseEvmFeeQuantity(
      block.number,
      'canonical block number'
    ).toString(16)}`,
    hash: block.hash.toLowerCase(),
  });
  const [rawLatest, rawPending] = await Promise.all([
    read('eth_getTransactionCount', [scope.from, canonicalBlock.number]),
    read('eth_getTransactionCount', [scope.from, 'pending']),
  ]);
  const latest = reviewedExtensionNonce(rawLatest, 'automatic').nonce;
  const pending = reviewedExtensionNonce(rawPending, 'automatic').nonce;
  const finish = async (
    nonce: number,
    state: 'latest' | 'pending',
    nativeReservations: EvmNativeReservations
  ) => {
    if (minimumBalance !== undefined) {
      const [canonical, pendingBalance] = await Promise.all([
        read('eth_getBalance', [scope.from, canonicalBlock.number]),
        read('eth_getBalance', [scope.from, 'pending']),
      ]);
      const available = availableEvmNativeBalance(
        {
          canonical: parseEvmFeeQuantity(canonical, 'canonical balance'),
          pending: parseEvmFeeQuantity(pendingBalance, 'pending balance'),
        },
        nativeReservations,
        state
      );
      if (available < minimumBalance)
        throw Object.assign(
          new Error('Insufficient balance for pending transfers.'),
          { transactionNotBroadcast: true }
        );
    }
    if (assetBasis) {
      await beforeAssetFinal!(nonce);
      check();
      // The planner owns the mandatory post-legacy canonical, nonce and
      // fresh-chain checks; no callback can suppress them.
      await assertWorkerAssetBasis(
        provider,
        scope.from,
        assetBasis,
        assertCurrent,
        nonce,
        reviewed?.source ?? 'automatic'
      );
      check();
    } else {
      await verifyChain();
    }
    const currentBlock = (await read('eth_getBlockByNumber', [
      canonicalBlock.number,
      false,
    ])) as { hash?: string } | null;
    if (currentBlock?.hash?.toLowerCase() !== canonicalBlock.hash)
      throw unavailable();
    return Object.freeze({ nonce, state, nativeReservations, canonicalBlock });
  };

  const plan = await acceptance
    .plan({
      ...scope,
      latest,
      pending,
      assetState,
      nonceOverride: reviewed?.source === 'manual' ? reviewed.nonce : undefined,
      snapshot,
      readPending: (hash) => read('eth_getTransactionByHash', [hash]),
      assertCurrent: check,
    })
    .catch((error: unknown) => {
      check();
      if (error instanceof EvmAssetStateError) throw unavailable('asset-state');
      throw error;
    });
  if (plan.kind !== 'ready') throw unavailable(plan.reason ?? 'retained');
  if (reviewed && plan.nonce !== reviewed.nonce) throw unavailable();
  return finish(
    plan.nonce,
    pending < latest || plan.nonce < pending ? 'latest' : 'pending',
    plan.nativeReservations
  );
}
