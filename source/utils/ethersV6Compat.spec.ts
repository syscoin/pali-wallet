import { formatUnits, parseUnits } from './ethersV6Compat';

describe('ethers v6 compatibility helpers', () => {
  it('accepts numeric string units like ethers v5', () => {
    const oneToken = parseUnits('1', '18');

    expect(oneToken.toString()).toBe('1000000000000000000');
    expect(formatUnits(oneToken, '18')).toBe('1.0');
  });

  it('preserves named unit parsing', () => {
    const oneGwei = parseUnits('1', 'gwei');

    expect(oneGwei.toString()).toBe('1000000000');
    expect(formatUnits(oneGwei, 'gwei')).toBe('1.0');
  });
});
