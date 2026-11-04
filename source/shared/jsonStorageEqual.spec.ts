import { jsonStorageEqual } from './jsonStorageEqual';

describe('JSON storage acknowledgement equality', () => {
  it('accepts recursively reordered object keys while preserving array positions', () => {
    expect(
      jsonStorageEqual(
        { z: [{ y: 1, a: 2 }, 'ciphertext'], a: { y: 3, a: 4 } },
        { a: { a: 4, y: 3 }, z: [{ a: 2, y: 1 }, 'ciphertext'] }
      )
    ).toBe(true);
  });

  it.each([
    ['changed value', { value: 1 }, { value: 2 }],
    ['changed type', { value: 1 }, { value: '1' }],
    ['extra key', { a: 1 }, { a: 1, b: 2 }],
    ['missing key', { a: 1, b: 2 }, { a: 1 }],
    ['array order', { a: [1, 2] }, { a: [2, 1] }],
    ['array length', { a: [1] }, { a: [1, 1] }],
    ['ciphertext', { ciphertext: 'AA==' }, { ciphertext: 'AB==' }],
    ['opaque JSON string', '{"z":1,"a":2}', '{"a":2,"z":1}'],
    ['missing versus null', { a: null }, {}],
    ['top-level undefined versus null', undefined, null],
  ])('rejects %s differences', (_name, left, right) => {
    expect(jsonStorageEqual(left, right)).toBe(false);
  });

  it('retains the original JSON semantics for undefined fields and array slots', () => {
    expect(jsonStorageEqual({ a: undefined, b: 2 }, { b: 2 })).toBe(true);
    expect(jsonStorageEqual(undefined, undefined)).toBe(true);
    expect(jsonStorageEqual([undefined], [null])).toBe(true);
  });

  it('does not mutate the supplied snapshots', () => {
    const left = Object.freeze({ z: 1, a: Object.freeze([2, 3]) });
    const right = Object.freeze({ a: Object.freeze([2, 3]), z: 1 });
    expect(jsonStorageEqual(left, right)).toBe(true);
    expect(Object.keys(left)).toEqual(['z', 'a']);
  });

  it('keeps unsupported serialization failures rather than accepting them', () => {
    const cyclic: any = {};
    cyclic.self = cyclic;
    for (const value of [cyclic, BigInt(1)]) {
      let original: Error | undefined;
      try {
        JSON.stringify(value);
      } catch (error) {
        original = error as Error;
      }
      expect(original).toBeInstanceOf(TypeError);
      expect(() => jsonStorageEqual({}, value)).toThrow(original!.message);
    }
    const failure = Error('Serialization refused');
    expect(() =>
      jsonStorageEqual(
        {
          toJSON: () => {
            throw failure;
          },
        },
        {}
      )
    ).toThrow(failure);
  });
});
