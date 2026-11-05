import { isNonBlankNetworkText } from './networkText';

describe('shared network name and symbol validation', () => {
  it.each(['', ' ', '\t\r\n', '\u00a0\u00a0', '\ufeff', '\u202f'])(
    'rejects blank text %p',
    (value) => expect(isNonBlankNetworkText(value)).toBe(false)
  );

  it.each([
    'Network',
    '  Network  ',
    ' padded symbol ',
    'x'.repeat(32),
    'N'.repeat(100),
    'Mixed.Case/™',
    '🌐 réseau',
    '\tA\n',
    '\u0000A',
    '\ud800',
  ])('preserves the existing nonblank contract for %p', (value) => {
    const original = value;
    expect(isNonBlankNetworkText(value)).toBe(true);
    expect(value).toBe(original);
  });

  it.each([null, undefined, 0, false, {}, ['text']])(
    'rejects nonstring %p without coercion',
    (value) => expect(isNonBlankNetworkText(value)).toBe(false)
  );
});
