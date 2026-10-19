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
])('rejects malformed, lossy or out-of-range identifier %s', (id) =>
  expect(() => normalizeNftTokenId(id)).toThrow('Invalid token id')
);
