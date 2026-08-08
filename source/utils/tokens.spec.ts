import {
  getKnownSyscoinAsset,
  getKnownTokenLogo,
  getTokenLogo,
  sanitizeUtxoTokenLogo,
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
      getKnownTokenLogo('UNTRUSTED_SYMBOL', undefined, '123456')
    ).toContain('/blockchains/syscoin/info/logo.png');
    expect(getKnownSyscoinAsset(123456)).toMatchObject({
      coinGeckoId: 'syscoin',
      isVerified: true,
    });
  });

  it('drops legacy reserved logos from a noncanonical SPT', () => {
    const officialLogo = getKnownTokenLogo('SYSX', undefined, '123456');
    expect(officialLogo).not.toBeNull();

    expect(sanitizeUtxoTokenLogo(officialLogo!, '987654321')).toBeUndefined();
    expect(sanitizeUtxoTokenLogo(officialLogo!, '123456')).toBe(officialLogo);
  });

  it('preserves non-reserved custom SPT logos', () => {
    const customLogo = 'https://assets.example/token.png';
    expect(sanitizeUtxoTokenLogo(customLogo, '987654321')).toBe(customLogo);
  });

  it('preserves the configured EVM token identity lookup', () => {
    expect(
      getKnownTokenLogo('zkSYS', '0x6EBb170f69D886916D9ee9E585CE39E626CbC35d')
    ).not.toBeNull();
  });

  it('preserves the generic fallback for an unknown custom SPT', () => {
    expect(getTokenLogo('CUSTOM', true, '987654321')).not.toBeNull();
    expect(getTokenLogo('CUSTOM', false, '987654321')).toBeNull();
  });
});
