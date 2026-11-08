import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

import { compareEvmDappFees } from '../../../shared/evmDappFeePolicy';

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
    feeComparison: compareEvmDappFees(
      {
        ...(input.gasLimit === undefined && input.gas === undefined
          ? {}
          : { gasLimit: BigInt(input.gasLimit ?? input.gas) }),
        ...(input.gasPrice === undefined
          ? {}
          : { gasPrice: BigInt(input.gasPrice) }),
        ...(input.maxFeePerGas === undefined
          ? {}
          : { maxFeePerGas: BigInt(input.maxFeePerGas) }),
        ...(input.maxPriorityFeePerGas === undefined
          ? {}
          : { maxPriorityFeePerGas: BigInt(input.maxPriorityFeePerGas) }),
      },
      transaction.type === 0
        ? {
            type: 0,
            gasLimit: BigInt(transaction.gasLimit),
            gasPrice: BigInt(transaction.gasPrice),
          }
        : {
            type: 2,
            gasLimit: BigInt(transaction.gasLimit),
            maxFeePerGas: BigInt(transaction.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
          },
      BigInt(options.gasLimit?.toString() ?? 21000),
      {
        gasPrice: BigInt(options.gasPrice?.toString() ?? '2000000000'),
        maxFeePerGas: BigInt(options.maxFeePerGas?.toString() ?? '3000000000'),
        maxPriorityFeePerGas: BigInt(
          options.maxPriorityFeePerGas?.toString() ?? '1000000000'
        ),
      }
    ),
    transaction,
    maximumFeeUnits,
    maximumTotalUnits: (
      BigInt(transaction.value) + BigInt(maximumFeeUnits)
    ).toString(),
    validForMs: 90000,
  };
}
