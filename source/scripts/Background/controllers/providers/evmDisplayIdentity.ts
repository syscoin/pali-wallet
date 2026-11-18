import { readEvmRpcQuantity } from '../../../../shared/evmTransactionObservation';
import { createRpcIdentityLease } from '../../../../shared/rpcIdentityLease';

import type { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

const leases = new WeakMap<
  CustomJsonRpcProvider,
  Map<string, ReturnType<typeof createRpcIdentityLease>>
>();

/** One bounded remote identity observation serves this endpoint's display reads. */
export async function ensureEvmDisplayIdentity(
  provider: CustomJsonRpcProvider,
  chainId: number | bigint,
  signal: AbortSignal,
  context = ''
): Promise<void> {
  const endpoint = provider._getConnection().url;
  const key = JSON.stringify([String(chainId), endpoint, context]);
  let entries = leases.get(provider);
  if (!entries) {
    entries = new Map();
    leases.set(provider, entries);
  }
  let lease = entries.get(key);
  if (!lease) {
    lease = createRpcIdentityLease(async (ownerSignal) => {
      const [result] = await provider.readMany(
        [{ method: 'eth_chainId', params: [] }],
        { signal: ownerSignal }
      );
      if (result?.status === 'rejected') throw result.reason;
      if (
        result?.status !== 'fulfilled' ||
        readEvmRpcQuantity(result.value) !== BigInt(chainId)
      )
        throw new Error('Display RPC chain changed');
    });
    entries.set(key, lease);
    if (entries.size > 32) entries.delete(entries.keys().next().value!);
  }
  await lease.ensure(signal);
}
