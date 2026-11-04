import { createErc20Policy, parseErc20ReadFields } from './erc20';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const metadata = () => ({
  contractAddress: ADDRESS,
  decimals: 18,
  name: 'Example token',
  symbol: 'EXAMPLE',
});

describe('shared ERC20 value policy', () => {
  it('detaches every metadata field before the host normalizer can reenter', () => {
    const input = metadata();
    const original = { ...input };
    const normalize = jest.fn(() => {
      input.contractAddress = `0x${'11'.repeat(20)}`;
      input.decimals = 6;
      input.name = 'Changed';
      Object.defineProperty(input, 'symbol', {
        get: () => {
          throw new Error('Original data was read after reentry');
        },
      });
      return ADDRESS;
    });
    const actual = createErc20Policy(normalize).parseMetadata(input);
    expect(actual).toEqual(original);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(normalize).toHaveBeenCalledWith(ADDRESS);
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it('rejects accessors before invoking the host normalizer', () => {
    const normalize = jest.fn(() => ADDRESS);
    const input = Object.defineProperty(metadata(), 'symbol', {
      enumerable: true,
      get: () => {
        throw new Error('Accessor was evaluated');
      },
    });
    expect(() => createErc20Policy(normalize).parseMetadata(input)).toThrow(
      'Invalid ERC20 data'
    );
    expect(normalize).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 1, '', '0x1234', Promise.resolve(ADDRESS)])(
    'rejects an invalid host-normalizer output: %p',
    (output) => {
      const policy = createErc20Policy(
        (() => output) as unknown as (address: string) => string
      );
      expect(() => policy.normalizeAddress(ADDRESS)).toThrow(
        'Invalid ERC20 data'
      );
      expect(() => policy.parseMetadata(metadata())).toThrow(
        'Invalid ERC20 data'
      );
    }
  );

  it.each([
    { name: '', symbol: '' },
    { name: 'N'.repeat(1024), symbol: 'S'.repeat(1024) },
    { name: 'Existing\u202etoken', symbol: 'Existing\u200bsymbol' },
  ])('separates existing read fields from strict import text: %p', (text) => {
    const read = { ...text, decimals: BigInt(255) };
    const parsed = parseErc20ReadFields(read);
    expect(parsed).toEqual({ ...text, decimals: 255 });
    expect(Object.isFrozen(parsed)).toBe(true);
    read.name = 'Changed';
    expect(parsed.name).toBe(text.name);
    expect(() =>
      createErc20Policy(() => ADDRESS).parseMetadata({
        contractAddress: ADDRESS,
        ...text,
        decimals: 255,
      })
    ).toThrow('Invalid ERC20 data');
  });

  it.each([
    { decimals: 256, name: 'Token', symbol: 'T' },
    { decimals: '18', name: 'Token', symbol: 'T' },
    { decimals: 18, name: null, symbol: 'T' },
    { decimals: 18, name: 'Token', symbol: {} },
    { decimals: 18, name: 'Token', symbol: 'T', extra: true },
  ])('rejects malformed decoded read fields: %p', (input) => {
    expect(() => parseErc20ReadFields(input)).toThrow('Invalid ERC20 data');
  });
});
