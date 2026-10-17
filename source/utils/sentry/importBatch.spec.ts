import { parseSentryKeyBatch } from './importBatch';

it('accepts optional labels and ignores blank lines without exposing keys in errors', () => {
  const result = parseSentryKeyBatch(
    `First | ${'11'.repeat(32)}\n\n${'22'.repeat(32)}`,
    'bls-basic',
    'Node'
  );
  expect(result.issues).toEqual([]);
  expect(result.entries.map(({ label, line }) => ({ label, line }))).toEqual([
    { label: 'First', line: 1 },
    { label: 'Node 2', line: 3 },
  ]);
});
it('validates each line and detects normalized duplicate hex keys', () => {
  const result = parseSentryKeyBatch(
    `One | 0x${'AA'.repeat(32)}\nTwo | ${'aa'.repeat(
      32
    )}\nBad | invalid-secret`,
    'bls-basic'
  );
  expect(result.issues).toEqual([
    { line: 2, reason: 'duplicate' },
    { line: 3, reason: 'key' },
  ]);
  expect(JSON.stringify(result.issues)).not.toContain('invalid-secret');
});
it('enforces format, label, selected scheme and twenty-key bounds', () => {
  expect(parseSentryKeyBatch('a|b|c', 'bls-basic').issues[0].reason).toBe(
    'format'
  );
  expect(
    parseSentryKeyBatch(`${'x'.repeat(81)} | ${'11'.repeat(32)}`, 'bls-basic')
      .issues[0].reason
  ).toBe('label');
  expect(
    parseSentryKeyBatch('11'.repeat(32), 'slh-dsa-shake-128s').issues[0].reason
  ).toBe('key');
  const rows = Array.from({ length: 21 }, (_, i) =>
    (i + 1).toString(16).padStart(64, '0')
  ).join('\n');
  const result = parseSentryKeyBatch(rows, 'bls-basic');
  expect(result.entries).toHaveLength(20);
  expect(result.issues).toEqual([{ line: 21, reason: 'limit' }]);
});
