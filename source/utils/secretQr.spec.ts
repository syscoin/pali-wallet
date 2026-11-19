import { parseSecretQr } from './secretQr';

const key = `0x${'1'.repeat(64)}`;
const words = 'abandon '.repeat(11) + 'about';
const note = `tornado-eth-0.1-1-0x${'1'.repeat(124)}`;

test('keeps raw wallet secrets compatible with manual import', () => {
  expect(parseSecretQr(key, 'privateKey')).toBe(key);
  expect(parseSecretQr(key.slice(2), 'privateKey')).toBe(key.slice(2));
  expect(parseSecretQr(`xprv${'A'.repeat(107)}`, 'privateKey')).toMatch(
    /^xprv/
  );
  expect(parseSecretQr('K'.repeat(52), 'privateKey')).toBe('K'.repeat(52));
  expect(parseSecretQr(words.replaceAll(' ', '\n'), 'recoveryPhrase')).toBe(
    words
  );
  expect(parseSecretQr(note, 'privateNote')).toBe(note);
});

test('refuses addresses, URLs, oversized values and mismatched secrets', () => {
  expect(parseSecretQr(`0x${'1'.repeat(40)}`, 'privateKey')).toBeNull();
  expect(parseSecretQr(`ethereum:${key}`, 'privateKey')).toBeNull();
  expect(parseSecretQr(`https://example.com/${key}`, 'privateKey')).toBeNull();
  expect(parseSecretQr('A'.repeat(513), 'privateKey')).toBeNull();
  expect(parseSecretQr(note, 'recoveryPhrase')).toBeNull();
  expect(parseSecretQr(words, 'privateNote')).toBeNull();
  expect(parseSecretQr(key, 'privateNote')).toBeNull();
});
