import {
  CALLS_STATUS_CONFIRMED,
  CALLS_STATUS_OFFCHAIN_FAILURE,
  CALLS_STATUS_PARTIALLY_REVERTED,
  CALLS_STATUS_PENDING,
  CALLS_STATUS_REVERTED,
  computeCallsStatusCode,
} from './sendCallsBatch';

describe('computeCallsStatusCode', () => {
  it('is pending when no tx hashes have been recorded yet', () => {
    expect(
      computeCallsStatusCode({
        atomic: true,
        smartAccount: true,
        receiptStatuses: [],
      })
    ).toBe(CALLS_STATUS_PENDING);
  });

  it('reports offchain failure when nothing broadcast and the batch failed', () => {
    expect(
      computeCallsStatusCode({
        atomic: false,
        smartAccount: false,
        receiptStatuses: [],
        someCallsFailedToBroadcast: true,
      })
    ).toBe(CALLS_STATUS_OFFCHAIN_FAILURE);
  });

  it('reports partial revert when broadcast txs succeeded but some calls never broadcast', () => {
    expect(
      computeCallsStatusCode({
        atomic: false,
        smartAccount: false,
        receiptStatuses: ['0x1'],
        someCallsFailedToBroadcast: true,
      })
    ).toBe(CALLS_STATUS_PARTIALLY_REVERTED);
  });

  it('is pending while any tx is unmined', () => {
    expect(
      computeCallsStatusCode({
        atomic: false,
        smartAccount: false,
        receiptStatuses: ['0x1', null],
      })
    ).toBe(CALLS_STATUS_PENDING);
  });

  it('confirms a smart-account batch when the inner op succeeded', () => {
    expect(
      computeCallsStatusCode({
        atomic: true,
        smartAccount: true,
        receiptStatuses: ['0x1'],
        smartAccountInnerSuccess: true,
      })
    ).toBe(CALLS_STATUS_CONFIRMED);
  });

  it('reverts a smart-account batch when the inner op reverted despite a mined outer tx', () => {
    expect(
      computeCallsStatusCode({
        atomic: true,
        smartAccount: true,
        receiptStatuses: ['0x1'],
        smartAccountInnerSuccess: false,
      })
    ).toBe(CALLS_STATUS_REVERTED);
  });

  it('stays pending for a smart-account batch until inner success is known', () => {
    expect(
      computeCallsStatusCode({
        atomic: true,
        smartAccount: true,
        receiptStatuses: ['0x1'],
      })
    ).toBe(CALLS_STATUS_PENDING);
  });

  it('confirms an EOA batch when all txs succeeded', () => {
    expect(
      computeCallsStatusCode({
        atomic: false,
        smartAccount: false,
        receiptStatuses: ['0x1', '0x1'],
      })
    ).toBe(CALLS_STATUS_CONFIRMED);
  });

  it('reports partial revert for a mixed non-atomic batch', () => {
    expect(
      computeCallsStatusCode({
        atomic: false,
        smartAccount: false,
        receiptStatuses: ['0x1', '0x0'],
      })
    ).toBe(CALLS_STATUS_PARTIALLY_REVERTED);
  });

  it('reports full revert for a mixed atomic batch', () => {
    expect(
      computeCallsStatusCode({
        atomic: true,
        smartAccount: false,
        receiptStatuses: ['0x1', '0x0'],
      })
    ).toBe(CALLS_STATUS_REVERTED);
  });
});
