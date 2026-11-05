type EvmEstimateRequest = Readonly<
  {
    chainId: string;
    data: string;
    from: string;
    nonce: string;
    to: string;
    value: string;
  } & (
    | { gasPrice: string; type: 0 }
    | { maxFeePerGas: string; maxPriorityFeePerGas: string; type: 2 }
  )
>;

const quantity = (value: string | number) => `0x${BigInt(value).toString(16)}`;

/** Build the pending estimate for an already validated execution and fee model. */
export function evmEstimateRequest(transaction: EvmEstimateRequest) {
  return {
    from: transaction.from,
    to: transaction.to,
    value: quantity(transaction.value),
    data: transaction.data,
    type: quantity(transaction.type),
    chainId: quantity(transaction.chainId),
    nonce: quantity(transaction.nonce),
    ...(transaction.type === 0
      ? { gasPrice: quantity(transaction.gasPrice) }
      : {
          maxFeePerGas: quantity(transaction.maxFeePerGas),
          maxPriorityFeePerGas: quantity(transaction.maxPriorityFeePerGas),
        }),
  };
}
