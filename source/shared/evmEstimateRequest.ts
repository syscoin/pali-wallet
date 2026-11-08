import {
  snapshotEvmAccessList,
  type EvmAccessList,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

type EvmEstimateRequest = Readonly<
  {
    chainId: string;
    data: string;
    from: string;
    nonce: string;
    to: string | null;
    value: string;
  } & (
    | { gasPrice: string; type: 0 }
    | {
        accessList: EvmAccessList;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
        type: 2;
      }
  )
>;

const quantity = (value: string | number) => `0x${BigInt(value).toString(16)}`;

/** Shared call fields. A missing destination represents contract creation. */
export function evmCallRequest(
  transaction: Readonly<{
    accessList?: EvmAccessList;
    data: string;
    from: string;
    nonce: string;
    to: string | null;
    value: string;
  }>
) {
  return {
    from: transaction.from,
    ...(transaction.to === null ? {} : { to: transaction.to }),
    value: quantity(transaction.value),
    data: transaction.data,
    nonce: quantity(transaction.nonce),
    ...(transaction.accessList === undefined
      ? {}
      : {
          accessList: snapshotEvmAccessList(transaction.accessList),
        }),
  };
}

/** Build the pending estimate for an already validated execution and fee model. */
export function evmEstimateRequest(transaction: EvmEstimateRequest) {
  return {
    ...evmCallRequest(transaction),
    type: quantity(transaction.type),
    chainId: quantity(transaction.chainId),
    ...(transaction.type === 0
      ? { gasPrice: quantity(transaction.gasPrice) }
      : {
          maxFeePerGas: quantity(transaction.maxFeePerGas),
          maxPriorityFeePerGas: quantity(transaction.maxPriorityFeePerGas),
        }),
  };
}
