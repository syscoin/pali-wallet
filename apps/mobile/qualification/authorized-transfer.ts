import type { NativeTransferRuntime } from '../src/custody/transfers.ts';

/** Qualification uses the same one-use consent receipt and operation-scoped credential as the send controller. */
export async function signQualificationTransfer(
  runtime: NativeTransferRuntime,
  transaction: Parameters<NativeTransferRuntime['sign']>[0],
  authority: Omit<Parameters<NativeTransferRuntime['sign']>[1], 'authorization'>
) {
  const authorization = await runtime.authorizeOperation({ method: 'device' }, transaction, authority.assertCurrent);
  try { return await runtime.sign(transaction, { ...authority, authorization }); }
  finally { runtime.releaseOperationAuthorization(authorization); }
}
