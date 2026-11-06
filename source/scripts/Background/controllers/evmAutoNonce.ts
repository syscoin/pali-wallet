import { parseEvmFeeQuantity } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';

import { WALLET_NETWORK_CATCHING_UP_MESSAGE } from 'utils/evmTransactionContext';

import { EVM_SIGNED_RECORD_NONCE_CONFLICT } from '../../../wallet/evmSignedRecords';

import type {
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
        ? WALLET_NETWORK_CATCHING_UP_MESSAGE
        : reason === 'retained'
        ? 'A saved transaction needs attention. Check Activity before sending again.'
        : 'The account nonce changed. Review this transfer again.'
    ),
    {
      transactionNotBroadcast: true,
      ...(reason === 'retained' && { code: EVM_SIGNED_RECORD_NONCE_CONFLICT }),
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

/** Read fresh counts directly from the same owned RPC route used for submission. */
export async function planExtensionEvmNonce({
  provider,
  scope,
  snapshot,
  acceptance,
  assertCurrent,
  reviewed,
  minimumBalance,
  protectedAssetContract,
}: Readonly<{
  acceptance: EvmAutoNonceAcceptance;
  assertCurrent(): void;
  minimumBalance?: bigint;
  protectedAssetContract?: string;
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
  await verifyChain();
  const [rawLatest, rawPending] = await Promise.all([
    read('eth_getTransactionCount', [scope.from, 'latest']),
    read('eth_getTransactionCount', [scope.from, 'pending']),
  ]);
  const latest = reviewedExtensionNonce(rawLatest, 'automatic').nonce;
  const pending = reviewedExtensionNonce(rawPending, 'automatic').nonce;
  const finish = async (
    nonce: number,
    state: 'latest' | 'pending',
    maximumPredecessorCost: bigint
  ) => {
    if (
      minimumBalance !== undefined &&
      (maximumPredecessorCost > BigInt(0) || state === 'latest')
    ) {
      const balance = parseEvmFeeQuantity(
        await read('eth_getBalance', [scope.from, state]),
        'available balance'
      );
      if (balance < minimumBalance + maximumPredecessorCost)
        throw Object.assign(
          new Error('Insufficient balance for pending transfers.'),
          {
            transactionNotBroadcast: true,
          }
        );
    }
    await verifyChain();
    return Object.freeze({ nonce, state, maximumPredecessorCost });
  };

  if (reviewed?.source === 'manual') {
    if (pending < latest || reviewed.nonce < latest) throw unavailable();
    if (snapshot.retained.some((entry) => entry.nonce === reviewed.nonce))
      throw unavailable('retained');
    return finish(
      reviewed.nonce,
      reviewed.nonce < pending ? 'latest' : 'pending',
      BigInt(0)
    );
  }

  const plan = await acceptance.plan({
    ...scope,
    latest,
    pending,
    protectedAssetContract,
    snapshot,
    readPending: (hash) => read('eth_getTransactionByHash', [hash]),
    assertCurrent: check,
  });
  if (plan.kind !== 'ready') throw unavailable(plan.reason ?? 'retained');
  if (reviewed && plan.nonce !== reviewed.nonce) throw unavailable();
  return finish(
    plan.nonce,
    pending < latest ? 'latest' : 'pending',
    plan.maximumPredecessorCost
  );
}
