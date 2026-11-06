import {
  normalizeSentryKeyImportEntries,
  parseSentryKeyBatch,
} from './importBatch';

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

it('supplies the official SDK canonical hex without a text prefix and delegates only WIF decoding', () => {
  const raw = 'AB'.repeat(32);
  const decode = jest.fn(() => raw);
  expect(
    normalizeSentryKeyImportEntries(
      [
        { label: ' Hex ', secretKey: '0x' + raw },
        { label: 'WIF', secretKey: 'synthetic-wif' },
      ],
      'secp256k1',
      decode
    )
  ).toEqual([
    { label: 'Hex', secretKey: raw.toLowerCase() },
    { label: 'WIF', secretKey: raw.toLowerCase() },
  ]);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledWith('synthetic-wif');
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

it('rejects an 80-character label containing the first SHAKE secret seed bytes', () => {
  const secretKey =
    '13ab'.repeat(8) + '24bc'.repeat(8) + '35cd'.repeat(8) + '46de'.repeat(8);
  const label = (
    'Sentry operator for node one at home 0x' + secretKey.toUpperCase()
  ).slice(0, 80);
  expect(label).toHaveLength(80);
  expect(label).toContain(secretKey.slice(0, 32).toUpperCase());
  const result = parseSentryKeyBatch(
    `${label} | 0x${secretKey}`,
    'slh-dsa-shake-128s'
  );
  expect(result).toEqual({
    entries: [],
    issues: [{ line: 1, reason: 'label' }],
  });
  expect(() =>
    normalizeSentryKeyImportEntries(
      [{ label, secretKey: '0x' + secretKey }],
      'slh-dsa-shake-128s',
      jest.fn()
    )
  ).toThrow('Key labels must not contain private keys');
  const crossRow = parseSentryKeyBatch(
    `${label} | ${'57ab'.repeat(32)}
Node two | 0x${secretKey}`,
    'slh-dsa-shake-128s'
  );
  expect(crossRow.issues).toEqual([{ line: 1, reason: 'label' }]);
  expect(crossRow.entries.map(({ label: safeLabel }) => safeLabel)).toEqual([
    'Node two',
  ]);
  expect(
    parseSentryKeyBatch(
      `Sentry operator ${secretKey
        .slice(64, 96)
        .toUpperCase()} | 0x${secretKey}`,
      'slh-dsa-shake-128s'
    ).issues
  ).toEqual([]);
});

it('keeps the SHAKE private randomizer out of cross-row labels but allows a public component', () => {
  const secretKey =
    '13'.repeat(16) + '24'.repeat(16) + '35'.repeat(16) + '46'.repeat(16);
  const label = `Node ${secretKey.slice(32, 64)}`;
  const publicLabel = `Node ${secretKey.slice(64, 96)}`;
  const result = parseSentryKeyBatch(
    `${label} | ${'57ab'.repeat(32)}
${publicLabel} | 0x${secretKey}`,
    'slh-dsa-shake-128s'
  );
  expect(result.issues).toEqual([{ line: 1, reason: 'label' }]);
  expect(result.entries.map((entry) => entry.label)).toEqual([publicLabel]);
  expect(() =>
    normalizeSentryKeyImportEntries(
      [{ label, secretKey }],
      'slh-dsa-shake-128s',
      jest.fn()
    )
  ).toThrow('Key labels must not contain private keys');
});

it.each([
  ['uppercase prefix', (secret: string) => `Other | 0X${secret}`, 'key'],
  ['extra field', (secret: string) => `Other | ${secret} | extra`, 'format'],
] as const)(
  'never previews a secret component from a row with %s',
  (_name, row, reason) => {
    const secret =
      '13'.repeat(16) + '24'.repeat(16) + '35'.repeat(16) + '46'.repeat(16);
    const distinctKey = '57ab'.repeat(32);
    const result = parseSentryKeyBatch(
      `Node ${secret.slice(32, 64)} | ${distinctKey}
${row(secret)}`,
      'slh-dsa-shake-128s'
    );
    expect(result).toEqual({
      entries: [],
      issues: [
        { line: 1, reason: 'label' },
        { line: 2, reason },
      ],
    });
  }
);
