import { EvmFeeBalanceError } from '../../../shared/evmFeeApproval.ts';
import { EvmReplayError } from '../../../wallet/evmSignedReplay.ts';

import type { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

export async function readLiveEvmChainId(
  provider: Pick<CustomJsonRpcProvider, 'readMany'>,
  assertCurrent: () => void
): Promise<string> {
  assertCurrent();
  // Direct reads bypass the provider's ordinary completed chain-ID cache.
  const results = await provider.readMany([
    { method: 'eth_chainId', params: [] },
  ]);
  assertCurrent();
  if (!Array.isArray(results) || results.length !== 1)
    throw new EvmReplayError('CONTEXT_CHANGED');
  const result = results[0];
  if (result?.status === 'rejected') throw result.reason;
  if (
    result?.status !== 'fulfilled' ||
    typeof result.value !== 'string' ||
    !/^0x[1-9a-f][0-9a-f]{0,63}$/i.test(result.value)
  )
    throw new EvmReplayError('CONTEXT_CHANGED');
  return result.value;
}

export async function assertEvmCancellationFunds(
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
