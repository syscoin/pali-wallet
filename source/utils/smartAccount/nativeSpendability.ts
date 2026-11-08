import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { BigNumber, Contract, hexDataSlice } from '../ethersV6Compat.ts';

import {
  ERC7579_MODE_BATCH_DEFAULT,
  ERC7579_MODE_SINGLE_DEFAULT,
  getSmartAccountUserOpRequiredPrefund,
  type SmartAccountPackedUserOperation,
} from './account.ts';
import {
  getPaliEntryPointAddress,
  PALI_ENTRYPOINT_V09_ABI,
  paliSmartAccountInterface,
} from './contracts.ts';
import { readSmartAccountNativeBalances } from './payerPolicy.ts';

/** Read the signed single execution, never caller-supplied review metadata. */
function nativeValue(operation: SmartAccountPackedUserOperation): BigNumber {
  const [mode, execution] = paliSmartAccountInterface.decodeFunctionData(
    'execute',
    operation.callData
  );
  if (mode === ERC7579_MODE_SINGLE_DEFAULT)
    return BigNumber.from(hexDataSlice(execution, 20, 52));
  // Ordered calls may return native funds before later calls execute. Their
  // affordability requires execution-aware simulation, not a sum of values.
  if (mode === ERC7579_MODE_BATCH_DEFAULT) return BigNumber.from(0);
  throw new Error('Unsupported smart account execution mode');
}

/**
 * A single CALL's value comes from the Smart account. Its EntryPoint deposit
 * offsets the prefund taken before execution; the outer EOA/tank pays separately.
 * Zero-value operations retain the existing deployment prefunding policy.
 * Ordered batches retain their existing execution preflight.
 */
export async function assertSmartAccountNativeSpendability({
  provider,
  chainId,
  userOperation,
  assertCurrent,
}: {
  assertCurrent(): void;
  chainId: number;
  provider: any;
  userOperation: SmartAccountPackedUserOperation;
}): Promise<void> {
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  check();
  const operation = { ...userOperation };
  const value = nativeValue(operation);
  if (value.isZero()) return;
  const requiredPrefund = getSmartAccountUserOpRequiredPrefund(operation);
  const [[balance], rawDeposit] = await Promise.all([
    readSmartAccountNativeBalances(provider, [operation.sender]),
    requiredPrefund.isZero()
      ? Promise.resolve(0)
      : new Contract(
          getPaliEntryPointAddress(chainId),
          PALI_ENTRYPOINT_V09_ABI,
          provider
        ).balanceOf(operation.sender),
  ]);
  check();
  const deposit = BigNumber.from(rawDeposit);
  const missingPrefund = requiredPrefund.gt(deposit)
    ? requiredPrefund.sub(deposit)
    : BigNumber.from(0);
  if (balance!.lt(value.add(missingPrefund)))
    throw Object.assign(
      new Error('Insufficient funds for smart account amount and fee'),
      { transactionNotBroadcast: true }
    );
}
