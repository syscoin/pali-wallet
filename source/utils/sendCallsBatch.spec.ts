import {
  CALLS_STATUS_CONFIRMED,
  CALLS_STATUS_PARTIALLY_REVERTED,
  CALLS_STATUS_PENDING,
  CALLS_STATUS_REVERTED,
  computeCallsStatusCode,
  decodeSendCallsBatchId,
  encodeSendCallsBatchId,
} from './sendCallsBatch';

const TX_A =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TX_B =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('sendCallsBatch id encoding', () => {
  it('round-trips a smart-account atomic batch with one tx hash', () => {
    const id = encodeSendCallsBatchId({
      atomic: true,
      chainId: 57057,
      smartAccount: true,
      txHashes: [TX_A],
    });
    expect(decodeSendCallsBatchId(id)).toEqual({
      atomic: true,
      chainId: 57057,
      smartAccount: true,
      txHashes: [TX_A],
    });
  });

  it('round-trips a non-atomic EOA batch with multiple tx hashes', () => {
    const id = encodeSendCallsBatchId({
      atomic: false,
      chainId: 1,
      smartAccount: false,
      txHashes: [TX_A, TX_B],
    });
    expect(decodeSendCallsBatchId(id)).toEqual({
      atomic: false,
      chainId: 1,
      smartAccount: false,
      txHashes: [TX_A, TX_B],
    });
  });

  it('rejects empty tx hash lists when encoding', () => {
    expect(() =>
      encodeSendCallsBatchId({
        atomic: true,
        chainId: 1,
        smartAccount: true,
        txHashes: [],
      })
    ).toThrow();
  });

  it('returns null for ids not minted by Pali', () => {
    // Random 32-byte id (e.g. another wallet's bundle id).
    expect(decodeSendCallsBatchId(`0x${'12'.repeat(32)}`)).toBeNull();
    expect(decodeSendCallsBatchId('not-hex')).toBeNull();
    expect(decodeSendCallsBatchId('0x01')).toBeNull();
  });
});

describe('computeCallsStatusCode', () => {
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
