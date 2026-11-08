import { getAddress } from 'ethers/address';
import { toBeHex } from 'ethers/utils';

import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';

export type SmartAccountNativeExecution = Readonly<{
  data: '0x';
  target: string;
  value: string;
}>;

// Existing extension policy. This reserve belongs to the Smart account, separate from its EOA payer.
const SMART_ACCOUNT_MAX_SEND_BUFFER_WEI = BigInt('1000000000000');
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
  const balance = unsignedUnits(await readBalance());
  check();
  let execution: SmartAccountNativeExecution = Object.freeze({
    target,
    data: '0x',
    value: '0x1',
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    check();
    const quoted = await quoteExecution(execution);
    check();
    const net =
      balance -
      unsignedUnits(quoted.maximumFeeUnits) -
      SMART_ACCOUNT_MAX_SEND_BUFFER_WEI;
    if (net <= BigInt(0))
      throw new Error('Insufficient funds for smart account fee');
    if (net === BigInt(execution.value))
      return Object.freeze({ execution, quote: quoted.quote });
    execution = Object.freeze({ ...execution, value: toBeHex(net) });
  }
  throw new Error('Smart account maximum amount did not stabilize');
}
