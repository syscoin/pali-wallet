import { PRIVACY_CHAIN_ID, PRIVACY_POOLS } from '../utils/privacy/registry.ts';

export type PrivacyPoolActivity = Readonly<{
  amount: string;
  kind: 'deposit' | 'withdrawal';
}>;

/** Recognize the direct calls to Pali's pinned ETH pools, including pending calls. */
export function getPrivacyPoolActivity(
  chainId: unknown,
  to: unknown,
  data: unknown
): PrivacyPoolActivity | undefined {
  if (
    (chainId !== PRIVACY_CHAIN_ID && chainId !== String(PRIVACY_CHAIN_ID)) ||
    typeof to !== 'string' ||
    typeof data !== 'string'
  )
    return undefined;

  const selector = data.slice(0, 10).toLowerCase();
  const kind =
    selector === '0xb214faa5' // deposit(bytes32)
      ? 'deposit'
      : selector === '0x21a0adb6' // withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)
      ? 'withdrawal'
      : undefined;
  if (!kind) return undefined;

  const target = to.toLowerCase();
  const pool = PRIVACY_POOLS.find(({ address }) => address === target);
  return pool ? { kind, amount: pool.amount } : undefined;
}
