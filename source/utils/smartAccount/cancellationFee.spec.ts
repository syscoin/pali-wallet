import {
  assertSmartAccountCancellationPayerFee,
  getSmartAccountCancellationPayerBudget,
} from './cancellationFee';
import { getPaliEntryPointAddress } from './contracts';
import type { SmartAccountControllerFeeReview } from '../../shared/smartAccountControllerAuthority';

const chainId = 1;
const account = '0x' + '22'.repeat(20);
const payer = '0x' + '33'.repeat(20);
const budget = getSmartAccountCancellationPayerBudget({
  chainId,
  blockGasLimit: BigInt(30_000_000),
  operationGas: BigInt(100_000),
  feeRate: BigInt(2),
  prefund: BigInt(50),
  gasTank: false,
});
const review: SmartAccountControllerFeeReview = {
  id: 'review',
  maximumFeeUnits: '300000',
  maximumTotalUnits: '300000',
  validForMs: 500,
  transaction: {
    chainId: String(chainId),
    data: '0xffff',
    from: payer,
    gasLimit: '150000',
    gasPrice: '2',
    to: getPaliEntryPointAddress(chainId),
    type: 0,
    value: '0',
  },
};
const intent = { account, chainId, payer, purpose: 'submit' as const };

it('admits the exact network quote within the approved limit', () => {
  expect(budget.maximumFeeWei).toBe('360000');
  expect(() =>
    assertSmartAccountCancellationPayerFee(review, budget, intent)
  ).not.toThrow();
  expect(() =>
    assertSmartAccountCancellationPayerFee(
      { ...review, maximumFeeUnits: '360001' },
      budget,
      intent
    )
  ).toThrow('Cancellation fee exceeds the reviewed limits');
});

it('requires the approved funding source even when the gross fee is within budget', () => {
  const sponsored = { ...budget, gasTank: true };
  expect(() =>
    assertSmartAccountCancellationPayerFee(review, sponsored, intent)
  ).toThrow();
  expect(() =>
    assertSmartAccountCancellationPayerFee(
      { ...review, coveredFeeUnits: review.maximumFeeUnits },
      sponsored,
      intent
    )
  ).not.toThrow();
});

it('keeps the first-use transfer and its gas fee within their separate bounds', () => {
  const funding: SmartAccountControllerFeeReview = {
    ...review,
    maximumFeeUnits: '50400',
    maximumTotalUnits: '50450',
    transaction: {
      ...review.transaction,
      data: '0x',
      gasLimit: '25200',
      to: account,
      value: '50',
    },
  };
  const fund = { ...intent, purpose: 'fund' as const };
  expect(() =>
    assertSmartAccountCancellationPayerFee(funding, budget, fund)
  ).not.toThrow();
  for (const quote of [
    { ...funding, maximumFeeUnits: '50401' },
    { ...funding, transaction: { ...funding.transaction, value: '51' } },
    { ...funding, transaction: { ...funding.transaction, to: payer } },
  ])
    expect(() =>
      assertSmartAccountCancellationPayerFee(quote, budget, fund)
    ).toThrow();
  expect(() =>
    assertSmartAccountCancellationPayerFee(funding, budget, intent)
  ).toThrow();
});
