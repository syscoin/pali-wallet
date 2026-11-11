import {
  getKnownSyscoinAsset,
  getKnownTokenLogo,
  getTokenLogo,
  sanitizeUtxoTokenLogo,
  sanitizeTokenLogo,
} from './tokens';

describe('known token identity', () => {
  it.each(['SYSX', 'SYS', 'BTC'])(
    'does not trust the attacker-controlled %s symbol for an arbitrary SPT',
    (symbol) => {
      expect(getKnownTokenLogo(symbol, undefined, '987654321')).toBeNull();
    }
  );

  it('does not attach reserved branding when no immutable identity is supplied', () => {
    expect(getKnownTokenLogo('SYSX')).toBeNull();
  });

  it('recognizes canonical SYSX by its consensus asset GUID', () => {
    expect(
      getKnownTokenLogo('UNTRUSTED_SYMBOL', undefined, '123456', 57)
    ).toBeTruthy();
    expect(getKnownSyscoinAsset(123456, 57)).toMatchObject({
      coinGeckoId: 'syscoin',
      isVerified: true,
    });
  });

  it('drops legacy reserved logos from a noncanonical SPT', () => {
    const officialLogo = getKnownTokenLogo('SYSX', undefined, '123456', 57);
    expect(officialLogo).not.toBeNull();

    expect(
      sanitizeUtxoTokenLogo(officialLogo!, '987654321', 57)
    ).toBeUndefined();
    expect(sanitizeUtxoTokenLogo(officialLogo!, '123456', 57)).toBe(
      officialLogo
    );
  });

  it('preserves non-reserved custom SPT logos', () => {
    const customLogo = 'https://assets.example/token.png';
    expect(sanitizeUtxoTokenLogo(customLogo, '987654321')).toBe(customLogo);
  });

  it('preserves the configured EVM token identity lookup', () => {
    expect(
      getKnownTokenLogo(
        'zkSYS',
        '0x6EBb170f69D886916D9ee9E585CE39E626CbC35d',
        undefined,
        57057
      )
    ).not.toBeNull();
  });

  it('rejects a known symbol, missing chain, wrong chain and wrong contract', () => {
    const address = '0x6EBb170f69D886916D9ee9E585CE39E626CbC35d';
    expect(getKnownTokenLogo('zkSYS', address)).toBeNull();
    expect(getKnownTokenLogo('zkSYS', address, undefined, 1)).toBeNull();
    expect(
      getKnownTokenLogo(
        'zkSYS',
        '0x1111111111111111111111111111111111111111',
        undefined,
        57057
      )
    ).toBeNull();
    expect(getKnownSyscoinAsset('123456')).toBeNull();
    expect(getKnownSyscoinAsset('123456', 1)).toBeNull();
    expect(getKnownSyscoinAsset('123456', 5700)).not.toBeNull();
    const artwork = getKnownTokenLogo(undefined, address, undefined, 57057)!;
    expect(sanitizeTokenLogo(artwork, address, undefined, 1)).toBeUndefined();
    expect(sanitizeTokenLogo(artwork, address)).toBeUndefined();
    expect(sanitizeTokenLogo(artwork, address, undefined, 57057)).toBe(artwork);
    expect(getKnownTokenLogo(undefined, address, undefined, 57057, 18)).toBe(
      artwork
    );
    expect(
      getKnownTokenLogo(undefined, address, undefined, 57057, 6)
    ).toBeNull();
    expect(
      sanitizeTokenLogo(artwork, address, undefined, 57057, 6)
    ).toBeUndefined();
  });

  it('shares the configured USDC identity and rejects changed precision', () => {
    const address = '0xd501e86b1fc5823403b2ba995e2b8b78179236a6';
    expect(
      getKnownTokenLogo('MISLEADING', address, undefined, 57057, 6)
    ).toBeTruthy();
    expect(getKnownTokenLogo('USDC', address, undefined, 1, 6)).toBeNull();
    expect(getKnownTokenLogo('USDC', address, undefined, 57057, 18)).toBeNull();
  });

  it('preserves the generic fallback for an unknown custom SPT', () => {
    expect(getTokenLogo('CUSTOM', true, '987654321')).not.toBeNull();
    expect(getTokenLogo('CUSTOM', false, '987654321')).toBeNull();
  });
});
