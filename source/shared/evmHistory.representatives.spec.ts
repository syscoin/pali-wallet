import {
  mapEvmExplorerTokenTransfer,
  mapEvmExplorerTransaction,
  mergeEvmExplorerTransactions,
  selectEvmHistoryRepresentatives,
} from './evmHistory';

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
