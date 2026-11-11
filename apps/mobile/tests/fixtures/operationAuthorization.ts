import type { NativeOperationAuthorization, NativeOperationCredential } from '../../src/custody/types.ts';
import type { NativeTransferRuntime } from '../../src/custody/transfers.ts';

/** Test-only one-use receipt for public fake signing hosts. */
export function createTestOperationAuthorizer<T>(
  authenticate: (credential: NativeOperationCredential, check: () => void) => Promise<void>,
  targetFor: (target: T) => string
) {
  const receipts = new Map<NativeOperationAuthorization, { check(): void; target: string }>();
  return {
    async authorizeOperation(credential: NativeOperationCredential, target: T, check: () => void) {
      const captured = targetFor(target);
      await authenticate(credential, check);
      check();
      if (targetFor(target) !== captured) throw Error('CANCELLED');
      const receipt = Object.freeze({}) as NativeOperationAuthorization;
      receipts.set(receipt, { check, target: captured });
      return receipt;
    },
    releaseOperationAuthorization(receipt: NativeOperationAuthorization) { receipts.delete(receipt); },
    consume(receipt: NativeOperationAuthorization, target: T, check: () => void) {
      const owner = receipts.get(receipt);
      receipts.delete(receipt);
      if (!owner || owner.target !== targetFor(target)) throw Error('CANCELLED');
      owner.check(); check();
    },
  };
}

/** Exercise the real runtime's authorization and one-use signing contracts. */
export async function signTestTransfer(
  runtime: NativeTransferRuntime,
  pin: string,
  transaction: Parameters<NativeTransferRuntime['sign']>[0],
  authority: Omit<Parameters<NativeTransferRuntime['sign']>[1], 'authorization'>,
  intent?: Parameters<NativeTransferRuntime['sign']>[2],
  replacement?: Parameters<NativeTransferRuntime['sign']>[3]
) {
  const authorization = await runtime.authorizeOperation({ method: 'pin', pin }, transaction, authority.assertCurrent);
  try { return await runtime.sign(transaction, { ...authority, authorization }, intent, replacement); }
  finally { runtime.releaseOperationAuthorization(authorization); }
}
