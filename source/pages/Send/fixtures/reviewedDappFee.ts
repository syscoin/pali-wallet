import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

/** Public quote DTO for rendering tests. Signing and transport are never invoked. */
export function reviewedDappFeeFixture(
  input: Record<string, any>,
  options: {
    gasLimit?: unknown;
    gasPrice?: unknown;
    maxFeePerGas?: unknown;
    maxPriorityFeePerGas?: unknown;
  } = {}
) {
  const integer = (value: any) => BigInt(value?.toString() ?? '0').toString();
  const legacy =
    input.type === 0 || input.type === '0x0' || input.gasPrice !== undefined;
  const transaction = snapshotPreparedEvmTransaction({
    from: input.from,
    to: input.to || null,
    chainId: integer(input.chainId ?? 1),
    nonce: integer(input.nonce ?? 0),
    value: integer(input.value ?? 0),
    data: input.data ?? '0x',
    gasLimit: integer(input.gasLimit ?? input.gas ?? options.gasLimit ?? 25200),
    type: legacy ? 0 : 2,
    ...(legacy
      ? {
          gasPrice: integer(input.gasPrice ?? options.gasPrice ?? '2000000000'),
        }
      : {
          accessList: input.accessList ?? [],
          maxFeePerGas: integer(
            input.maxFeePerGas ?? options.maxFeePerGas ?? '3000000000'
          ),
          maxPriorityFeePerGas: integer(
            input.maxPriorityFeePerGas ??
              options.maxPriorityFeePerGas ??
              '1000000000'
          ),
        }),
  });
  const maximumFeeUnits = (
    BigInt(transaction.gasLimit) *
    BigInt(
      transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas
    )
  ).toString();
  return {
    id: 'rendered-fee-review',
    transaction,
    maximumFeeUnits,
    maximumTotalUnits: (
      BigInt(transaction.value) + BigInt(maximumFeeUnits)
    ).toString(),
    validForMs: 90000,
  };
}
