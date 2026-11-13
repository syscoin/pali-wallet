import { explorerApiError, isEmptyEvmHistoryResponse } from './evmHistory';

const empty = (message: string) => ({ status: '0', message, result: [] });

it.each(['txlist', 'tokentx'] as const)(
  'accepts the common empty envelope for %s',
  (feed) => {
    const reply = empty('No transactions found');
    expect(isEmptyEvmHistoryResponse(reply, feed)).toBe(true);
    expect(explorerApiError(reply, 200, feed)).toBeUndefined();
  }
);

it('accepts the empty token envelope only for token history', () => {
  const reply = empty('No token transfers found');
  expect(isEmptyEvmHistoryResponse(reply, 'tokentx')).toBe(true);
  expect(explorerApiError(reply, 200, 'tokentx')).toBeUndefined();
  expect(isEmptyEvmHistoryResponse(reply, 'txlist')).toBe(false);
  expect(explorerApiError(reply, 200, 'txlist')).toBe(
    'No token transfers found'
  );
});

it.each([
  null,
  [],
  { status: '0', message: 'No token transfers found', result: '[]' },
  { status: '0', message: 'No token transfers found', result: [{}] },
  { status: 0, message: 'No token transfers found', result: [] },
  empty('NOTOK'),
  empty('OK'),
  empty('Rate limit exceeded'),
])('does not classify malformed or error envelopes as empty: %p', (reply) => {
  expect(isEmptyEvmHistoryResponse(reply, 'tokentx')).toBe(false);
});

it('preserves successful pages and reports unknown API errors', () => {
  for (const result of [[], [{}]]) {
    const reply = { status: '1', message: 'OK', result };
    expect(isEmptyEvmHistoryResponse(reply, 'tokentx')).toBe(false);
    expect(explorerApiError(reply, 200, 'tokentx')).toBeUndefined();
  }
  expect(explorerApiError(empty('NOTOK'), 200, 'tokentx')).toBe('NOTOK');
  expect(explorerApiError(empty('Backend unavailable'), 200, 'tokentx')).toBe(
    'Backend unavailable'
  );
  expect(
    explorerApiError(
      { status: '0', message: 'NOTOK', result: 'Invalid key' },
      200,
      'tokentx'
    )
  ).toBe('Invalid key');
});
