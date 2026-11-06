import { captureReviewedNativeEvmTransfer } from './freshNativeGasEstimate';
import {
  consumeNativeEvmFeeReview,
  discardNativeEvmFeeReview,
  issueNativeEvmFeeReview,
} from './nativeEvmFeeReviews';

const from = `0x${'11'.repeat(20)}`,
  to = `0x${'22'.repeat(20)}`;
const params = {
  from,
  to,
  value: '1',
  data: '0x',
  gasLimit: '25200',
  gasPrice: '10',
};
const capture = () =>
  captureReviewedNativeEvmTransfer(
    params,
    true,
    '252000',
    from,
    743211,
    {},
    'scope',
    0
  );

it('consumes the background-owned review once and rejects another owner', () => {
  const owner = {},
    other = {},
    guard = jest.fn();
  const proof = issueNativeEvmFeeReview(
    owner,
    capture(),
    guard,
    0,
    () => 'review'
  );
  expect(proof).toEqual({
    id: 'review',
    maximumFee: '252000',
    validForMs: 90000,
  });
  expect(() => consumeNativeEvmFeeReview(other, proof.id, 1)).toThrow();
  expect(
    consumeNativeEvmFeeReview(owner, proof.id, 1).review.approval
      .maximumFeeUnits
  ).toBe('252000');
  expect(() => consumeNativeEvmFeeReview(owner, proof.id, 1)).toThrow();
});

it('rejects expired or revoked captured context without allowing replay', () => {
  const owner = {};
  const guard = jest.fn();
  issueNativeEvmFeeReview(owner, capture(), guard, 0, () => 'expired');
  expect(() => consumeNativeEvmFeeReview(owner, 'expired', 90000)).toThrow();
  expect(() => consumeNativeEvmFeeReview(owner, 'expired', 1)).toThrow();
  issueNativeEvmFeeReview(owner, capture(), guard, 0, () => 'stale');
  guard.mockImplementation(() => {
    throw new Error('Account or network changed');
  });
  expect(() => consumeNativeEvmFeeReview(owner, 'stale', 1)).toThrow(
    'Account or network changed'
  );
  expect(() => consumeNativeEvmFeeReview(owner, 'stale', 1)).toThrow(
    'unavailable'
  );
});

it('discards edits and bounds pending background reviews', () => {
  const owner = {},
    guard = () => undefined;
  for (let index = 0; index < 9; index++)
    issueNativeEvmFeeReview(owner, capture(), guard, 0, () => String(index));
  expect(() => consumeNativeEvmFeeReview(owner, '0', 1)).toThrow();
  discardNativeEvmFeeReview(owner, '8');
  expect(() => consumeNativeEvmFeeReview(owner, '8', 1)).toThrow();
  expect(consumeNativeEvmFeeReview(owner, '7', 1)).toBeDefined();
});

it.each([
  () => false,
  () => Promise.resolve(),
  () => Promise.reject(new Error('late failure')),
])('rejects non-synchronous-void guards at issue and consume', (guard) => {
  const owner = {};
  expect(() =>
    issueNativeEvmFeeReview(
      owner,
      capture(),
      guard as () => void,
      0,
      () => 'invalid'
    )
  ).toThrow('synchronous');
  let invalid = false;
  const changingGuard = () => (invalid ? guard() : undefined);
  issueNativeEvmFeeReview(
    owner,
    capture(),
    changingGuard as () => void,
    0,
    () => 'changed'
  );
  invalid = true;
  expect(() => consumeNativeEvmFeeReview(owner, 'changed', 1)).toThrow(
    'synchronous'
  );
});
