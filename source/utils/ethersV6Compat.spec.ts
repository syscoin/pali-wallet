import { formatUnits, parseUnits } from './ethersV6Compat';

describe('ethers v6 compatibility helpers', () => {
  it('does not mutate native Interface while preserving selectors and topics', () => {
    jest.isolateModules(() => {
      const { Interface: NativeInterface } = jest.requireActual('ethers/abi');
      const before = Object.getOwnPropertyDescriptors(
        NativeInterface.prototype
      );
      const { Interface } = jest.requireActual('./ethersV6Compat');

      expect(Interface).toBe(NativeInterface);
      expect(
        Object.getOwnPropertyDescriptors(NativeInterface.prototype)
      ).toEqual(before);
      expect(NativeInterface.prototype.getSighash).toBeUndefined();
      expect(NativeInterface.prototype.getEventTopic).toBeUndefined();

      const contract = new Interface([
        'function transfer(address to,uint256 amount)',
        'event Transfer(address indexed from,address indexed to,uint256 value)',
      ]);
      expect(contract.getFunction('transfer').selector).toBe('0xa9059cbb');
      expect(contract.getEvent('Transfer').topicHash).toBe(
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      );
    });
  });

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
