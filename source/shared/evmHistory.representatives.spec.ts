/* eslint-disable camelcase -- Ethereum RPC fixture fields. */
import {
  mapEvmExplorerTokenTransfer,
  mapEvmExplorerTransaction,
  mergeEvmExplorerTransactions,
  markEvmHistoryOrphaned,
  markEvmSmartOutcome,
  selectEvmHistoryRepresentatives,
} from './evmHistory';

it('replaces only the exact orphaned placement and preserves a concurrent remine', () => {
  const mined = {
    hash: `0x${'ab'.repeat(32)}`,
    from: 'sender',
    nonce: 1,
    blockNumber: 99,
    blockHash: `0x${'cd'.repeat(32)}`,
    confirmations: 3,
  };
  const orphaned = markEvmHistoryOrphaned(mined);
  expect(
    selectEvmHistoryRepresentatives([mined, { ...orphaned }])[0]
  ).toMatchObject({ blockNumber: null, confirmations: 0 });
  const remined = {
    ...mined,
    blockNumber: 101,
    blockHash: `0x${'ee'.repeat(32)}`,
    confirmations: 1,
  };
  expect(selectEvmHistoryRepresentatives([remined, orphaned])).toEqual([
    remined,
  ]);
  expect(JSON.stringify(orphaned)).not.toContain('orphanedPlacement');
});

const SENDER = `0x${'11'.repeat(20)}`;
const OWNER = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const indexed = (id: string, confirmations = '1') => ({
  hash: hash(id),
  from: SENDER,
  to: OWNER,
  contractAddress: TOKEN,
  value: '1000000',
  tokenDecimal: '6',
  tokenSymbol: 'TOK',
  nonce: '7',
  blockNumber: '123',
  confirmations,
  timeStamp: '1700000000',
  input: '0x',
});

it.each([95, 96])(
  'retains verified inner failure against outer success at %s confirmations',
  (confirmations) => {
    const outer = {
      ...mapEvmExplorerTransaction(indexed('a', '95'), 1),
      blockHash: hash('b'),
      blockNumber: 5,
      isError: '0',
      txreceipt_status: '1',
      smartAccountExecutionFrom: OWNER,
    };
    const inner = markEvmSmartOutcome(
      {
        ...outer,
        smartAccountExecution: true,
        isError: '1',
        txreceipt_status: '0',
      },
      false,
      OWNER
    );
    const verified = selectEvmHistoryRepresentatives([outer, inner]);
    expect(verified[0]).toMatchObject({
      isError: '1',
      txreceipt_status: '0',
      smartAccountExecution: true,
    });
    expect(
      selectEvmHistoryRepresentatives([
        verified[0],
        { ...outer, confirmations },
      ])[0]
    ).toMatchObject({ isError: '1', txreceipt_status: '0' });
  }
);

it('does not apply a Smart outcome to another account or a remine', () => {
  const row = {
    ...mapEvmExplorerTransaction(indexed('a', '95'), 1),
    blockHash: hash('b'),
    blockNumber: 5,
    smartAccountExecutionFrom: OWNER,
  };
  const marked = markEvmSmartOutcome(row, false, OWNER);
  for (const changed of [
    { smartAccountExecutionFrom: SENDER },
    { blockHash: hash('c'), blockNumber: 6 },
  ]) {
    const result = selectEvmHistoryRepresentatives([
      { ...marked, ...changed, isError: '0', txreceipt_status: '1' },
    ]);
    expect(result[0]).toMatchObject({ isError: '0', txreceipt_status: '1' });
  }
});

it('keeps distinct token-event hashes when an event sender and outer transaction nonce happen to match', () => {
  const rows = ['a', 'b'].map((id) =>
    mapEvmExplorerTokenTransfer(indexed(id), 1)
  );
  expect(rows.map((row) => row.nonce)).toEqual([7, 7]);
  expect(
    selectEvmHistoryRepresentatives(rows)
      .map((row) => row.hash)
      .sort()
  ).toEqual([hash('a'), hash('b')]);
});

it('still deduplicates token-event versions by hash', () => {
  const first = mapEvmExplorerTokenTransfer(indexed('a'), 1);
  const refreshed = mapEvmExplorerTokenTransfer(indexed('a', '2'), 1);
  expect(selectEvmHistoryRepresentatives([first, refreshed])).toEqual([
    refreshed,
  ]);
});

it('keeps outer transaction replacement grouping while token-event placeholders remain separate', () => {
  const pending = mapEvmExplorerTransaction(
    { ...indexed('a', '0'), blockNumber: '0' },
    1
  );
  const mined = mapEvmExplorerTransaction(indexed('b', '2'), 1);
  const event = mapEvmExplorerTokenTransfer(indexed('c'), 1);
  expect(
    selectEvmHistoryRepresentatives([pending, mined, event])
      .map((row) => row.hash)
      .sort()
  ).toEqual([hash('b'), hash('c')]);
});

it('uses the real outer body for the same hash before grouping its EOA nonce', () => {
  const event = indexed('a');
  const body = mapEvmExplorerTransaction(
    { ...event, from: OWNER, to: TOKEN },
    1
  );
  const replacement = mapEvmExplorerTransaction(
    { ...event, hash: hash('b'), from: OWNER, to: TOKEN, confirmations: '2' },
    1
  );
  const merged = mergeEvmExplorerTransactions(
    [body, replacement],
    [event],
    1,
    true
  );
  expect(merged.find((row) => row.hash === hash('a'))?.historySource).toBe(
    'explorer-txlist'
  );
  expect(selectEvmHistoryRepresentatives(merged)).toEqual([replacement]);
});

it('preserves a nonce/from representative without requiring a hash for the optional promotion index', () => {
  const row = { from: SENDER, nonce: 7, confirmations: 0 };
  expect(selectEvmHistoryRepresentatives([row])).toEqual([row]);
});
