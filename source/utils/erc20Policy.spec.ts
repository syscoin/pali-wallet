import { getAddress, isAddress } from 'ethers/address';

import { createErc20Policy } from '../shared/erc20';

import { isEvmAddress } from './erc20Policy';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const ZERO = `0x${'0'.repeat(40)}`;
const ICAP = 'XE65GB6LDNXYOFTX0NSV3FUWKOWIXAMJK36';

it.each([
  ADDRESS,
  ADDRESS.toLowerCase(),
  ADDRESS.slice(2),
  ICAP,
  ZERO,
  'example.eth',
  '0x1234',
  ` ${ADDRESS}`,
  ADDRESS.replace('E0F', 'e0F'),
  null,
  1,
])('preserves extension ethers address syntax for %p', (value) => {
  expect(isEvmAddress(value)).toBe(isAddress(value));
});

it('keeps zero and non-hex input rules attached to the strict import role', () => {
  const policy = createErc20Policy(getAddress);
  expect(policy.normalizeAddress(ZERO)).toBe(ZERO);
  expect(policy.normalizeAddress(ICAP)).toBe(getAddress(ICAP));
  expect(policy.normalizeAddress(ADDRESS.slice(2))).toBe(ADDRESS);
  expect(policy.normalizeNonzeroHexAddress(ADDRESS.toLowerCase())).toBe(
    ADDRESS
  );
  for (const value of [ZERO, ICAP, ADDRESS.slice(2), 'example.eth'])
    expect(() => policy.normalizeNonzeroHexAddress(value)).toThrow(
      'Invalid ERC20 data'
    );
});
