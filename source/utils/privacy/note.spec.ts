import vectors from '../../../tests/fixtures/privacy/classic-note-vectors.json';

import { generateClassicNote, identifyClassicNote } from './note';

const preimage = '00'.repeat(62);
const note = `tornado-eth-1-1-0x${preimage}`;

it.each(['eth-0.1', 'eth-1', 'eth-10', 'eth-100'] as const)(
  'generates a canonical %s bearer note and clears temporary entropy',
  (poolId) => {
    let entropy: Uint8Array | undefined;
    const generated = generateClassicNote(poolId, (bytes) => {
      entropy = bytes;
      bytes.set(Array.from({ length: 62 }, (_, index) => index));
    });
    expect(identifyClassicNote(generated).poolId).toBe(poolId);
    expect(
      generated.endsWith(
        Array.from({ length: 62 }, (_, index) =>
          index.toString(16).padStart(2, '0')
        ).join('')
      )
    ).toBe(true);
    expect(entropy).toEqual(new Uint8Array(62));
  }
);

it('clears temporary entropy when generation fails and rejects unknown pools before randomness', () => {
  let entropy: Uint8Array | undefined;
  const random = jest.fn((bytes: Uint8Array) => {
    entropy = bytes;
    bytes.fill(7);
    throw new Error('Synthetic entropy unavailable');
  });
  expect(() => generateClassicNote('eth-1', random)).toThrow(
    'Synthetic entropy unavailable'
  );
  expect(entropy).toEqual(new Uint8Array(62));
  random.mockClear();
  expect(() => generateClassicNote('eth-2' as any, random)).toThrow(
    'Unknown privacy pool'
  );
  expect(random).not.toHaveBeenCalled();
});

it.each(vectors.vectors)(
  'matches original circomlib Pedersen at signed-window/segment boundaries %#',
  ({ preimage: bytes, commitment, nullifierHash }) => {
    expect(identifyClassicNote(`tornado-eth-1-1-0x${bytes}`)).toEqual({
      poolId: 'eth-1',
      commitment,
      nullifierHash,
    });
  }
);

it.each(['0.1', '1', '10', '100'])(
  'identifies supported denomination %s without admitting it as funded',
  (amount) => {
    expect(
      identifyClassicNote(`tornado-eth-${amount}-1-0x${preimage}`)
    ).toEqual({
      ...identifyClassicNote(note),
      poolId: `eth-${amount}`,
    });
  }
);

it('accepts pasted surrounding whitespace and upper-case hex without changing identity', () => {
  const mixed = vectors.vectors[vectors.vectors.length - 1].preimage;
  expect(
    identifyClassicNote(` \n tornado-eth-1-1-0x${mixed.toUpperCase()}\n `)
  ).toEqual(identifyClassicNote(`tornado-eth-1-1-0x${mixed}`));
});

it('binds the commitment to both secret halves and the nullifier hash only to the first', () => {
  const original = identifyClassicNote(note);
  const differentSecret = identifyClassicNote(
    `tornado-eth-1-1-0x${'00'.repeat(31)}${'01'.repeat(31)}`
  );
  const differentNullifier = identifyClassicNote(
    `tornado-eth-1-1-0x${'01'.repeat(31)}${'00'.repeat(31)}`
  );
  expect(differentSecret.commitment).not.toBe(original.commitment);
  expect(differentSecret.nullifierHash).toBe(original.nullifierHash);
  expect(differentNullifier.commitment).not.toBe(original.commitment);
  expect(differentNullifier.nullifierHash).not.toBe(original.nullifierHash);
});

it.each([
  '',
  `prefix${note}`,
  `${note}suffix`,
  `${note}\n${note}`,
  note.replace('tornado-', 'Tornado-'),
  note.replace('-eth-', '-dai-'),
  note.replace('-eth-1-1-', '-eth-1-5-'),
  note.replace('-eth-1-1-', '-eth-1-01-'),
  note.replace('-eth-1-1-', '-eth-01-1-'),
  note.replace('-eth-1-1-', '-eth-1.0-1-'),
  note.replace('-eth-1-1-', '-eth-2-1-'),
  note.replace('-0x', '-'),
  note.slice(0, -1),
  `${note}0`,
  `${note.slice(0, -1)}g`,
  `${' '.repeat(256)}${note}`,
  null,
  {},
])(
  'rejects malformed, unsupported, or ambiguous notes without echoing them %#',
  (value) => {
    expect(() => identifyClassicNote(value as string)).toThrow(
      /^privacy_note_invalid$/
    );
  }
);
