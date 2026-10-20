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
