import { normalizePublicAddress } from './addresses.ts';
import { assertBaseUnits, parseDecimalAmount } from './amounts.ts';
import { getNetwork } from './networks.ts';
import type { ReviewContext, TransferIntent, TransferReview } from './types.ts';

export function createTransferReview(
  intent: TransferIntent,
  context: ReviewContext,
  balanceUnits: string,
  maximumFeeUnits: string,
  now: number
): TransferReview {
  const network = getNetwork(context.networkId);
  if (network.kind !== 'evm' || network.chainId !== context.chainId)
    throw new Error('Network context changed');
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid clock');
  const recipient = normalizePublicAddress(intent.recipient, network.id);
  const address = normalizePublicAddress(context.address, network.id);
  if (address !== context.address)
    throw new Error('Use the canonical account address');
  const units = parseDecimalAmount(intent.amount, network.decimals);
  const fee = assertBaseUnits(maximumFeeUnits);
  const total = units + fee;
  if (total > assertBaseUnits(balanceUnits))
    throw new Error('Insufficient balance including the maximum fee');
  return Object.freeze({
    context: Object.freeze({ ...context }),
    recipient,
    amountUnits: units.toString(),
    maximumFeeUnits: fee.toString(),
    totalUnits: total.toString(),
    expiresAt: now + 60_000,
  });
}

export function assertReviewCurrent(
  review: TransferReview,
  current: ReviewContext,
  now: number
): void {
  if (!Number.isFinite(now) || now < 0 || now >= review.expiresAt)
    throw new Error('Review expired');
  for (const key of [
    'accountId',
    'address',
    'networkId',
    'chainId',
    'endpoint',
    'generation',
  ] as const) {
    if (review.context[key] !== current[key])
      throw new Error('Wallet context changed. Review again.');
  }
}
