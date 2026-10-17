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

it.each([
  [
    'same-row hexadecimal',
    `${'11'.repeat(32)} | ${'11'.repeat(32)}`,
    'bls-basic',
  ],
  [
    'cross-row hexadecimal',
    `${'22'.repeat(32)} | ${'11'.repeat(32)}\nBeta | ${'22'.repeat(32)}`,
    'bls-basic',
  ],
  [
    'prefixed hexadecimal',
    `0x${'AA'.repeat(32)} | ${'11'.repeat(32)}`,
    'bls-basic',
  ],
  [
    'same-row WIF',
    'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn | KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn',
    'secp256k1',
  ],
  [
    'cross-row WIF',
    `KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4 | KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn\nBeta | KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4`,
    'secp256k1',
  ],
] as const)(
  'never exposes a %s private key in a preview label',
  (_name, text, scheme) => {
    const result = parseSentryKeyBatch(text, scheme);
    expect(result.issues).toContainEqual({ line: 1, reason: 'label' });
    expect(result.entries.every((entry) => entry.label === 'Beta')).toBe(true);
    expect(
      result.issues.every(
        (issue) => Object.keys(issue).join(',') === 'line,reason'
      )
    ).toBe(true);
  }
);
