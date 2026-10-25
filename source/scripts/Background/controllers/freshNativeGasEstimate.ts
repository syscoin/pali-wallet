import { EthereumTransactions } from '@sidhujag/sysweb3-keyring';

import type { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import type { INetwork } from '@sidhujag/sysweb3-network';

type GasPolicy = ReturnType<EthereumTransactions['getGasOverrides']>;
type GasPolicySource = Pick<EthereumTransactions, 'getGasOverrides'>;
type SdkTransaction = Parameters<EthereumTransactions['getTxGasLimit']>[0];
type NativeEstimate = Pick<SdkTransaction, 'data' | 'from' | 'to' | 'value'>;

const hasGasPolicy = (source: unknown): source is GasPolicySource =>
  typeof source === 'object' &&
  source !== null &&
  'getGasOverrides' in source &&
  typeof source.getGasOverrides === 'function';

// IEthereumTransactions omits this public class accessor in this SDK release.
// Refuse a missing/invalid accessor rather than assuming an empty policy.
export function getSdkGasOverrides(source: unknown): GasPolicy {
  if (!hasGasPolicy(source)) throw new Error('SDK gas policy is unavailable');
  const policy = source.getGasOverrides();
  const pending = policy && typeof policy === 'object' && 'then' in policy;
  if (pending) void Promise.resolve(policy).catch(() => undefined);
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || pending)
    throw new Error('SDK gas policy is unavailable');
  return policy;
}

// Caller owns the existing withReceiptReadProvider lifecycle and deadline.
export async function freshSdkGasEstimate(
  policy: GasPolicy,
  network: INetwork,
  transaction: NativeEstimate,
  provider: CustomJsonRpcProvider,
  assertCurrent: () => void
) {
  const check = () => {
    assertCurrent();
    if (provider.signal.aborted)
      throw new DOMException('Gas estimate aborted', 'AbortError');
  };
  check();
  const refuseSigning = (): never => {
    throw new Error('Read-only gas estimate');
  };
  class Reader extends EthereumTransactions {
    get web3Provider() {
      check();
      return provider;
    }
  }
  const reader = new Reader(
    () => network,
    refuseSigning,
    refuseSigning,
    undefined as never,
    undefined as never
  );
  reader.setGasOverrides(policy);
  // This SDK type also requires send-only fee fields. The actual estimator
  // accepts the same four fields used by the ordinary native quote path;
  // preserve that payload rather than inventing fees to satisfy its type.
  const gas = await reader.getTxGasLimit(transaction as SdkTransaction);
  check();
  return gas;
}
