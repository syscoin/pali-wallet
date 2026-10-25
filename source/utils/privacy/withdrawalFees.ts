import type { IPrivacyDepositFees } from './transactionTypes';

export const PRIVACY_WITHDRAWAL_GAS_LIMIT = 650000;
const UINT256 = BigInt(1) << BigInt(256);
export function privacyFeeQuantity(value: unknown): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('privacy_withdrawal_fee_invalid');
  const text = value?.toString();
  if (
    !text ||
    text.length > 80 ||
    !/^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-f][0-9a-f]*))$/.test(text)
  )
    throw new Error('privacy_withdrawal_fee_invalid');
  const quantity = BigInt(text);
  if (quantity >= UINT256) throw new Error('privacy_withdrawal_fee_invalid');
  return quantity;
}

export function privacyWithdrawalFees(
  fees: {
    gasPrice?: unknown;
    maxFeePerGas?: unknown;
    maxPriorityFeePerGas?: unknown;
  },
  nonce: unknown,
  balance: unknown
): IPrivacyDepositFees {
  const gasLimit = String(PRIVACY_WITHDRAWAL_GAS_LIMIT);
  const base = { gasLimit, nonce: String(privacyFeeQuantity(nonce)) };
  const funds = privacyFeeQuantity(balance);
  if (fees.maxFeePerGas != null && fees.maxPriorityFeePerGas != null) {
    const maximum = privacyFeeQuantity(fees.maxFeePerGas);
    const priority = privacyFeeQuantity(fees.maxPriorityFeePerGas);
    if (!maximum || priority > maximum)
      throw new Error('privacy_withdrawal_fee_invalid');
    if (funds < BigInt(gasLimit) * maximum)
      throw new Error('privacy_withdrawal_insufficient_funds');
    return {
      ...base,
      maxFeePerGas: String(maximum),
      maxPriorityFeePerGas: String(priority),
    };
  }
  const price = privacyFeeQuantity(fees.gasPrice);
  if (!price) throw new Error('privacy_withdrawal_fee_invalid');
  if (funds < BigInt(gasLimit) * price)
    throw new Error('privacy_withdrawal_insufficient_funds');
  return { ...base, gasPrice: String(price) };
}
