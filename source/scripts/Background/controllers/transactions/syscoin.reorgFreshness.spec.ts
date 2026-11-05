import { mergeFreshBlockbookHistory } from '../../../../shared/blockbookHistoryMerge';
import { UTXO_SUMMARY_OBSERVATION } from '../../../../shared/utxoDetailFreshness';

const fetchBackendAccountCachedMock = jest.fn();
jest.mock('../utils/fetchBackendAccountWrapper', () => ({
  fetchBackendAccountCached: (...args: any[]) =>
    fetchBackendAccountCachedMock(...args),
}));
let vaultState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getState: () => ({ vault: vaultState }) },
}));
import SysTransactionController from './syscoin';
import { treatAndSortTransactions } from './utils';

const TXID = 'ab'.repeat(32);
const OLD_HASH = 'cd'.repeat(32);
const NEW_HASH = 'ef'.repeat(32);
const oldRow = {
  txid: TXID,
  blockHash: OLD_HASH,
  blockHeight: 100,
  confirmations: 3,
  blockTime: 1700000000,
  fees: '226',
  addressValueIn: '6547561',
  addressValueOut: '6547335',
};
const fixture = (prior: any[]) => ({
  activeAccount: { type: 'HDAccount', id: 0 },
  activeNetwork: { chainId: 57 },
  accountTransactions: { HDAccount: { 0: { syscoin: { 57: prior } } } },
});
const load = async (fresh: any, name: string) => {
  vaultState = fixture([oldRow]);
  fetchBackendAccountCachedMock.mockResolvedValueOnce({
    balance: '6547335',
    unconfirmedBalance: fresh.confirmations ? '0' : '6547335',
    txs: 1,
    unconfirmedTxs: fresh.confirmations ? 0 : 1,
    transactions: [fresh],
  });
  const result = await SysTransactionController().pollingSysTransactions(
    'public-account-fixture',
    `https://blockbook.test/${name}`,
    false
  );
  expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
  expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
    `https://blockbook.test/${name}`,
    'public-account-fixture',
    'details=txsummary&pageSize=30',
    true
  );
  expect(result).toHaveLength(1);
  expect(result[0].txid).toBe(TXID);
  expect(result[0].fees).toBe('226');
  expect(result[0].addressValueIn).toBe('6547561');
  expect(result[0].addressValueOut).toBe('6547335');
  return result[0];
};
beforeEach(() => fetchBackendAccountCachedMock.mockReset());
it('control: ordinary higher-confirmation fresh Blockbook row wins', async () => {
  const fresh = { ...oldRow, confirmations: 4 };
  expect((await load(fresh, 'healthy')).confirmations).toBe(4);
});
it('current controller must retain fresh reorg placement rather than the older cached block', async () => {
  const fresh = {
    ...oldRow,
    blockHash: NEW_HASH,
    blockHeight: 101,
    confirmations: 2,
  };
  const result = await load(fresh, 'reorg');
  expect(result.blockHash).toBe(NEW_HASH);
  expect(result.blockHeight).toBe(101);
  expect(result.confirmations).toBe(2);
});
it('current controller must retain fresh pending demotion rather than the older cached mined state', async () => {
  const fresh = {
    ...oldRow,
    blockHash: undefined,
    blockHeight: -1,
    confirmations: 0,
  };
  const result = await load(fresh, 'pending');
  expect(result.confirmations).toBe(0);
  expect(result.blockHeight).toBe(-1);
  expect(result.blockHash).toBeUndefined();
});
it('control: existing representative selector expects cached rows before fresh reorg rows', () => {
  const fresh = {
    ...oldRow,
    blockHash: NEW_HASH,
    blockHeight: 101,
    confirmations: 2,
  };
  const [result] = treatAndSortTransactions([oldRow, fresh] as any) as any[];
  expect(result.blockHash).toBe(NEW_HASH);
});
it('control: reversing order alone still fails to demote a cached mined transaction', () => {
  const pending = {
    ...oldRow,
    blockHash: undefined,
    blockHeight: -1,
    confirmations: 0,
  };
  const [result] = treatAndSortTransactions([oldRow, pending] as any) as any[];
  expect(result.blockHeight).toBe(100);
  expect(result.confirmations).toBe(3);
});

describe('shared fresh Blockbook row merge', () => {
  it('uses the existing case-insensitive txid identity without mixing stale block or amount fields', () => {
    const fresh = Object.freeze({ txid: TXID.toUpperCase(), confirmations: 0 });
    const retained = Object.freeze({ ...oldRow, cachedOnly: true });
    const freshRows = Object.freeze([fresh]);
    const retainedRows = Object.freeze([retained]);
    const merged = mergeFreshBlockbookHistory<{
      confirmations: number;
      txid: string;
    }>(freshRows, retainedRows);
    expect(merged).toEqual([fresh]);
    expect(merged[0]).toBe(fresh);
    expect(merged[0]).not.toHaveProperty('cachedOnly');
    expect(merged[0]).not.toHaveProperty('blockHash');
    expect(merged[0]).not.toHaveProperty('addressValueIn');
    expect(retainedRows[0]).toEqual({ ...oldRow, cachedOnly: true });
  });
  it('retains unmatched cached rows and their relative order', () => {
    const fresh = { ...oldRow, confirmations: 0 };
    const first = { ...oldRow, txid: '12'.repeat(32) };
    const second = { ...oldRow, txid: '34'.repeat(32) };
    expect(
      mergeFreshBlockbookHistory([fresh], [first, oldRow, second])
    ).toEqual([fresh, first, second]);
  });
  it('leaves within-source duplicates to the unchanged representative selector', () => {
    const fresh = { ...oldRow, confirmations: 2 };
    const otherFresh = {
      ...oldRow,
      txid: TXID.toUpperCase(),
      confirmations: 4,
    };
    const other = { ...oldRow, txid: '12'.repeat(32) };
    const merged = mergeFreshBlockbookHistory(
      [fresh, otherFresh],
      [oldRow, other, other]
    );
    expect(merged).toEqual([fresh, otherFresh, other, other]);
    const result = treatAndSortTransactions(merged as any) as any[];
    expect(result).toHaveLength(2);
    expect(result.find((row) => row.txid.toLowerCase() === TXID)).toStrictEqual(
      otherFresh
    );
  });
  it('returns a separate array without mutating empty-fresh retained input', () => {
    const retained = Object.freeze([Object.freeze(oldRow)]);
    const result = mergeFreshBlockbookHistory([], retained);
    expect(result).toEqual(retained);
    expect(result).not.toBe(retained);
    expect(result[0]).toBe(retained[0]);
  });
  it('preserves existing pending-first sorting and output limits after merging', () => {
    const pending = { ...oldRow, confirmations: 0, blockHeight: -1 };
    const other = { ...oldRow, txid: '12'.repeat(32), confirmations: 8 };
    const merged = mergeFreshBlockbookHistory([pending], [oldRow, other]);
    expect(treatAndSortTransactions(merged as any, 1)).toEqual([pending]);
    expect(merged).toEqual([pending, other]);
  });
  it('accepts a fresh lower confirmation observation without inventing new placement data', async () => {
    const fresh = { ...oldRow, confirmations: 2 };
    const result = await load(fresh, 'lower-confirmations');
    expect(result.confirmations).toBe(2);
    expect(result.blockHash).toBe(OLD_HASH);
    expect(result.blockHeight).toBe(100);
  });
});

describe('alternate retained rows already accepted by the existing selector', () => {
  const cachedHash = '12'.repeat(32);
  const cachedBody: Partial<typeof oldRow> = { ...oldRow };
  delete cachedBody.txid;
  const shapes = [
    { name: 'hash-only', row: { ...cachedBody, hash: cachedHash } },
    {
      name: 'undefined txid',
      row: { ...cachedBody, hash: cachedHash, txid: undefined },
    },
    { name: 'numeric txid', row: { ...cachedBody, hash: cachedHash, txid: 7 } },
  ];
  it.each(shapes)(
    'helper preserves $name without inventing a transaction ID',
    ({ row }) => {
      const fresh = { ...oldRow, confirmations: 4 };
      expect(treatAndSortTransactions([fresh, row] as any)).toHaveLength(2);
      const cached = Object.freeze(row);
      const result = mergeFreshBlockbookHistory(
        [fresh] as any[],
        [cached] as any[]
      );
      expect(result).toEqual([fresh, cached]);
      expect(result[1]).toBe(cached);
    }
  );
  it.each(shapes)(
    'controller still returns fresh and retained $name rows',
    async ({ name, row }) => {
      const fresh = { ...oldRow, confirmations: 4 };
      vaultState = fixture([row]);
      fetchBackendAccountCachedMock.mockResolvedValueOnce({
        balance: '6547335',
        unconfirmedBalance: '0',
        txs: 1,
        unconfirmedTxs: 0,
        transactions: [fresh],
      });
      const url = `https://blockbook.test/retained-${name.replaceAll(
        ' ',
        '-'
      )}`;
      const result = await SysTransactionController().pollingSysTransactions(
        'public-account-fixture',
        url,
        false
      );
      expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
      expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
        url,
        'public-account-fixture',
        'details=txsummary&pageSize=30',
        true
      );
      expect(result).toHaveLength(2);
      expect(result.find((item: any) => item.txid === TXID)).toEqual({
        ...fresh,
        [UTXO_SUMMARY_OBSERVATION]: expect.stringMatching(
          /^[0-9a-f]{32}:[1-9]\d*$/
        ),
      });
      expect(fresh).not.toHaveProperty(UTXO_SUMMARY_OBSERVATION);
      expect(result.find((item: any) => item.hash === cachedHash)).toEqual(row);
    }
  );
});
