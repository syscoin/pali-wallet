import { getAddress } from 'ethers/address';
import { toBeHex } from 'ethers/utils';

import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';

import { SmartAccountNativeSpendabilityError } from './nativeSpendability.ts';

export type SmartAccountNativeExecution = Readonly<{
  data: '0x';
  target: string;
  value: string;
}>;

// Existing extension policy. This reserve belongs to the Smart account, separate from its EOA payer.
const SMART_ACCOUNT_MAX_SEND_BUFFER_WEI = BigInt('1000000000000');
const MAX_QUOTE_ATTEMPTS = 4;
const unsignedUnits = (value: string): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new Error('Invalid smart account amount');
  const units = BigInt(value);
  if (units >= BigInt(1) << BigInt(256))
    throw new Error('Invalid smart account amount');
  return units;
};

/** Read-only MAX refinement. Only the returned exact execution may be approved. */
export async function prepareSmartAccountNativeMaximum<Quote>(
  options: Readonly<{
    assertCurrent(): void;
    quote(
      execution: SmartAccountNativeExecution
    ): Promise<Readonly<{ maximumFeeUnits: string; quote: Quote }>>;
    readBalance(): Promise<string>;
    target: string;
  }>
): Promise<Readonly<{ execution: SmartAccountNativeExecution; quote: Quote }>> {
  const target = getAddress(options.target);
  const readBalance = options.readBalance,
    quoteExecution = options.quote,
    assertCurrent = options.assertCurrent;
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  check();
  let balance = unsignedUnits(await readBalance());
  check();
  let execution: SmartAccountNativeExecution = Object.freeze({
    target,
    data: '0x',
    value: '0x1',
  });
  for (let attempt = 0; attempt < MAX_QUOTE_ATTEMPTS; attempt++) {
    check();
    let quoted: Awaited<ReturnType<typeof quoteExecution>> | undefined;
    let fee: bigint;
    try {
      quoted = await quoteExecution(execution);
      fee = unsignedUnits(quoted.maximumFeeUnits);
    } catch (error) {
      if (!(error instanceof SmartAccountNativeSpendabilityError)) throw error;
      // A larger amount can increase its own calldata gas. Use the fee from
      // admission to lower the candidate even though no quote was issued.
      balance = unsignedUnits(error.balance);
      fee = unsignedUnits(error.requiredPrefund);
    }
    check();
    const net = balance - fee - SMART_ACCOUNT_MAX_SEND_BUFFER_WEI;
    if (net <= BigInt(0))
      throw new Error('Insufficient funds for smart account fee');
    const amount = BigInt(execution.value);
    // At the limit, an exact admitted quote that leaves extra headroom is
    // still safe to review.
    if (
      quoted &&
      (net === amount || (attempt === MAX_QUOTE_ATTEMPTS - 1 && net > amount))
    )
      return Object.freeze({ execution, quote: quoted.quote });
    execution = Object.freeze({ ...execution, value: toBeHex(net) });
  }
  throw new Error('Smart account maximum amount did not stabilize');
}
