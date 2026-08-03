import {
  EVM_TRANSACTION_HISTORY_SOURCE,
  getEoaNonceFromHistoryTransaction,
  needsEoaNonceHistoryVerification,
  parseEvmInteger,
} from './evmNonce';

const ADDRESS = '0x6781dd2b72002f1fb37E7415479cBF5ffE828BfB';

describe('EOA nonce history filtering', () => {
  it('accepts a standard outgoing EOA transaction', () => {
    expect(
      getEoaNonceFromHistoryTransaction(
        { from: ADDRESS.toLowerCase(), nonce: '0x2', type: '0x2' },
        ADDRESS
      )
    ).toBe(2);
  });

  it('rejects rows without the exact EOA sender', () => {
    expect(getEoaNonceFromHistoryTransaction({ nonce: 9 }, ADDRESS)).toBe(
      undefined
    );
    expect(
      getEoaNonceFromHistoryTransaction(
        { from: '0x0000000000000000000000000000000000000001', nonce: 9 },
        ADDRESS
      )
    ).toBe(undefined);
  });

  it('rejects explorer token-transfer event placeholders', () => {
    expect(
      getEoaNonceFromHistoryTransaction(
        {
          from: ADDRESS,
          historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
          nonce: 847,
        },
        ADDRESS
      )
    ).toBe(undefined);
  });

  it('rejects zkSYS L1-to-L2 priority operations', () => {
    expect(
      getEoaNonceFromHistoryTransaction(
        { from: ADDRESS, nonce: 133, type: '0x7f' },
        ADDRESS
      )
    ).toBe(undefined);
    expect(
      getEoaNonceFromHistoryTransaction(
        {
          from: ADDRESS,
          nonce: 133,
          r: `0x${'0'.repeat(64)}`,
          s: `0x${'0'.repeat(64)}`,
          v: '0x0',
        },
        ADDRESS
      )
    ).toBe(undefined);
  });

  it('rejects synthetic smart-account display transactions', () => {
    expect(
      getEoaNonceFromHistoryTransaction(
        {
          from: ADDRESS,
          nonce: 14,
          smartAccountExecutionFrom: ADDRESS,
          type: 2,
        },
        ADDRESS
      )
    ).toBe(undefined);
  });

  it('recognizes legacy persisted rows that require verification', () => {
    expect(
      needsEoaNonceHistoryVerification({ from: ADDRESS, nonce: 133 })
    ).toBe(true);
    expect(
      needsEoaNonceHistoryVerification({
        from: ADDRESS,
        historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
        nonce: 133,
      })
    ).toBe(true);
    expect(
      needsEoaNonceHistoryVerification({
        from: ADDRESS,
        historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
        nonce: 1,
        type: 2,
      })
    ).toBe(false);
  });

  it('parses decimal and hexadecimal EVM quantities safely', () => {
    expect(parseEvmInteger('0x7f')).toBe(127);
    expect(parseEvmInteger('133')).toBe(133);
    expect(parseEvmInteger(-1)).toBe(undefined);
    expect(parseEvmInteger('not-a-number')).toBe(undefined);
  });
});
