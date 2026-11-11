import type { NativeTransferRuntime } from '../src/custody/transfers.ts';

/** Qualification uses the same explicit PIN and one-use receipt as the send controller. */
export async function signQualificationTransfer(
  runtime: NativeTransferRuntime,
  pin: string,
  transaction: Parameters<NativeTransferRuntime['sign']>[0],
  authority: Omit<Parameters<NativeTransferRuntime['sign']>[1], 'authorization'>
) {
  const authorization = await runtime.authorizeOperation({ method: 'pin', pin }, transaction, authority.assertCurrent);
  try { return await runtime.sign(transaction, { ...authority, authorization }); }
  finally { runtime.releaseOperationAuthorization(authorization); }
}
