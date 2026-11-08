import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';

import type { IEvmCallBlacklistTarget } from '../../shared/evmCallBlacklist.ts';
import type { IBlacklistCheckResult } from '../../types/security.ts';

/** The same high-severity target policy applies to both Smart account hosts. */
export async function assertSmartAccountTargetsAllowed(
  targets: readonly IEvmCallBlacklistTarget[],
  checkAddress: (address: string) => Promise<IBlacklistCheckResult>,
  assertCurrent: () => void
): Promise<void> {
  for (const target of targets) {
    assertSynchronousEvmFeeGuard(assertCurrent);
    const result = await checkAddress(target.address);
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (
      result.isBlacklisted &&
      (result.severity === 'critical' || result.severity === 'high')
    ) {
      const reason =
        result.reason ||
        (target.type === 'approval'
          ? 'Spender address is blacklisted'
          : target.type === 'token-recipient'
          ? 'Recipient address is blacklisted'
          : 'Target address is blacklisted');
      throw new Error(
        `Smart account execution blocked: ${reason}. Severity: ${result.severity}`
      );
    }
  }
}
