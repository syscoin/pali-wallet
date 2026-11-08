import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeApproval.ts';

import { requireSmartAccountAddressIdentity } from './addressIdentity.ts';

/** Observe the same canonical account before choosing deployment or refresh. */
export async function readSmartAccountDeploymentState({
  account,
  chainId,
  provider,
  assertCurrent,
}: {
  account: Parameters<typeof requireSmartAccountAddressIdentity>[0];
  assertCurrent(): void;
  chainId: number;
  provider: { getCode(address: string): Promise<string> };
}): Promise<'deployed' | 'undeployed'> {
  assertSynchronousEvmFeeGuard(assertCurrent);
  const identity = requireSmartAccountAddressIdentity(account, chainId);
  const code = await provider.getCode(identity.address);
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code))
    throw new Error('Invalid smart account code response');
  return code === '0x' ? 'undeployed' : 'deployed';
}
