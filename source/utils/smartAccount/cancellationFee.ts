import { selectEvmDappGasLimit } from '../../shared/evmDappFeePolicy.ts';
import { EVM_NATIVE_INTRINSIC_GAS } from '../../shared/evmTransferCost.ts';

import { getPaliEntryPointAddress } from './contracts.ts';
import type { SmartAccountControllerFeeReview } from '../../shared/smartAccountControllerAuthority';
import type { SmartAccountPayerBudget } from '../../shared/smartAccountFeeQuote';

// The unsigned operation supplies the inner gas allowances. Leave room for
// EntryPoint overhead and calldata, then apply the wallet's normal margin.
// The exact signed transaction still has to fit the reviewed ceiling.
const ENTRY_POINT_OUTER_GAS_ALLOWANCE = BigInt(50_000);

export function getSmartAccountPayerBudget({
  chainId,
  blockGasLimit,
  operationGas,
  feeRate,
  prefund,
  gasTank,
}: {
  blockGasLimit: bigint;
  chainId: number;
  feeRate: bigint;
  gasTank: boolean;
  operationGas: bigint;
  prefund: bigint;
}): SmartAccountPayerBudget {
  const withMargin = (gas: bigint) =>
    selectEvmDappGasLimit(gas, undefined, BigInt(chainId), blockGasLimit);
  const outerGas = withMargin(operationGas + ENTRY_POINT_OUTER_GAS_ALLOWANCE);
  return Object.freeze({
    gasTank,
    maximumFeeWei: (outerGas * feeRate).toString(),
    maximumPrefundWei: prefund.toString(),
    maximumPrefundFeeWei:
      prefund === BigInt(0)
        ? '0'
        : (withMargin(EVM_NATIVE_INTRINSIC_GAS) * feeRate).toString(),
  });
}

/** Admit a controller-issued exact quote under the reviewed payer limits. */
export function assertSmartAccountPayerFee(
  review: Pick<
    SmartAccountControllerFeeReview,
    'transaction' | 'maximumFeeUnits' | 'coveredFeeUnits'
  >,
  budget: SmartAccountPayerBudget,
  intent: {
    account: string;
    chainId: number;
    payer: string;
    purpose: 'submit' | 'fund';
  },
  refusalMessage = 'Cancellation fee exceeds the reviewed limits'
) {
  const { transaction } = review;
  const funding = intent.purpose === 'fund';
  const value = BigInt(transaction.value);
  const fee = BigInt(review.maximumFeeUnits);
  const covered = BigInt(review.coveredFeeUnits ?? '0');
  const destination = funding
    ? intent.account
    : getPaliEntryPointAddress(intent.chainId);
  const validValue = funding
    ? transaction.data === '0x' &&
      value > BigInt(0) &&
      value <= BigInt(budget.maximumPrefundWei)
    : value === BigInt(0);
  if (
    transaction.chainId !== String(intent.chainId) ||
    transaction.from.toLowerCase() !== intent.payer.toLowerCase() ||
    transaction.to?.toLowerCase() !== destination.toLowerCase() ||
    !validValue ||
    fee < BigInt(0) ||
    fee >
      BigInt(funding ? budget.maximumPrefundFeeWei : budget.maximumFeeWei) ||
    covered !== (!funding && budget.gasTank ? fee : BigInt(0))
  )
    throw Object.assign(new Error(refusalMessage), {
      transactionNotBroadcast: true,
    });
}
