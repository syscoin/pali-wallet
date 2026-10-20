import { normalizeNftTokenId } from './nftTokenId';

const maximum =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
it.each(['0', '1', '9007199254740993', maximum])(
  'preserves the exact uint256 identifier %s',
  (tokenId) => expect(normalizeNftTokenId(tokenId)).toBe(tokenId)
);
it.each([0, 42, '0x2a', BigInt(42)])('supports exact integer input %s', (id) =>
  expect(normalizeNftTokenId(id)).toBe(String(id === 0 ? 0 : 42))
);
it.each(['0001', '0x01', '0X01'])('normalizes equivalent token ID %s', (id) =>
  expect(normalizeNftTokenId(id)).toBe('1')
);
it.each(['0000', '0x00', `000${maximum}`])(
  'normalizes padded boundary token ID %s',
  (id) => expect(normalizeNftTokenId(id)).toBe(BigInt(id).toString())
);
it.each([
  '',
  undefined,
  null,
  -1,
  '-1',
  1.5,
  '1.5',
  '1e3',
  Infinity,
  NaN,
  9007199254740992,
  '115792089237316195423570985008687907853269984665640564039457584007913129639936',
  `000${BigInt(maximum) + BigInt(1)}`,
  `0x1${'0'.repeat(64)}`,
  BigInt(maximum) + BigInt(1),
  BigInt(-1),
  '-0',
  {},
  true,
])('rejects malformed, lossy or out-of-range identifier %s', (id) =>
  expect(() => normalizeNftTokenId(id)).toThrow('Invalid token id')
);

it('preserves each supported primitive representation across a bounded integer range', () => {
  for (let id = 0; id < 1000; id += 1) {
    const expected = String(id);
    for (const value of [
      id,
      BigInt(id),
      expected,
      `000${id}`,
      `0x${id.toString(16)}`,
    ])
      expect(normalizeNftTokenId(value)).toBe(expected);
  }
  expect(normalizeNftTokenId(-0)).toBe('0');
});

it.each(['0'.repeat(255) + '7', '0x' + '0'.repeat(253) + '7'])(
  'accepts a valid zero-padded identifier at the 256-character work limit',
  (id) => {
    expect(id).toHaveLength(256);
    expect(normalizeNftTokenId(id)).toBe('7');
  }
);

it.each([
  ['decimal', '9'.repeat(4096)],
  ['hexadecimal', '0x' + 'f'.repeat(4096)],
  ['valid padded value', '0'.repeat(4095) + '7'],
  ['just over the limit', '0'.repeat(256) + '7'],
])('rejects oversized %s before regex or native BigInt work', (_label, id) => {
  const nativeBigInt = BigInt;
  const nativeTest = RegExp.prototype.test;
  let regexCalls = 0;
  let bigIntCalls = 0;
  const regex = jest
    .spyOn(RegExp.prototype, 'test')
    .mockImplementation(function (value) {
      if (value === id) regexCalls += 1;
      return nativeTest.call(this, value);
    });
  const integer = jest.spyOn(global, 'BigInt').mockImplementation(((
    value: any
  ) => {
    bigIntCalls += 1;
    return nativeBigInt(value);
  }) as typeof BigInt);
  let error: unknown;
  try {
    normalizeNftTokenId(id);
  } catch (reason) {
    error = reason;
  } finally {
    regex.mockRestore();
    integer.mockRestore();
  }
  expect(error).toEqual(new Error('Invalid token id'));
  expect(regexCalls).toBe(0);
  expect(bigIntCalls).toBe(0);
});
