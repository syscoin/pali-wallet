import {
  assertEvmFeeApprovalCurrent,
  assertEvmFeeEstimateApproved,
  assertEvmFeeRefreshApproved,
  bufferEvmFeeEstimate,
  captureEvmFeeApproval,
  EvmFeeEnvelope,
  snapshotEvmFeeEnvelope,
} from './evmFeeApproval';

const envelope: EvmFeeEnvelope = {
  type: 2,
  from: `0x${'11'.repeat(20)}`,
  to: `0x${'22'.repeat(20)}`,
  chainId: '743211',
  nonce: '0',
  value: '1000000000000000001',
  data: '0x',
  gasLimit: '25200',
  maxFeePerGas: '9007199254740999',
  maxPriorityFeePerGas: '0',
};
const capture = (value = envelope, scope = 'fixture', expires = 1000) =>
  captureEvmFeeApproval(value, scope, expires);
const observation = {
  balance: BigInt(1) << BigInt(255),
  estimatedGas: BigInt(21000),
  sampledBlockGasLimit: BigInt(30000000),
  baseFeePerGas: BigInt(1),
};

it('captures exact amounts and explicit zero nonce for a generic chain', () => {
  const approval = capture();
  expect(approval.maximumFeeUnits).toBe(
    (BigInt(envelope.gasLimit) * BigInt('9007199254740999')).toString()
  );
  expect(approval.maximumTotalUnits).toBe(
    (BigInt(approval.maximumFeeUnits) + BigInt(envelope.value)).toString()
  );
  expect(approval.transaction.nonce).toBe('0');
  expect(Object.isFrozen(approval)).toBe(true);
  expect(Object.isFrozen(approval.transaction)).toBe(true);
  const { nonce, ...automaticNonce } = envelope;
  expect(nonce).toBe('0');
  expect(capture(automaticNonce).transaction.nonce).toBeUndefined();
});

it('rejects accessor fields and an unissued copied approval', () => {
  const getter = jest.fn(() => envelope.from);
  const withAccessor = Object.defineProperty({ ...envelope }, 'from', {
    enumerable: true,
    get: getter,
  });
  expect(() => snapshotEvmFeeEnvelope(withAccessor)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => assertEvmFeeApprovalCurrent({ ...capture() }, 10)).toThrow();
});

it('preserves the reviewed envelope and scope through refresh', () => {
  const approved = capture();
  expect(() =>
    assertEvmFeeRefreshApproved(approved, capture(), 999)
  ).not.toThrow();
  for (const changed of [
    { ...envelope, nonce: '1' },
    { ...envelope, value: '1' },
    { ...envelope, to: envelope.from },
    { ...envelope, chainId: '743212' },
    { ...envelope, gasLimit: '25201' },
    { ...envelope, maxFeePerGas: '9007199254741000' },
  ])
    expect(() =>
      assertEvmFeeRefreshApproved(approved, capture(changed), 10)
    ).toThrow();
  expect(() =>
    assertEvmFeeRefreshApproved(
      approved,
      capture(envelope, 'other endpoint'),
      10
    )
  ).toThrow();
});

it('expires both original and refreshed approvals at the exact deadline', () => {
  expect(() =>
    assertEvmFeeRefreshApproved(capture(), capture(), 1000)
  ).toThrow();
  expect(() =>
    assertEvmFeeRefreshApproved(capture(), capture(envelope, 'fixture', 10), 10)
  ).toThrow();
  for (const now of [NaN, -1, 1.5, Infinity])
    expect(() => assertEvmFeeApprovalCurrent(capture(), now)).toThrow();
});

it('rechecks exact final affordability and estimate without raising the approved envelope', () => {
  const approval = capture();
  const balance = BigInt(approval.maximumTotalUnits);
  expect(() =>
    assertEvmFeeEstimateApproved(approval, { ...observation, balance }, 10)
  ).not.toThrow();
  expect(() =>
    assertEvmFeeEstimateApproved(
      approval,
      { ...observation, balance: balance - BigInt(1) },
      10
    )
  ).toThrow('Insufficient funds');
  expect(() =>
    assertEvmFeeEstimateApproved(
      approval,
      { ...observation, estimatedGas: BigInt(25201) },
      10
    )
  ).toThrow('gas limit');
  expect(() =>
    assertEvmFeeEstimateApproved(
      approval,
      { ...observation, sampledBlockGasLimit: BigInt(25199) },
      10
    )
  ).toThrow();
  expect(() =>
    assertEvmFeeEstimateApproved(
      approval,
      { ...observation, baseFeePerGas: BigInt('9007199254741000') },
      10
    )
  ).toThrow('base fee');
  expect(() =>
    assertEvmFeeEstimateApproved(
      approval,
      { ...observation, balance: undefined as never },
      10
    )
  ).toThrow();
});

it('shares the successful-estimate buffer and configured floor exactly', () => {
  expect(bufferEvmFeeEstimate(BigInt(21000), BigInt(743211))).toBe(
    BigInt(25200)
  );
  expect(
    bufferEvmFeeEstimate(
      BigInt(21000),
      BigInt(743211),
      undefined,
      BigInt(35000)
    )
  ).toBe(BigInt(35000));
  expect(
    bufferEvmFeeEstimate(BigInt(21000), BigInt(743211), undefined, BigInt(0))
  ).toBe(BigInt(25200));
  expect(() => bufferEvmFeeEstimate(BigInt(0), BigInt(743211))).toThrow();
  expect(() =>
    bufferEvmFeeEstimate(BigInt(25000), BigInt(743211), BigInt(29000))
  ).toThrow();
});
