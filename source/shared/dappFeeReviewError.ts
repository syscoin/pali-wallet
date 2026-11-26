export class DappFeeReviewError extends Error {
  readonly transactionNotBroadcast = true;

  constructor(
    readonly code:
      | 'DAPP_FEE_INSUFFICIENT_FUNDS'
      | 'DAPP_FEE_REVERTED'
      | 'DAPP_FEE_ESTIMATE_UNAVAILABLE'
  ) {
    super(code);
  }
}

/** Only classify a response to the exact eth_estimateGas read. */
export function classifyDappGasEstimateError(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const { code, message, data } = error as Record<string, unknown>;
  if (code === -32601 || code === -32004)
    return new DappFeeReviewError('DAPP_FEE_ESTIMATE_UNAVAILABLE');
  if (
    (code === 3 || code === -32000) &&
    typeof message === 'string' &&
    /^execution reverted(?:$|:)/i.test(message) &&
    (code === 3 ||
      (typeof data === 'string' &&
        data.length <= 8194 &&
        /^0x(?:[0-9a-f]{2})*$/i.test(data)))
  )
    return new DappFeeReviewError('DAPP_FEE_REVERTED');
  return undefined;
}
