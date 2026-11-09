import { unionUtxoExclusions } from './utxoExclusions';

const point = (value: number, vout = 0) => ({
  txid: value.toString(16).padStart(64, '0'),
  vout,
});
const invalid = { code: 'INVALID_EXCLUDED_UTXOS', error: true };

describe('shared UTXO exclusion union', () => {
  it('keeps the full 1000-unique union when the sources overlap across the raw limit', () => {
    const collateral = Array.from({ length: 501 }, (_, i) => point(i));
    const journal = Array.from({ length: 500 }, (_, i) => point(i + 500));
    const result = unionUtxoExclusions(journal, collateral);
    expect(result).toHaveLength(1000);
    expect(new Set(result.map(({ txid, vout }) => `${txid}:${vout}`))).toEqual(
      new Set(Array.from({ length: 1000 }, (_, i) => `${point(i).txid}:0`))
    );
  });

  it('validates and canonicalizes duplicate IDs without merging different outputs', () => {
    const source = { txid: 'AB'.repeat(32), vout: 0xffffffff };
    const other = { txid: source.txid.toLowerCase(), vout: 0 };
    expect(
      unionUtxoExclusions([source], [{ ...source, txid: other.txid }, other])
    ).toEqual([{ txid: other.txid, vout: 0xffffffff }, other]);
    expect(source.txid).toBe('AB'.repeat(32));
    const result = unionUtxoExclusions([source], []);
    expect(result[0]).not.toBe(source);
  });

  it('counts the capacity after deduplication within each source too', () => {
    expect(
      unionUtxoExclusions(
        Array.from({ length: 1001 }, () => point(1)),
        []
      )
    ).toEqual([point(1)]);
    expect(unionUtxoExclusions([], [])).toEqual([]);
  });

  it('refuses 1001 genuinely distinct protected outputs without truncating', () => {
    expect(() =>
      unionUtxoExclusions(
        Array.from({ length: 501 }, (_, i) => point(i)),
        Array.from({ length: 500 }, (_, i) => point(i + 501))
      )
    ).toThrow(expect.objectContaining(invalid));
  });

  it.each([undefined, null, false, {}, 'not an array'])(
    'requires each source to be an array: %p',
    (value) => {
      expect(() => unionUtxoExclusions(value, [])).toThrow(
        expect.objectContaining(invalid)
      );
      expect(() => unionUtxoExclusions([], value)).toThrow(
        expect.objectContaining(invalid)
      );
    }
  );

  it.each([
    null,
    false,
    {},
    { txid: '01', vout: 0 },
    { txid: 'gg'.repeat(32), vout: 0 },
    { ...point(1), vout: '0' },
    { ...point(1), vout: -1 },
    { ...point(1), vout: 1.5 },
    { ...point(1), vout: 0x100000000 },
    { ...point(1), vout: NaN },
  ])(
    'refuses malformed entries instead of dropping an exclusion: %p',
    (value) => {
      expect(() => unionUtxoExclusions([point(1)], [value])).toThrow(
        expect.objectContaining(invalid)
      );
    }
  );
});
